/** Tool logic, kept apart from the MCP wiring so it can be tested with a fake odds source. */
import { FREE_TIER, RESPONSIBLE_GAMBLING, listWords } from "./config.js";
import type { OddsSource, Params } from "./client.js";
import { SockOddsError } from "./errors.js";
import {
  MAIN_MARKET_KEYS,
  MARKET_KEYS,
  bookMarketsAt,
  chooseLine,
  eventStart,
  eventTitle,
  findMarket,
  groupMarkets,
  objectsUsed,
  type MarketKind,
  type MarketView,
  type SideView,
} from "./markets.js";
import { consensusFairOdds, selectBestPrice, type BookMarket, type FairResult, type Quote } from "./odds-math.js";
import { bookName, formatDecimal, formatKickoff, formatLine, formatStamp, noLongDashes, pct } from "./format.js";
import { matchEvents, parseQuery } from "./search.js";
import type { Fetched, OddsEvent, SockEvent } from "./types.js";

export interface ToolDeps {
  source: OddsSource;
  timeZone: string;
  now?: () => Date;
}

const DEMO_BANNER = "DEMO DATA: invented sample prices in the SockOdds format. These are not real or current odds.";

/** v1 identifier formats, from the contract. */
const EVENT_ID = /^ev_[0-9a-hjkmnp-tv-z]{12}$/;
const OUTCOME_ID = /^oc_[0-9a-hjkmnp-tv-z]{16}$/;
const KEY = /^[a-z][a-z0-9_]{1,47}$/;

function nowOf(deps: ToolDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/** UTC to the second, the form the API documents for starts_after and starts_before. */
function utc(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

function readLine(fetched: Fetched<unknown>, deps: ToolDeps): string[] {
  if (fetched.source === "demo") return [DEMO_BANNER];
  const ageS = Math.round((nowOf(deps).getTime() - Date.parse(fetched.fetchedAt)) / 1000);
  return [`Read from SockOdds at ${formatStamp(fetched.fetchedAt)}${ageS >= 2 ? ` (cached, ${ageS} s ago)` : ""}.`];
}

/** Only a fresh live response cost anything; a cached or demo one did not. */
function isFresh(fetched: Fetched<unknown>, deps: ToolDeps): boolean {
  return fetched.source === "live" && Date.parse(fetched.fetchedAt) > nowOf(deps).getTime() - 2000;
}

function costLine(fetched: Fetched<unknown>, deps: ToolDeps, objects: number, what: string): string[] {
  return isFresh(fetched, deps) ? ["", `${what} used ${objects} object${objects === 1 ? "" : "s"} of the key's monthly allowance.`] : [];
}

function finish(lines: string[]): string {
  return noLongDashes(lines.join("\n"));
}

/** Accept "NRL", "afl", "Rugby League World Cup" or a v1 league key such as "rlwc". */
export function resolveLeagueKey(input: string): string {
  const fromWords = parseQuery(input).leagues;
  if (fromWords.length === 1) return fromWords[0];
  const key = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!KEY.test(key)) {
    throw new SockOddsError(
      `"${input}" is not a SockOdds league. League keys are lower case, such as afl, nrl, nfl, mlb or rlwc. Use list_leagues to see them.`,
    );
  }
  return key;
}

export function checkEventID(eventID: string): string {
  const id = eventID.trim();
  if (EVENT_ID.test(id)) return id;
  throw new SockOddsError(
    `"${eventID}" is not a SockOdds event ID. Event IDs are ev_ followed by 12 letters and digits, for example ev_000ckk0nc1tg. IDs from the older SockOdds API are not translated, so use find_event to get the current ID.`,
  );
}

async function loadOdds(deps: ToolDeps, eventID: string, params: Params = {}): Promise<{ ev: OddsEvent; fetched: Fetched<OddsEvent> }> {
  const fetched = await deps.source.eventOdds(checkEventID(eventID), params);
  return { ev: fetched.data, fetched };
}

function statusLine(ev: SockEvent): string | undefined {
  switch (ev.status) {
    case "live":
      return "Status: LIVE. In-play prices move fast.";
    case "final":
      return "Status: finished.";
    case "postponed":
      return "Status: postponed.";
    case "cancelled":
      return "Status: cancelled.";
    default:
      return undefined;
  }
}

function eventHeader(ev: SockEvent, deps: ToolDeps): string[] {
  const lines = [`${eventTitle(ev)} (${ev.league?.name ?? "league not given"})`];
  lines.push(`Starts: ${formatKickoff(eventStart(ev), deps.timeZone)}`);
  const status = statusLine(ev);
  if (status) lines.push(status);
  lines.push(`Event ID: ${ev.id}`);
  return lines;
}

function quoteName(q: Quote): string {
  return bookName(q.bookmakerID, q.bookmakerName);
}

function quoteText(q: Quote, withLine: boolean, signed = true): string {
  const line = withLine && q.line !== undefined ? ` ${formatLine(q.line, signed)}` : "";
  const state = q.available ? "" : " (not available)";
  return `${quoteName(q)}${line} ${formatDecimal(q.decimal)}${state}, seen ${formatStamp(q.observedAt)}`;
}

function noPricesText(ev: OddsEvent, bookmakers?: string): string {
  const why = [
    "SockOdds shows only prices it has seen in the last ten minutes, so a game that has started or finished often has none.",
  ];
  if (bookmakers) why.push("The bookmakers named may not be quoting it, or may not be on this key's plan (prices from bookmakers outside the plan are left out).");
  return `No bookmaker has a current price on ${eventTitle(ev)}. ${why.join(" ")}`;
}

// ---------------------------------------------------------------- list_leagues

export async function listLeagues(deps: ToolDeps, args: { sport_id?: string }): Promise<string> {
  const sport = args.sport_id ? args.sport_id.trim().toLowerCase().replace(/[\s-]+/g, "_") : undefined;
  const fetched = await deps.source.leagues({ sport, limit: 100 });
  const leagues = [...fetched.data].sort((a, b) => (a.sport ?? "").localeCompare(b.sport ?? "") || a.key.localeCompare(b.key));
  const lines = [...readLine(fetched, deps), ""];
  if (leagues.length === 0) lines.push(`SockOdds returned no leagues${sport ? ` for the sport "${sport}"` : ""}. Sport keys are lower case, such as australian_football, rugby_league or soccer.`);
  for (const l of leagues) {
    lines.push(`- ${l.key}: ${l.name} (${l.sport ?? "sport not given"}${l.region ? `, ${l.region}` : ""})`);
  }
  if (fetched.next) lines.push("", "SockOdds has more leagues than fit on one page. Pass sport_id to narrow the list.");
  lines.push(
    "",
    `The free Developer plan covers ${listWords(FREE_TIER.leagues)}. A league outside the key's plan answers with a plan restriction. Use the league key with find_event.`,
  );
  lines.push(...costLine(fetched, deps, leagues.length, "This list"));
  return finish(lines);
}

// ---------------------------------------------------------------- find_event

export interface FindEventArgs {
  query: string;
  league_id?: string;
  days_ahead?: number;
  limit?: number;
}

/** Live games started up to this long ago are still found. */
const LOOKBACK_MS = 6 * 3_600_000;

export async function findEvent(deps: ToolDeps, args: FindEventArgs): Promise<string> {
  const parsed = parseQuery(args.query);
  const league = args.league_id ? resolveLeagueKey(args.league_id) : parsed.leagues[0];
  const days = args.days_ahead ?? 14;
  const limit = args.limit ?? (league ? 25 : 50);
  const now = nowOf(deps);
  const fetched = await deps.source.events({
    league,
    starts_after: utc(new Date(now.getTime() - LOOKBACK_MS)),
    starts_before: utc(new Date(now.getTime() + days * 86_400_000)),
    limit,
  });
  const events = fetched.data.filter((e) => e.status !== "final" && e.status !== "cancelled");
  const matches = matchEvents(events, parsed);
  const window = fetched.source === "demo" ? "" : `, starting in the next ${days} days`;
  const scope = `${league ?? "every league this key can read"}${window}`;
  const lines = [...readLine(fetched, deps), ""];

  if (events.length === 0) {
    lines.push(`No upcoming events for ${scope}.`);
    lines.push(`The free plan covers ${listWords(FREE_TIER.leagues)}; try another league, a longer days_ahead, or list_leagues.`);
    lines.push(...costLine(fetched, deps, fetched.data.length, "This search"));
    return finish(lines);
  }

  const start = (e: SockEvent) => Date.parse(eventStart(e) ?? "") || 0;
  const shown = matches.length ? matches : events.map((event) => ({ event, score: 0 })).sort((a, b) => start(a.event) - start(b.event));
  if (matches.length === 0) {
    lines.push(`Nothing matched "${args.query}" in ${scope}. These are the events SockOdds returned, soonest first:`);
  } else if (parsed.tokens.length === 0) {
    lines.push(`The question names no team, so these are the events in ${scope}, soonest first:`);
  } else {
    lines.push(`Events matching "${args.query}" (${scope}), best match first:`);
  }

  shown.slice(0, 10).forEach(({ event }, i) => {
    lines.push("", `${i + 1}. ${eventTitle(event)} (${event.league?.name ?? event.league?.key ?? "?"})`);
    lines.push(`   Starts: ${formatKickoff(eventStart(event), deps.timeZone)}`);
    const status = statusLine(event);
    if (status) lines.push(`   ${status}`);
    lines.push(`   Event ID: ${event.id}`);
  });
  if (shown.length > 10) lines.push("", `${shown.length - 10} more not shown. Add a team name or league_id to narrow it.`);
  if (fetched.next) lines.push("", "SockOdds has more events than were fetched. Pass league_id or a smaller days_ahead to narrow the search.");
  lines.push(...costLine(fetched, deps, fetched.data.length, "This search"));
  lines.push("", "Next: get_odds or best_price with an event ID for bookmakers' prices.");
  return finish(lines);
}

// ---------------------------------------------------------------- get_odds

export interface GetOddsArgs {
  event_id: string;
  bookmakers?: string;
  all_markets?: boolean;
}

const MAX_MARKETS = 40;

function bookmakersParam(input?: string): string | undefined {
  if (!input) return undefined;
  const keys = input.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = keys.filter((k) => !KEY.test(k));
  if (bad.length) throw new SockOddsError(`"${bad.join(", ")}" is not a bookmaker key. Keys are lower case, such as sportsbet, tab or betfair_exchange.`);
  if (keys.length > 20) throw new SockOddsError("Name at most 20 bookmakers.");
  return keys.join(",");
}

function renderMarket(m: MarketView): string[] {
  const out = [m.label];
  for (const s of m.sides) {
    const hasLines = s.quotes.some((q) => q.line !== undefined);
    const quotes = [...s.quotes].sort((a, b) => Number(b.available) - Number(a.available) || b.decimal - a.decimal);
    const line = hasLines ? chooseLine(s) : undefined;
    const best = selectBestPrice(s.quotes, { line }).best;
    const bestText = best.length
      ? `best ${formatDecimal(best[0].decimal)} at ${best.map(quoteName).join(" and ")}${line !== undefined ? ` (line ${formatLine(line, m.signed)})` : ""}`
      : "no available price";
    // Markets beyond the main four have no market and side shortcut in best_price, so give the outcome ID.
    const outcome = !m.kind ? (best[0] ?? quotes[0])?.outcomeID : undefined;
    out.push(`  ${s.label}: ${bestText}${outcome ? ` [outcome_id ${outcome}]` : ""}`);
    for (const q of quotes) out.push(`    ${quoteText(q, hasLines, m.signed)}`);
  }
  return out;
}

export async function getOdds(deps: ToolDeps, args: GetOddsArgs): Promise<string> {
  const bookmakers = bookmakersParam(args.bookmakers);
  const { ev, fetched } = await loadOdds(deps, args.event_id, {
    markets: args.all_markets ? undefined : MAIN_MARKET_KEYS.join(","),
    bookmakers,
  });
  const markets = groupMarkets(ev, { mainOnly: !args.all_markets });
  const lines = [...readLine(fetched, deps), "", ...eventHeader(ev, deps)];
  if ((ev.bookmakers ?? []).length === 0) {
    lines.push("", noPricesText(ev, bookmakers));
  } else if (markets.length === 0) {
    lines.push("", args.all_markets ? "No markets are priced on this event right now." : "No head to head, line or total markets are priced on this event right now. Try all_markets: true.");
  }
  for (const m of markets.slice(0, MAX_MARKETS)) lines.push("", ...renderMarket(m));
  if (markets.length > MAX_MARKETS) lines.push("", `${markets.length - MAX_MARKETS} more markets not shown.`);
  lines.push(...costLine(fetched, deps, objectsUsed(ev), "This answer"));
  lines.push("", "Prices are decimal odds, exactly as each bookmaker showed them, with the time SockOdds saw each one.", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- best_price

export interface BestPriceArgs {
  event_id: string;
  market?: MarketKind;
  side?: string;
  outcome_id?: string;
  line?: number;
}

/** Tennis and UFC name the two players competitor_1 and competitor_2 rather than home and away. */
const SIDE_ALIASES: Record<string, string> = { home: "competitor_1", away: "competitor_2", competitor_1: "home", competitor_2: "away" };

function pickSide(ev: OddsEvent, args: BestPriceArgs): { market: string; side: SideView; signed: boolean } {
  if (args.outcome_id) {
    for (const m of groupMarkets(ev, { mainOnly: false })) {
      for (const s of m.sides) {
        const quotes = s.quotes.filter((q) => q.outcomeID === args.outcome_id);
        if (quotes.length) return { market: m.label, side: { ...s, quotes }, signed: m.signed };
      }
    }
    throw new SockOddsError(`No bookmaker has a current price for outcome "${args.outcome_id}" on this event. Use get_odds with all_markets to see what is priced.`);
  }
  if (!args.market || !args.side) throw new SockOddsError("Give either outcome_id, or both market and side.");
  const m = findMarket(ev, args.market);
  if (!m) {
    const have = groupMarkets(ev).map((x) => x.kind).filter(Boolean);
    throw new SockOddsError(
      `No ${args.market} market is priced on this event right now.${have.length ? ` Available: ${[...new Set(have)].join(", ")}.` : ""}`,
    );
  }
  const side = m.sides.find((s) => s.side === args.side) ?? m.sides.find((s) => s.side === SIDE_ALIASES[args.side!]);
  if (!side) {
    throw new SockOddsError(`The ${m.label} market has no "${args.side}" side. Sides: ${m.sides.map((s) => `${s.side} (${s.label})`).join(", ")}.`);
  }
  return { market: m.label, side, signed: m.signed };
}

export async function bestPrice(deps: ToolDeps, args: BestPriceArgs): Promise<string> {
  if (args.outcome_id && !OUTCOME_ID.test(args.outcome_id)) {
    throw new SockOddsError(`"${args.outcome_id}" is not an outcome ID. Outcome IDs are oc_ followed by 16 letters and digits, as get_odds shows them with all_markets.`);
  }
  if (!args.outcome_id && (!args.market || !args.side)) throw new SockOddsError("Give either outcome_id, or both market and side.");
  const markets = args.outcome_id ? undefined : MARKET_KEYS[args.market!].join(",");
  const { ev, fetched } = await loadOdds(deps, args.event_id, { markets });
  const lines = [...readLine(fetched, deps), "", ...eventHeader(ev, deps)];
  if ((ev.bookmakers ?? []).length === 0) {
    lines.push("", noPricesText(ev), ...costLine(fetched, deps, objectsUsed(ev), "This answer"), "", RESPONSIBLE_GAMBLING);
    return finish(lines);
  }
  const { market, side, signed } = pickSide(ev, args);
  const line = chooseLine(side, args.line);
  const r = selectBestPrice(side.quotes, { line });
  const at = line !== undefined ? ` at line ${formatLine(line, signed)}` : "";
  lines.push("", `Best price: ${side.label}, ${market}${at}`);
  if (r.best.length === 0) {
    lines.push("  No bookmaker has this available right now.");
  } else {
    for (const q of r.best) lines.push(`  ${formatDecimal(q.decimal)} at ${quoteName(q)} (seen ${formatStamp(q.observedAt)})`);
    lines.push("", "The field (available prices, best first):");
    for (const q of r.field) lines.push(`  ${quoteText(q, line !== undefined, signed)}`);
  }
  if (r.excluded.length) {
    lines.push("", "Left out:");
    for (const q of r.excluded) lines.push(`  ${quoteText(q, q.line !== undefined, signed)} [${q.reason}]`);
  }
  lines.push(...costLine(fetched, deps, objectsUsed(ev), "This answer"));
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

function renderFair(r: FairResult, times?: Map<string, string | undefined>, names?: Map<string, string | undefined>): string[] {
  const lines: string[] = [];
  r.outcomes.forEach((o, i) => lines.push(`  ${o}: fair ${formatDecimal(r.fairDecimals[i])} (${pct(r.fairProbabilities[i])} chance)`));
  lines.push("", `Per bookmaker (margin, then its own no-vig prices):`);
  for (const b of r.books) {
    const when = times?.get(b.bookmakerID);
    lines.push(
      `  ${bookName(b.bookmakerID, names?.get(b.bookmakerID))}: margin ${pct(b.margin)}, ${b.fairDecimals.map((d) => formatDecimal(d)).join(" / ")}${when ? `, seen ${formatStamp(when)}` : ""}`,
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
  const { ev, fetched } = await loadOdds(deps, args.event_id, { markets: MARKET_KEYS[args.market].join(",") });
  if ((ev.bookmakers ?? []).length === 0) throw new SockOddsError(noPricesText(ev));
  const m = findMarket(ev, args.market);
  if (!m) throw new SockOddsError(`No ${args.market} market is priced on this event right now. Use get_odds to see what is.`);
  if (m.sides.length < 2 || m.sides.length > 3) {
    throw new SockOddsError(`The ${m.label} market has ${m.sides.length} side${m.sides.length === 1 ? "" : "s"} priced here; fair odds need a complete two- or three-way market.`);
  }
  const { line, outcomes, books } = bookMarketsAt(m, args.line);
  const r = consensusFairOdds(outcomes, books);
  const times = new Map<string, string | undefined>();
  const names = new Map<string, string | undefined>();
  for (const b of books) {
    const quotes = m.sides.flatMap((s) => s.quotes.filter((q) => q.bookmakerID === b.bookmakerID));
    times.set(b.bookmakerID, quotes.map((q) => q.observedAt ?? "").sort()[0] || undefined);
    names.set(b.bookmakerID, quotes[0]?.bookmakerName);
  }
  const at = line !== undefined ? ` at line ${formatLine(line, m.signed)}` : "";
  const lines = [
    ...readLine(fetched, deps),
    "",
    ...eventHeader(ev, deps),
    "",
    `No-vig fair odds: ${m.label}${at}, from ${r.books.length} bookmaker${r.books.length === 1 ? "" : "s"}`,
    METHOD,
    "",
    ...renderFair(r, times, names),
    ...costLine(fetched, deps, objectsUsed(ev), "This answer"),
    "",
    "SockOdds publishes each bookmaker's price as shown, margin included, so this fair price is worked out from those prices. It is an estimate of the chance, not a prediction or a tip.",
    RESPONSIBLE_GAMBLING,
  ];
  return finish(lines);
}
