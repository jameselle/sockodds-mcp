/**
 * 1.3.0 tools on the SockOdds derived and analysis routes: +EV, middles, low holds, line moves, the closing
 * line, recorded price history and graded results. Same patterns as find_arbs in tools.ts.
 */
import { RESPONSIBLE_GAMBLING } from "./config.js";
import type { FullSource, Params } from "./client.js";
import { SockOddsError } from "./errors.js";
import { MAIN_MARKET_KEYS, MARKET_KEYS, eventTitle, type MarketKind } from "./markets.js";
import { bookName, formatDecimal, formatKickoff, formatLine, formatStamp, pct, signedPct } from "./format.js";
import {
  KEY,
  OUTCOME_ID,
  REGION_WORDS,
  bookmakersParam,
  checkEventID,
  creditsUsed,
  eventHeader,
  eventLabel,
  finish,
  isFresh,
  legSide,
  nowOf,
  readLine,
  readPages,
  regionBookmakers,
  resolveLeagueKey,
  subjectName,
  teamNames,
  utc,
  withPlan,
  type ArbRegion,
  type ToolDeps,
} from "./tools.js";
import type { ArbLeg, EvOpportunity, Fetched, HistoryChange, LineMove, MarketSubject, OpportunityEvent, PairOpportunity, Result, Verdict } from "./types.js";

export interface MoreDeps extends ToolDeps {
  source: FullSource;
}

/** Each page of a derived list costs this many credits however many entries it holds (an empty one costs none). */
const PAGE_CREDITS = 10;
/** Pages read at most per answer, so one question costs at most 30 credits. */
const MAX_PAGES = 3;
const PAGE_SIZE = 100;

export function marketsParam(input?: string): string | undefined {
  if (!input) return undefined;
  const keys = input.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = keys.filter((k) => !KEY.test(k));
  if (bad.length) throw new SockOddsError(`"${bad.join(", ")}" is not a market key. Keys are lower case, such as winner, handicap, total_points or player_points_over_under.`);
  if (keys.length > 20) throw new SockOddsError("Name at most 20 markets.");
  return keys.join(",");
}

function marketText(m: { name: string; period?: string; subject: MarketSubject | string }): string {
  const subject = subjectName(m.subject);
  const period = m.period && m.period !== "full" ? `, ${m.period.replace(/_/g, " ")}` : "";
  return `${m.name}${period}${subject ? `, ${subject}` : ""}`;
}

function startText(ev: OpportunityEvent, deps: ToolDeps): string {
  return formatKickoff(ev.scheduled_start ?? undefined, deps.timeZone);
}

function leagueText(league: string): string {
  return league.replace(/_/g, " ").toUpperCase();
}

function where(region: ArbRegion, what: string): string {
  return region === "all" ? `at any bookmaker your key can read` : `with ${what} at ${REGION_WORDS[region]} bookmakers`;
}

function creditLine(paid: number, extra = ""): string[] {
  return paid > 0 ? ["", `This answer used ${paid} credits (${PAGE_CREDITS} a page of up to ${PAGE_SIZE} entries${extra}).`] : [];
}

function regionLeftOut(leftOut: number, region: ArbRegion, what: string): string[] {
  if (region === "all" || leftOut <= 0) return [];
  return ["", `${leftOut} other ${what}${leftOut === 1 ? " was" : "s were"} left out because a price was at a bookmaker outside ${REGION_WORDS[region]} bookmakers.`];
}

interface ListArgs {
  league_id?: string;
  region?: ArbRegion;
  markets?: string;
  max_results?: number;
}

/** Shared body of the three derived lists: region filter, up to three pages, plan errors. */
async function derivedList<T extends { event: OpportunityEvent }>(
  deps: MoreDeps,
  args: ListArgs,
  load: (params: Params) => Promise<Fetched<T[]>>,
  params: Params,
  booksOf: (entry: T) => string[],
  plan: { what: string; feature: string },
) {
  const region = args.region ?? "au";
  const league = args.league_id ? resolveLeagueKey(args.league_id) : undefined;
  const markets = marketsParam(args.markets);
  const allowed = await regionBookmakers(deps, region);
  const { pages, all, moreUnread } = await withPlan(
    () => readPages((cursor) => load({ ...params, league, markets, limit: PAGE_SIZE, cursor }), MAX_PAGES),
    plan.what,
    plan.feature,
  );
  const kept = allowed ? all.filter((e) => booksOf(e).length > 0 && booksOf(e).every((b) => allowed.has(b))) : all;
  const shown = kept.slice(0, args.max_results ?? 10);
  return { region, league, pages, all, kept, shown, moreUnread, paid: creditsUsed(pages, deps, PAGE_CREDITS) };
}

// ---------------------------------------------------------------- find_ev

export interface FindEvArgs extends ListArgs {
  min_ev_pct?: number;
  fair_method?: "sharp_book" | "exchange" | "consensus";
}

function fairText(f: EvOpportunity["fair"]): string {
  switch (f.method) {
    case "sharp_book":
      return `from ${bookName(f.bookmaker ?? "sharp bookmaker")}'s own market with its margin removed`;
    case "exchange":
      return `from ${bookName(f.bookmaker ?? "exchange")}'s back and lay prices`;
    default:
      return `consensus of ${f.books} other bookmaker${f.books === 1 ? "" : "s"}, each with its margin removed${f.devig ? ` (${f.devig})` : ""}`;
  }
}

export async function findEv(deps: MoreDeps, args: FindEvArgs): Promise<string> {
  const r = await derivedList(
    deps,
    args,
    (p) => deps.source.ev(p),
    { min_edge: args.min_ev_pct, fair: args.fair_method },
    (e) => [e.bookmaker],
    { what: "positive EV prices", feature: "The +EV list" },
  );
  const lines = [...readLine(r.pages[0], deps), "", `Positive EV prices ${where(r.region, "the price")}${r.league ? `, ${r.league.toUpperCase()} only` : ""}:`];
  if (r.kept.length === 0) {
    lines.push(
      r.all.length === 0
        ? "  None listed right now. The list is recomputed about every four minutes, for upcoming events only."
        : `  None right now. SockOdds listed ${r.all.length} +EV price${r.all.length === 1 ? "" : "s"}, but each was at a bookmaker outside this region.`,
    );
  } else {
    lines.push(`Showing ${r.shown.length} of ${r.kept.length}, highest EV first.`, "");
    const teams = await teamNames(deps, r.shown);
    r.shown.forEach((e, i) => {
      const side = legSide(e.outcome, teams.get(e.event.id));
      lines.push(
        `${i + 1}. ${signedPct(e.ev_pct)} EV. ${eventLabel(e, teams.get(e.event.id))} (${leagueText(e.event.league)}), ${startText(e.event, deps)}`,
        `   Market: ${marketText(e.market)}`,
        `   Price: ${side} ${formatDecimal(e.decimal_odds)} at ${bookName(e.bookmaker, e.bookmaker_name)} (seen ${formatStamp(e.observed_at)})`,
        `   Fair price: ${formatDecimal(e.fair.decimal_odds)} (${pct(e.fair.probability)} chance), ${fairText(e.fair)}`,
      );
      if (e.kelly_pct !== null && e.kelly_pct !== undefined) lines.push(`   Full Kelly stake: ${e.kelly_pct.toFixed(2)}% of bankroll (many people stake a fraction of it)`);
      lines.push("");
    });
    lines.pop();
  }
  lines.push(...regionLeftOut(r.kept.length ? r.all.length - r.kept.length : 0, r.region, "+EV price"));
  if (r.moreUnread) lines.push("", `SockOdds has more +EV prices than the ${r.all.length} read here. Pass league_id or min_ev_pct to narrow the list.`);
  lines.push(
    "",
    "EV is the expected profit in percent of the stake, against the fair price. It is an estimate, not a guarantee: a fair price is a model of the market, any single bet can lose, and prices move. Bookmakers may limit accounts that take these prices often. Check each price at the bookmaker before acting.",
    ...creditLine(r.paid, "; the bookmaker list is free"),
    "",
    RESPONSIBLE_GAMBLING,
  );
  return finish(lines);
}

// ---------------------------------------------------------------- find_middles and find_low_holds

function pairLegs(p: PairOpportunity, teams?: Map<string, string>): string[] {
  return p.legs.map((leg: ArbLeg) => `   ${legSide(leg, teams)}: ${formatDecimal(leg.decimal_odds)} at ${bookName(leg.bookmaker, leg.bookmaker_name)} (seen ${formatStamp(leg.observed_at)})`);
}

export interface FindMiddlesArgs extends ListArgs {
  min_middle_pct?: number;
}

export async function findMiddles(deps: MoreDeps, args: FindMiddlesArgs): Promise<string> {
  const r = await derivedList(deps, args, (p) => deps.source.middles(p), { min_edge: args.min_middle_pct }, (e) => e.legs.map((l) => l.bookmaker), {
    what: "middles",
    feature: "The middles list",
  });
  const lines = [...readLine(r.pages[0], deps), "", `Middles ${where(r.region, "both bets")}${r.league ? `, ${r.league.toUpperCase()} only` : ""}:`];
  if (r.kept.length === 0) {
    lines.push(
      r.all.length === 0
        ? "  None listed right now. The list is recomputed about every four minutes, for upcoming events only."
        : `  None right now. SockOdds listed ${r.all.length} middle${r.all.length === 1 ? "" : "s"}, but each had a bet at a bookmaker outside this region.`,
    );
  } else {
    lines.push(`Showing ${r.shown.length} of ${r.kept.length}, largest middle profit first.`, "");
    const teams = await teamNames(deps, r.shown);
    r.shown.forEach((m, i) => {
      const t = teams.get(m.event.id);
      const gap = m.gap !== null && m.gap !== undefined ? `${m.gap} wide` : "gap not given";
      lines.push(`${i + 1}. Middle ${gap}. ${eventLabel(m, t)} (${leagueText(m.event.league)}), ${startText(m.event, deps)}`, `   Market: ${marketText(m.market)}`, ...pairLegs(m, t));
      const both = m.middle_profit_pct !== null && m.middle_profit_pct !== undefined ? `If the result lands in the gap both bets win: ${signedPct(m.middle_profit_pct)} of the total stake.` : "";
      const one = m.profit_pct !== null && m.profit_pct !== undefined ? `If only one wins: ${signedPct(m.profit_pct)}.` : "";
      const outcomeWords = [both, one].filter(Boolean).join(" ");
      if (outcomeWords) lines.push(`   ${outcomeWords}`);
      lines.push("");
    });
    lines.pop();
  }
  lines.push(...regionLeftOut(r.kept.length ? r.all.length - r.kept.length : 0, r.region, "middle"));
  if (r.moreUnread) lines.push("", `SockOdds has more middles than the ${r.all.length} read here. Pass league_id or min_middle_pct to narrow the list.`);
  lines.push(
    "",
    "A middle is two bets on different lines of one market at two bookmakers, so both win when the result lands between the lines. Most of the time only one wins, which usually loses a little. Check each price and line at the bookmaker before placing either bet.",
    ...creditLine(r.paid, "; the bookmaker list is free"),
    "",
    RESPONSIBLE_GAMBLING,
  );
  return finish(lines);
}

export interface FindLowHoldsArgs extends ListArgs {
  max_hold_pct?: number;
}

export async function findLowHolds(deps: MoreDeps, args: FindLowHoldsArgs): Promise<string> {
  const r = await derivedList(deps, args, (p) => deps.source.lowHolds(p), { max_hold: args.max_hold_pct }, (e) => e.legs.map((l) => l.bookmaker), {
    what: "low holds",
    feature: "The low holds list",
  });
  const lines = [...readLine(r.pages[0], deps), "", `Low-hold markets ${where(r.region, "both prices")}${r.league ? `, ${r.league.toUpperCase()} only` : ""}:`];
  if (r.kept.length === 0) {
    lines.push(
      r.all.length === 0
        ? "  None listed right now. The list is recomputed about every four minutes, for upcoming events only."
        : `  None right now. SockOdds listed ${r.all.length} low hold${r.all.length === 1 ? "" : "s"}, but each had a price at a bookmaker outside this region.`,
    );
  } else {
    lines.push(`Showing ${r.shown.length} of ${r.kept.length}, lowest hold first.`, "");
    const teams = await teamNames(deps, r.shown);
    r.shown.forEach((m, i) => {
      const t = teams.get(m.event.id);
      const hold = m.hold_pct !== undefined ? `Hold ${m.hold_pct.toFixed(2)}%` : "Hold not given";
      lines.push(`${i + 1}. ${hold}. ${eventLabel(m, t)} (${leagueText(m.event.league)}), ${startText(m.event, deps)}`, `   Market: ${marketText(m.market)}`, ...pairLegs(m, t), "");
    });
    lines.pop();
  }
  lines.push(...regionLeftOut(r.kept.length ? r.all.length - r.kept.length : 0, r.region, "low hold"));
  if (r.moreUnread) lines.push("", `SockOdds has more low holds than the ${r.all.length} read here. Pass league_id or max_hold_pct to narrow the list.`);
  lines.push(
    "",
    "The hold is the margin left when you take the best price on each side at two bookmakers (0% is break-even). A low hold is a tight market, not an arbitrage: backing both sides still loses the hold.",
    ...creditLine(r.paid, "; the bookmaker list is free"),
    "",
    RESPONSIBLE_GAMBLING,
  );
  return finish(lines);
}

// ---------------------------------------------------------------- line_moves

export interface LineMovesArgs {
  league_id: string;
  window_minutes?: number;
  min_books?: number;
  steam_only?: boolean;
  region?: ArbRegion;
  max_results?: number;
}

function signedFor(key: string): boolean {
  return /handicap|spread/.test(key);
}

export async function lineMoves(deps: MoreDeps, args: LineMovesArgs): Promise<string> {
  const league = resolveLeagueKey(args.league_id);
  const window = args.window_minutes ?? 60;
  if (window % 5 !== 0 || window < 5 || window > 360) throw new SockOddsError("window_minutes must be 5 to 360, in steps of 5.");
  const region = args.region ?? "au";
  const allowed = await regionBookmakers(deps, region);
  const fetched = await withPlan(
    () => deps.source.moves({ league, window, min_books: args.min_books, steam: args.steam_only ? true : undefined, limit: PAGE_SIZE }),
    "line moves",
    "Line moves",
  );
  const all = fetched.data;
  const kept = allowed ? all.filter((m) => m.moves.some((x) => allowed.has(x.bookmaker))) : all;
  const shown = kept.slice(0, args.max_results ?? 10);
  const lines = [
    ...readLine(fetched, deps),
    "",
    `Line moves in ${league.toUpperCase()} over the last ${window} minutes${args.steam_only ? " (steam only)" : ""}${region === "all" ? "" : `, where an ${REGION_WORDS[region]} bookmaker moved`}:`,
  ];
  if (kept.length === 0) {
    lines.push(
      all.length === 0
        ? "  None. Only lined markets (handicaps, totals, player and team over/unders) are covered, for upcoming events."
        : `  None at ${REGION_WORDS[region as Exclude<ArbRegion, "all">]} bookmakers. SockOdds listed ${all.length} move${all.length === 1 ? "" : "s"}, all at bookmakers outside this region.`,
    );
  } else {
    lines.push(`Showing ${shown.length} of ${kept.length}, steam first.`, "");
    const teams = await teamNames(deps, shown);
    shown.forEach((m: LineMove, i) => {
      const signed = signedFor(m.market.key);
      const tags = [m.steam ? "STEAM" : "", m.sharp ? "Pinnacle moved with the majority" : ""].filter(Boolean).join(", ");
      const whose = signed ? "home line" : "line";
      lines.push(
        `${i + 1}. ${tags ? `${tags}. ` : ""}${eventLabel(m, teams.get(m.event.id))} (${leagueText(m.event.league)}), ${startText(m.event, deps)}`,
        `   ${marketText(m.market)}: ${whose} ${formatLine(m.from_line, signed)} to ${formatLine(m.to_line, signed)} (median of the bookmakers that moved ${m.direction === "mixed" ? "the majority way" : m.direction}), ${m.books_moved} bookmaker${m.books_moved === 1 ? "" : "s"} moved (${m.books_up} up, ${m.books_down} down), ${formatStamp(m.first_move_at)} to ${formatStamp(m.last_move_at)}`,
      );
      const inRegion = allowed ? m.moves.filter((x) => allowed.has(x.bookmaker)) : m.moves;
      for (const x of inRegion) lines.push(`   ${bookName(x.bookmaker)} ${formatLine(x.from_line, signed)} to ${formatLine(x.to_line, signed)} (seen ${formatStamp(x.observed_at)})`);
      const others = m.moves.filter((x) => !inRegion.includes(x));
      if (others.length) lines.push(`   Also moved, outside this region: ${others.map((x) => `${bookName(x.bookmaker)} ${formatLine(x.from_line, signed)} to ${formatLine(x.to_line, signed)}`).join("; ")}`);
      lines.push("");
    });
    lines.pop();
  }
  if (fetched.next) lines.push("", `SockOdds has more moves than the ${all.length} read here. Pass steam_only or a shorter window_minutes to narrow the list.`);
  lines.push(
    "",
    "Steam: at least min_books bookmakers (3 unless set) moved the same way, and they were at least two thirds of the bookmakers that moved. Each bookmaker counts once, by its net move in the window. Lines are sampled every few minutes; head to head markets have no line and are not covered.",
  );
  if (isFresh(fetched, deps) && all.length > 0) lines.push("", `This answer used ${PAGE_CREDITS} credits; the bookmaker list is free.`);
  return finish(lines);
}

// ---------------------------------------------------------------- closing_line

export interface ClosingLineArgs {
  event_id: string;
  market?: MarketKind;
  region?: ArbRegion;
  bookmakers?: string;
  outcome_id?: string;
  odds?: number;
}

export async function closingLine(deps: MoreDeps, args: ClosingLineArgs): Promise<string> {
  const eventId = checkEventID(args.event_id);
  if ((args.outcome_id === undefined) !== (args.odds === undefined)) throw new SockOddsError("Give outcome_id and odds together to get the closing line value of a bet.");
  if (args.outcome_id && !OUTCOME_ID.test(args.outcome_id)) {
    throw new SockOddsError(`"${args.outcome_id}" is not an outcome ID. Outcome IDs are oc_ followed by 16 letters and digits, as get_odds shows them with all_markets and as this tool lists them.`);
  }
  const bookmakers = bookmakersParam(args.bookmakers);
  const region = bookmakers ? "all" : (args.region ?? "au");
  const allowed = await regionBookmakers(deps, region);
  const fetched = await withPlan(
    () => deps.source.closing(eventId, { markets: args.market ? MARKET_KEYS[args.market].join(",") : undefined, bookmakers, outcome_id: args.outcome_id, odds: args.odds }),
    "the closing line",
    "The closing line",
  );
  const ev = fetched.data;
  const lines = [...readLine(fetched, deps), "", ...eventHeader(ev, deps)];
  const markets = ev.markets ?? [];
  const anyClose = markets.some((m) => m.outcomes.some((o) => o.prices.some((p) => p.closing)));
  if (markets.length === 0) lines.push("", "No market on this event has recorded opening or closing prices.");
  else if (!anyClose) lines.push("", "The event has not started, so there are no closing prices or closing line value yet. Opening prices are shown.");
  let leftOut = 0;
  for (const m of markets.slice(0, 12)) {
    const signed = signedFor(m.key);
    const fair = m.closing_fair;
    const base = fair
      ? fair.source === "sharp_book"
        ? `from ${bookName(fair.bookmaker ?? "the sharp bookmaker")}'s closing market, margin ${pct(fair.overround - 1)} removed`
        : `consensus of ${fair.books} bookmakers' closing prices, margins removed`
      : "no fair closing price (no bookmaker closed the whole market)";
    lines.push("", `${marketText(m)}${m.alternate ? " (alternate line)" : ""}: fair closing price ${base}`);
    for (const o of m.outcomes) {
      const line = o.line !== null && o.line !== undefined ? ` ${formatLine(o.line, signed)}` : "";
      const fairText = o.closing_fair_decimal_odds ? `fair close ${formatDecimal(o.closing_fair_decimal_odds)} (${pct(o.closing_fair_probability ?? 1 / o.closing_fair_decimal_odds)} chance)` : "no fair close yet";
      lines.push(`  ${o.name}${line}: ${fairText} [outcome_id ${o.id}]`);
      const prices = allowed ? o.prices.filter((p) => allowed.has(p.bookmaker)) : o.prices;
      leftOut += o.prices.length - prices.length;
      for (const p of prices) {
        const opened = p.opening ? `opened ${formatDecimal(p.opening.decimal_odds)} (${formatStamp(p.opening.observed_at)})` : "no opening price";
        const closed = p.closing ? `closed ${formatDecimal(p.closing.decimal_odds)} (${formatStamp(p.closing.observed_at)})` : "no closing price yet";
        const clv = p.opening_clv_pct !== null && p.opening_clv_pct !== undefined ? `, opening price ${p.opening_clv_pct >= 0 ? "beat" : "missed"} the fair close by ${Math.abs(p.opening_clv_pct).toFixed(2)}%` : "";
        lines.push(`    ${bookName(p.bookmaker)}: ${opened}, ${closed}${clv}`);
      }
    }
  }
  if (markets.length > 12) lines.push("", `${markets.length - 12} more markets not shown. Pass market to pick one.`);
  if (leftOut > 0 && region !== "all") {
    lines.push("", `${leftOut} price${leftOut === 1 ? "" : "s"} at bookmakers outside ${REGION_WORDS[region]} bookmakers ${leftOut === 1 ? "was" : "were"} left out; the fair closing price still uses every bookmaker SockOdds read.`);
  }
  if (ev.bet) {
    const b = ev.bet;
    const name = markets.flatMap((m) => m.outcomes).find((o) => o.id === b.outcome_id)?.name ?? b.outcome_id;
    lines.push(
      "",
      b.clv_pct === null || b.clv_pct === undefined
        ? `Your bet: ${name} at ${formatDecimal(b.decimal_odds)}. There is no fair closing price yet, so no closing line value.`
        : `Your bet: ${name} at ${formatDecimal(b.decimal_odds)} against a fair closing price of ${formatDecimal(b.closing_fair_decimal_odds ?? undefined)}: closing line value ${signedPct(b.clv_pct)}, ${b.beat_close ? "it beat the close" : "it did not beat the close"}.`,
    );
  }
  lines.push(
    "",
    "Closing line value compares a price with the fair closing price: positive means the price was better than where the market closed. It says how good the price was, not whether the bet won.",
  );
  if (isFresh(fetched, deps) && markets.length > 0) lines.push("", `This answer used ${PAGE_CREDITS} credits.`);
  lines.push("", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- odds_history

export interface OddsHistoryArgs {
  event_id: string;
  market?: MarketKind;
  region?: ArbRegion;
  bookmakers?: string;
  hours?: number;
  to?: string;
}

const HISTORY_PAGE = 1000;
const HISTORY_PAGES = 3;

function priceAt(r: HistoryChange, signed: boolean): string {
  if (r.decimal_odds === null) return "withdrawn";
  return r.line !== null && r.line !== undefined ? `${formatLine(r.line, signed)} at ${formatDecimal(r.decimal_odds)}` : formatDecimal(r.decimal_odds);
}

/** One bookmaker's changes for one outcome, in order, as a single line. */
function historyLine(rows: HistoryChange[], signed: boolean): string {
  const first = rows[0], last = rows[rows.length - 1];
  const priced = rows.filter((r) => r.decimal_odds !== null);
  const opened = `${first.kind === "opened" ? "opened" : "first in window"} ${priceAt(first, signed)} (${formatStamp(first.observed_at)})`;
  const latest = rows.length === 1 ? "" : `, ${last.kind === "withdrawn" ? "withdrawn" : `latest ${priceAt(last, signed)}`} (${formatStamp(last.observed_at)})`;
  let range = "";
  if (priced.length > 1) {
    const hi = priced.reduce((a, b) => (b.decimal_odds! > a.decimal_odds! ? b : a));
    const lo = priced.reduce((a, b) => (b.decimal_odds! < a.decimal_odds! ? b : a));
    range = `, high ${priceAt(hi, signed)}, low ${priceAt(lo, signed)}`;
  }
  const changes = rows.length - 1;
  return `${opened}${latest}${range}, ${changes} change${changes === 1 ? "" : "s"}`;
}

export async function oddsHistory(deps: MoreDeps, args: OddsHistoryArgs): Promise<string> {
  const eventId = checkEventID(args.event_id);
  const hours = args.hours ?? 24;
  if (!(hours > 0 && hours <= 24)) throw new SockOddsError("hours must be more than 0 and at most 24: SockOdds reads history in windows of up to 24 hours.");
  const kind = args.market ?? "h2h";
  const bookmakers = bookmakersParam(args.bookmakers);
  const region = bookmakers ? "all" : (args.region ?? "au");
  const event = await deps.source.event(eventId);
  let end: number;
  if (args.to) {
    end = Date.parse(args.to);
    if (Number.isNaN(end)) throw new SockOddsError(`"${args.to}" is not a date and time. Give UTC, for example 2026-11-19T00:30:00Z.`);
  } else {
    // Up to the start, so a finished game shows its pre-match movement; up to now before the start.
    const start = Date.parse(event.data.scheduled_start ?? "");
    end = Math.min(nowOf(deps).getTime(), Number.isFinite(start) ? start : Infinity);
  }
  const from = new Date(end - hours * 3_600_000), to = new Date(end);
  const allowed = await regionBookmakers(deps, region);
  const { pages, all, moreUnread } = await withPlan(
    () =>
      readPages(
        (cursor) => deps.source.oddsHistory({ event_id: eventId, from: utc(from), to: utc(to), markets: MARKET_KEYS[kind].join(","), bookmakers, limit: HISTORY_PAGE, cursor }),
        HISTORY_PAGES,
      ),
    "recorded price history",
    "Recorded history",
    "paid",
  );
  const rows = allowed ? all.filter((r) => allowed.has(r.bookmaker)) : all;
  const lines = [...readLine(pages[0], deps), "", ...eventHeader(event.data, deps), "", `Price history, ${formatStamp(from.toISOString())} to ${formatStamp(to.toISOString())}${region === "all" ? "" : `, ${REGION_WORDS[region]} bookmakers`}:`];
  if (rows.length === 0) {
    lines.push(
      all.length === 0
        ? "  No price changes were recorded for this market in that window. Try another market, more hours or an earlier `to`. Recorded history starts on 8 October 2026 for most leagues (22 December 2025 at the earliest)."
        : `  None at bookmakers in this region. SockOdds recorded ${all.length} change${all.length === 1 ? "" : "s"} at other bookmakers; pass region all to see them.`,
    );
  }
  // market key | period | subject, then outcome, then bookmaker.
  const markets = new Map<string, { label: string; signed: boolean; outcomes: Map<string, { name: string; books: Map<string, HistoryChange[]> }> }>();
  for (const r of rows) {
    const mk = `${r.market.key}|${r.market.period}|${subjectName(r.market.subject) ?? ""}`;
    const m = markets.get(mk) ?? { label: marketText(r.market), signed: signedFor(r.market.key), outcomes: new Map() };
    markets.set(mk, m);
    const o = m.outcomes.get(r.outcome.side) ?? { name: r.outcome.name, books: new Map() };
    m.outcomes.set(r.outcome.side, o);
    o.books.set(r.bookmaker, [...(o.books.get(r.bookmaker) ?? []), r]);
  }
  for (const m of markets.values()) {
    lines.push("", m.label);
    for (const o of m.outcomes.values()) {
      lines.push(`  ${o.name}:`);
      const books = [...o.books.entries()].sort(([a], [b]) => a.localeCompare(b));
      for (const [book, list] of books.slice(0, 15)) {
        lines.push(`    ${bookName(book)}: ${historyLine([...list].sort((a, b) => a.observed_at.localeCompare(b.observed_at)), m.signed)}`);
      }
      if (books.length > 15) lines.push(`    ${books.length - 15} more bookmakers not shown. Pass bookmakers to pick them.`);
    }
  }
  if (rows.length > 0 && region !== "all" && all.length > rows.length) {
    const n = all.length - rows.length;
    lines.push("", `${n} change${n === 1 ? "" : "s"} at bookmakers outside this region ${n === 1 ? "was" : "were"} left out.`);
  }
  if (moreUnread) lines.push("", `SockOdds has more changes in this window than the ${all.length} read here. Pass bookmakers or fewer hours to narrow it.`);
  lines.push("", "Only changes are recorded: a bookmaker showing the same price again adds nothing, and a gap means no observation, not a missing price.");
  if (pages.some((p) => isFresh(p, deps) && p.data.length > 0)) {
    lines.push("", "Recorded history is charged at 10 times the live price: 10 credits for each market returned, per 10 bookmakers.");
  }
  lines.push("", RESPONSIBLE_GAMBLING);
  return finish(lines);
}

// ---------------------------------------------------------------- get_results

export interface GetResultsArgs {
  event_id?: string;
  league_id?: string;
  days_back?: number;
  max_results?: number;
}

const VERDICT_WORDS: Record<Verdict, string> = {
  won: "won",
  lost: "lost",
  void: "void (stake returned)",
  dead_heat: "dead heat",
  half_won: "half won (half the stake won, half returned)",
  half_lost: "half lost (half the stake returned, half lost)",
};

function scoreLine(r: Result): string | undefined {
  const periods = r.box_score?.periods ?? [];
  if (!periods.length) return undefined;
  const full = periods.find((p) => p.period === "full");
  const counted = full ? [full] : periods.filter((p) => !p.void);
  const home = counted.reduce((a, p) => a + (p.home ?? 0), 0);
  const away = counted.reduce((a, p) => a + (p.away ?? 0), 0);
  if (!counted.some((p) => p.home !== undefined || p.away !== undefined)) return undefined;
  const name = (role: string) => r.event.participants?.find((p) => p.role === role)?.identity.name;
  return `Score: ${name("home") ?? name("competitor_1") ?? "Home"} ${home}, ${name("away") ?? name("competitor_2") ?? "Away"} ${away}`;
}

function outcomeText(o: Result["outcomes"][number]): string {
  const signed = signedFor(o.market.key);
  const line = o.line !== null && o.line !== undefined ? ` ${formatLine(o.line, signed)}` : "";
  const words = o.verdict === "dead_heat" && o.dead_heat_factor ? `dead heat (paid at ${o.dead_heat_factor} of the stake)` : VERDICT_WORDS[o.verdict];
  return `${o.name}${line} ${words}`;
}

export async function getResults(deps: MoreDeps, args: GetResultsArgs): Promise<string> {
  if (!args.event_id && !args.league_id) throw new SockOddsError("Give event_id (from find_event) or league_id (for example nba, nfl, afl or nrl).");
  const eventId = args.event_id ? checkEventID(args.event_id) : undefined;
  const league = args.league_id ? resolveLeagueKey(args.league_id) : undefined;
  const days = args.days_back ?? 3;
  const now = nowOf(deps);
  const params: Params = eventId
    ? { event_id: eventId, league }
    : { league, starts_after: utc(new Date(now.getTime() - days * 86_400_000)), starts_before: utc(now), limit: 25 };
  const fetched = await deps.source.results(params);
  const results = [...fetched.data].sort((a, b) => (b.event.scheduled_start ?? "").localeCompare(a.event.scheduled_start ?? ""));
  const shown = results.slice(0, args.max_results ?? 10);
  const scope = eventId ? "this event" : `${league!.toUpperCase()} events that started in the last ${days} day${days === 1 ? "" : "s"}`;
  const lines = [...readLine(fetched, deps), "", `Results for ${scope}:`];
  if (results.length === 0) {
    lines.push(
      eventId
        ? "  No result yet. Results are published once official sources settle a market; events SockOdds never priced have none."
        : "  None. Try more days_back, or check the league key with list_leagues.",
    );
  }
  shown.forEach((r, i) => {
    lines.push("", `${i + 1}. ${eventTitle(r.event)} (${r.event.league?.name ?? r.event.league?.key ?? "?"}), ${formatKickoff(r.event.scheduled_start, deps.timeZone)}`);
    const score = scoreLine(r);
    if (score) lines.push(`   ${score}`);
    lines.push(
      `   ${r.status === "corrected" ? "Corrected result" : "Final"}, ${r.settlement === "complete" ? "every market settled" : `${r.pending_markets} market${r.pending_markets === 1 ? "" : "s"} still pending`} (settled ${formatStamp(r.settled_at)}). Event ID: ${r.event.id}`,
    );
    const main = r.outcomes.filter((o) => o.market.subject === null && ["full", "regulation"].includes(o.market.period) && MAIN_MARKET_KEYS.includes(o.market.key));
    const rest = r.outcomes.filter((o) => !main.includes(o));
    const byMarket = new Map<string, Result["outcomes"]>();
    for (const o of eventId ? [...main, ...rest] : main) {
      if (o.verdict === "lost") continue;
      const label = marketText(o.market);
      byMarket.set(label, [...(byMarket.get(label) ?? []), o]);
    }
    let printed = 0;
    for (const [label, outs] of byMarket) {
      if (printed >= 30) break;
      lines.push(`   ${label}: ${outs.map(outcomeText).join("; ")}`);
      printed++;
    }
    if (byMarket.size > printed) lines.push(`   ${byMarket.size - printed} more markets not shown.`);
    if (!eventId && rest.length) lines.push(`   ${rest.length} more graded outcome${rest.length === 1 ? "" : "s"} in other markets (players, periods). Ask with event_id ${r.event.id} to see them.`);
  });
  if (results.length > shown.length) lines.push("", `${results.length - shown.length} more results not shown. Pass max_results or fewer days_back.`);
  if (fetched.next) lines.push("", "SockOdds has more results than one page. Pass fewer days_back to narrow it.");
  lines.push("", "Results are graded from official sources only. A market not shown is not settled yet, never a loss. Only winning (or void) outcomes are listed; every other outcome in those markets lost.");
  if (isFresh(fetched, deps) && fetched.data.length > 0) lines.push("", `This answer used ${eventId ? 1 : 2} credit${eventId ? "" : "s"}.`);
  return finish(lines);
}
