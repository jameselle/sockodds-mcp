/** Tool logic, kept apart from the MCP wiring so it can be tested with a fake odds source. */
import { FREE_TIER, RESPONSIBLE_GAMBLING } from "./config.js";
import type { OddsSource, Params } from "./client.js";
import { SockOddsError } from "./errors.js";
import {
  bookMarketsAt,
  chooseLine,
  eventStart,
  eventTitle,
  findMarket,
  groupMarkets,
  quotesFor,
  type MarketKind,
  type MarketView,
  type SideView,
} from "./markets.js";
import { consensusFairOdds, selectBestPrice, type BookMarket, type FairResult, type Quote } from "./odds-math.js";
import { bookName, formatDecimal, formatKickoff, formatLine, formatStamp, noLongDashes, pct } from "./format.js";
import { matchEvents, parseQuery } from "./search.js";
import type { Fetched, SockEvent } from "./types.js";

export interface ToolDeps {
  source: OddsSource;
  timeZone: string;
  now?: () => Date;
}

const DEMO_BANNER = "DEMO DATA: invented sample prices in the SockOdds format. These are not real or current odds.";

function nowOf(deps: ToolDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function readLine(fetched: Fetched<unknown>, deps: ToolDeps): string[] {
  const lines: string[] = [];
  if (fetched.source === "demo") lines.push(DEMO_BANNER);
  else {
    const ageS = Math.round((nowOf(deps).getTime() - Date.parse(fetched.fetchedAt)) / 1000);
    lines.push(
      `Read from SockOdds at ${formatStamp(fetched.fetchedAt)}${ageS >= 2 ? ` (cached, ${ageS} s ago)` : ""}.`,
    );
  }
  if (fetched.notice) lines.push(`SockOdds notice: ${fetched.notice}`);
  return lines;
}

function finish(lines: string[]): string {
  return noLongDashes(lines.join("\n"));
}

/** Accept "NRLW", "afl" or a full leagueID such as "RUGBYLEAGUE_NRLW". */
export function resolveLeagueID(input: string): string {
  const fromWords = parseQuery(input).leagueIDs;
  return fromWords.length === 1 ? fromWords[0] : input.trim().toUpperCase();
}

async function loadEvent(deps: ToolDeps, eventID: string, extra: Params = {}): Promise<{ ev: SockEvent; fetched: Fetched<SockEvent[]> }> {
  const fetched = await deps.source.events({ eventID, ...extra });
  const ev = fetched.data.find((e) => e.eventID === eventID) ?? fetched.data[0];
  if (!ev) {
    throw new SockOddsError(
      `SockOdds has no event with ID "${eventID}" that this key can read. Use find_event to get the exact event ID.`,
    );
  }
  return { ev, fetched };
}

function eventHeader(ev: SockEvent, deps: ToolDeps): string[] {
  const lines = [`${eventTitle(ev)} (${ev.leagueID ?? "league not given"})`];
  lines.push(`Starts: ${formatKickoff(eventStart(ev), deps.timeZone)}`);
  if (ev.status?.live) lines.push("Status: LIVE. In-play prices move fast.");
  if (ev.info?.stale) lines.push("Warning: SockOdds marks this event stale (no source update for 45 minutes). Treat the prices with care.");
  lines.push(`Event ID: ${ev.eventID}`);
  return lines;
}

function quoteText(q: Quote, withLine: boolean, signed = true): string {
  const line = withLine && q.line !== undefined ? ` ${formatLine(q.line, signed)}` : "";
  const carried = q.carriedFrom ? ` [same price book as ${bookName(q.carriedFrom)}]` : "";
  const state = q.available ? "" : " (suspended)";
  return `${bookName(q.bookmakerID)}${line} ${formatDecimal(q.decimal)}${state}, read ${formatStamp(q.lastUpdatedAt)}${carried}`;
}

// ---------------------------------------------------------------- list_leagues

export async function listLeagues(deps: ToolDeps, args: { sport_id?: string }): Promise<string> {
  const fetched = await deps.source.leagues(args.sport_id ? { sportID: args.sport_id.toUpperCase() } : {});
  const leagues = [...fetched.data].sort(
    (a, b) => Number(b.enabled ?? false) - Number(a.enabled ?? false) || a.leagueID.localeCompare(b.leagueID),
  );
  const lines = [...readLine(fetched, deps), ""];
  if (leagues.length === 0) lines.push("SockOdds returned no leagues for that filter.");
  for (const l of leagues) {
    const access = l.enabled === false ? "not on this key's plan" : "available to this key";
    const active = typeof l.activeEvents === "number" ? `, ${l.activeEvents} events carried` : "";
    lines.push(`- ${l.leagueID}: ${l.name ?? l.shortName ?? l.leagueID} (${l.sportID ?? "sport not given"}), ${access}${active}`);
  }
  lines.push("", `The free Developer plan covers ${FREE_TIER.leagues.join(", ")}. Use the leagueID with find_event.`);
  return finish(lines);
}

// ---------------------------------------------------------------- find_event

export interface FindEventArgs {
  query: string;
  league_id?: string;
  days_ahead?: number;
  limit?: number;
}

export async function findEvent(deps: ToolDeps, args: FindEventArgs): Promise<string> {
  const parsed = parseQuery(args.query);
  const leagues = args.league_id ? [resolveLeagueID(args.league_id)] : parsed.leagueIDs;
  const days = args.days_ahead ?? 14;
  const limit = args.limit ?? (leagues.length ? 25 : 50);
  const now = nowOf(deps);
  const fetched = await deps.source.events({
    leagueID: leagues.length ? leagues.join(",") : undefined,
    oddsAvailable: true,
    startsBefore: new Date(now.getTime() + days * 86_400_000).toISOString(),
    oddID: "points-home-game-ml-home",
    includeOpposingOdds: true,
    limit,
  });
  const matches = matchEvents(fetched.data, parsed);
  const window = fetched.source === "demo" ? "" : `, starting in the next ${days} days`;
  const scope = `${leagues.length ? leagues.join(", ") : "every league this key can read"}${window}`;
  const lines = [...readLine(fetched, deps), ""];

  if (fetched.data.length === 0) {
    lines.push(`No events with open odds for ${scope}.`);
    lines.push(`The free plan covers ${FREE_TIER.leagues.join(", ")}; try another league, a longer days_ahead, or list_leagues.`);
    return finish(lines);
  }

  const shown = matches.length ? matches : fetched.data.map((event) => ({ event, score: 0 }));
  if (matches.length === 0) {
    lines.push(`Nothing matched "${args.query}" in ${scope}. These are the events SockOdds returned, soonest first:`);
    shown.sort((a, b) => (Date.parse(eventStart(a.event) ?? "") || 0) - (Date.parse(eventStart(b.event) ?? "") || 0));
  } else if (parsed.tokens.length === 0) {
    lines.push(`The question names no team, so these are the events in ${scope}, soonest first:`);
  } else {
    lines.push(`Events matching "${args.query}" (${scope}), best match first:`);
  }

  shown.slice(0, 10).forEach(({ event }, i) => {
    lines.push("", `${i + 1}. ${eventTitle(event)} (${event.leagueID ?? "?"})`);
    lines.push(`   Starts: ${formatKickoff(eventStart(event), deps.timeZone)}`);
    lines.push(`   Event ID: ${event.eventID}`);
    const h2h = findMarket(event, "h2h");
    if (h2h) {
      const parts = h2h.sides.map((s) => {
        const best = selectBestPrice(s.quotes, { now }).best[0];
        return best ? `${s.label} ${formatDecimal(best.decimal)} (${bookName(best.bookmakerID)})` : `${s.label} no open price`;
      });
      lines.push(`   Best head to head: ${parts.join(", ")}`);
    }
  });
  if (shown.length > 10) lines.push("", `${shown.length - 10} more not shown. Add a team name or league_id to narrow it.`);
  if (fetched.nextCursor) lines.push("", "SockOdds has more events than were fetched. Pass league_id or a smaller days_ahead to narrow the search.");
  if (fetched.source === "live" && Date.parse(fetched.fetchedAt) > now.getTime() - 2000) {
    lines.push("", `This search returned ${fetched.data.length} events, which counts as ${fetched.data.length} objects against the key's monthly allowance.`);
  }
  lines.push("", "Next: get_odds with an event ID for every bookmaker's prices.");
  return finish(lines);
}

// ---------------------------------------------------------------- get_odds

export interface GetOddsArgs {
  event_id: string;
  bookmakers?: string;
  all_markets?: boolean;
}

const MAX_MARKETS = 40;

function renderMarket(m: MarketView, now: Date): string[] {
  const out = [m.label];
  const signed = m.betTypeID === "sp";
  for (const s of m.sides) {
    const hasLines = s.quotes.some((q) => q.line !== undefined);
    const quotes = [...s.quotes].sort((a, b) => Number(b.available) - Number(a.available) || b.decimal - a.decimal);
    const line = hasLines ? chooseLine(s) : undefined;
    const best = selectBestPrice(s.quotes, { line, now }).best;
    const bestText = best.length
      ? `best ${formatDecimal(best[0].decimal)} at ${best.map((q) => bookName(q.bookmakerID)).join(" and ")}${line !== undefined ? ` (line ${formatLine(line, signed)})` : ""}`
      : "no open price";
    const extras: string[] = [];
    if (s.bookDecimal !== undefined) extras.push(`SockOdds book consensus ${formatDecimal(s.bookDecimal)}`);
    if (s.fairDecimal !== undefined) extras.push(`SockOdds fair ${formatDecimal(s.fairDecimal)}${s.fairLine !== undefined ? ` at ${formatLine(s.fairLine, signed)}` : ""}`);
    out.push(`  ${s.label}: ${bestText}${extras.length ? `; ${extras.join(", ")}` : ""}`);
    for (const q of quotes) out.push(`    ${quoteText(q, hasLines, signed)}`);
  }
  return out;
}

export async function getOdds(deps: ToolDeps, args: GetOddsArgs): Promise<string> {
  const extra: Params = args.bookmakers ? { bookmakerID: args.bookmakers.replace(/\s+/g, "").toLowerCase() } : {};
  const { ev, fetched } = await loadEvent(deps, args.event_id, extra);
  const now = nowOf(deps);
  const markets = groupMarkets(ev, { mainOnly: !args.all_markets });
  const lines = [...readLine(fetched, deps), "", ...eventHeader(ev, deps)];
  if (markets.length === 0) {
    lines.push("", args.all_markets ? "No markets are priced on this event right now." : "No head to head, line or total markets are priced on this event right now. Try all_markets: true.");
  }
  for (const m of markets.slice(0, MAX_MARKETS)) lines.push("", ...renderMarket(m, now));
  if (markets.length > MAX_MARKETS) lines.push("", `${markets.length - MAX_MARKETS} more markets not shown.`);
  lines.push("", "Prices are decimal odds. Each price shows when SockOdds last saw it at that bookmaker.", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- best_price

export interface BestPriceArgs {
  event_id: string;
  market?: MarketKind;
  side?: string;
  odd_id?: string;
  line?: number;
}

function pickSide(ev: SockEvent, args: BestPriceArgs): { market: string; side: SideView; signed: boolean } {
  if (args.odd_id) {
    const o = ev.odds?.[args.odd_id];
    if (!o) throw new SockOddsError(`This event has no market with oddID "${args.odd_id}". Use get_odds with all_markets to see what is priced.`);
    const side = groupMarkets(ev, { mainOnly: false }).flatMap((m) => m.sides.map((s) => ({ m, s }))).find((x) => x.s.oddID === args.odd_id);
    if (side) return { market: side.m.label, side: side.s, signed: side.m.betTypeID === "sp" };
    return {
      market: o.marketName ?? args.odd_id,
      signed: o.betTypeID === "sp",
      side: { oddID: args.odd_id, sideID: o.sideID ?? "", label: o.marketName ?? args.odd_id, quotes: quotesFor(o) },
    };
  }
  if (!args.market || !args.side) throw new SockOddsError("Give either odd_id, or both market and side.");
  const m = findMarket(ev, args.market);
  if (!m) {
    const have = groupMarkets(ev).map((x) => x.kind).filter(Boolean);
    throw new SockOddsError(
      `No ${args.market} market is priced on this event right now.${have.length ? ` Available: ${[...new Set(have)].join(", ")}.` : ""}`,
    );
  }
  const side = m.sides.find((s) => s.sideID === args.side);
  if (!side) {
    throw new SockOddsError(`The ${m.label} market has no "${args.side}" side. Sides: ${m.sides.map((s) => `${s.sideID} (${s.label})`).join(", ")}.`);
  }
  return { market: m.label, side, signed: m.betTypeID === "sp" };
}

export async function bestPrice(deps: ToolDeps, args: BestPriceArgs): Promise<string> {
  const { ev, fetched } = await loadEvent(deps, args.event_id);
  const now = nowOf(deps);
  const { market, side, signed } = pickSide(ev, args);
  const line = chooseLine(side, args.line);
  const r = selectBestPrice(side.quotes, { line, now });
  const at = line !== undefined ? ` at line ${formatLine(line, signed)}` : "";
  const lines = [...readLine(fetched, deps), "", ...eventHeader(ev, deps), "", `Best price: ${side.label}, ${market}${at}`];
  if (r.best.length === 0) {
    lines.push("  No bookmaker has this open right now.");
  } else {
    for (const q of r.best) lines.push(`  ${formatDecimal(q.decimal)} at ${bookName(q.bookmakerID)} (read ${formatStamp(q.lastUpdatedAt)})`);
    lines.push("", "The field (open prices, best first):");
    for (const q of r.field) lines.push(`  ${quoteText(q, line !== undefined, signed)}`);
  }
  if (r.excluded.length) {
    lines.push("", "Left out:");
    for (const q of r.excluded) lines.push(`  ${quoteText(q, q.line !== undefined, signed)} [${q.reason}]`);
  }
  if (side.bookDecimal !== undefined) lines.push("", `SockOdds book consensus (margin included): ${formatDecimal(side.bookDecimal)}`);
  lines.push("", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- fair_odds

export interface FairOddsArgs {
  event_id?: string;
  market?: MarketKind;
  line?: number;
  prices?: { outcomes: string[]; books: Array<{ bookmaker: string; odds: number[] }> };
}

function renderFair(r: FairResult, times?: Map<string, string | undefined>): string[] {
  const lines: string[] = [];
  r.outcomes.forEach((o, i) => lines.push(`  ${o}: fair ${formatDecimal(r.fairDecimals[i])} (${pct(r.fairProbabilities[i])} chance)`));
  lines.push("", `Per bookmaker (margin, then its own no-vig prices):`);
  for (const b of r.books) {
    const when = times?.get(b.bookmakerID);
    lines.push(
      `  ${bookName(b.bookmakerID)}: margin ${pct(b.margin)}, ${b.fairDecimals.map((d) => formatDecimal(d)).join(" / ")}${when ? `, read ${formatStamp(when)}` : ""}`,
    );
  }
  if (r.bestPriceOverround !== undefined) {
    const m = r.bestPriceOverround - 1;
    lines.push(
      "",
      m < 0
        ? `Taking the best price on every outcome adds up to ${pct(r.bestPriceOverround)}, under 100%. Prices that far apart are often stale or about to move; check each one at the bookmaker before acting.`
        : `Taking the best price on every outcome still leaves a combined margin of ${pct(m)}.`,
    );
  }
  return lines;
}

const METHOD =
  "Method: for each bookmaker that prices every outcome at the same line, turn its prices into implied chances (1 / price), divide by their total to strip the margin, then average those chances across bookmakers and turn them back into prices (1 / chance).";

export async function fairOdds(deps: ToolDeps, args: FairOddsArgs): Promise<string> {
  if (args.prices) {
    const { outcomes, books } = args.prices;
    const bm: BookMarket[] = books.map((b) => ({ bookmakerID: b.bookmaker, decimals: b.odds }));
    if (books.some((b) => b.odds.length !== outcomes.length)) {
      throw new SockOddsError(`Each bookmaker needs exactly ${outcomes.length} prices, one per outcome, in the order: ${outcomes.join(", ")}.`);
    }
    const r = consensusFairOdds(outcomes, bm);
    return finish([`No-vig fair odds from the prices given (${r.books.length} bookmaker${r.books.length === 1 ? "" : "s"})`, METHOD, "", ...renderFair(r), "", "A fair price is an estimate of the chance, not a prediction or a tip.", RESPONSIBLE_GAMBLING]);
  }
  if (!args.event_id || !args.market) throw new SockOddsError("Give event_id and market, or give prices to work out fair odds by hand.");
  const { ev, fetched } = await loadEvent(deps, args.event_id);
  const m = findMarket(ev, args.market);
  if (!m) throw new SockOddsError(`No ${args.market} market is priced on this event right now. Use get_odds to see what is.`);
  if (m.sides.length < 2 || m.sides.length > 3) {
    throw new SockOddsError(`The ${m.label} market has ${m.sides.length} sides here; fair odds need a complete two- or three-way market.`);
  }
  const { line, outcomes, books } = bookMarketsAt(m, args.line);
  const r = consensusFairOdds(outcomes, books);
  const times = new Map<string, string | undefined>();
  for (const b of books) {
    const stamps = m.sides.flatMap((s) => s.quotes.filter((q) => q.bookmakerID === b.bookmakerID).map((q) => q.lastUpdatedAt ?? ""));
    times.set(b.bookmakerID, stamps.sort()[0] || undefined);
  }
  const at = line !== undefined ? ` at line ${formatLine(line, m.betTypeID === "sp")}` : "";
  const lines = [
    ...readLine(fetched, deps),
    "",
    ...eventHeader(ev, deps),
    "",
    `No-vig fair odds: ${m.label}${at}, from ${r.books.length} bookmaker${r.books.length === 1 ? "" : "s"}`,
    METHOD,
    "",
    ...renderFair(r, times),
  ];
  const sharp = m.sides.filter((s) => s.fairDecimal !== undefined);
  lines.push(
    "",
    sharp.length
      ? `SockOdds' own fair price (from exchanges and sharp books): ${sharp.map((s) => `${s.label} ${formatDecimal(s.fairDecimal)}`).join(", ")}.`
      : "SockOdds' own sharp-sourced fair price is not in this response (it is null on plans without fair odds), so this estimate uses the bookmakers' prices only.",
    "Fair prices from retail bookmakers are an estimate of the chance, not a prediction or a tip.",
    RESPONSIBLE_GAMBLING,
  );
  return finish(lines);
}

