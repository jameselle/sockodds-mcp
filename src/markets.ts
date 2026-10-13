/** Turn a SockOdds v1 event's prices into the handful of markets people ask about. Pure functions. */
import type { BookMarket, Quote } from "./odds-math.js";
import type { OddsEvent, QuotedMarket, SockEvent } from "./types.js";

export type MarketKind = "h2h" | "h2h_3way" | "line" | "total";
export const MARKET_KINDS: MarketKind[] = ["h2h", "h2h_3way", "line", "total"];

/**
 * v1 market keys behind each kind, from the market catalogue (https://sockodds.com/docs/markets/).
 * A sport has one main total: points (football codes, basketball), goals (soccer, ice hockey),
 * runs (baseball), games (tennis), rounds (UFC) or maps (esports). AFL prices both points and
 * goals totals; points comes first.
 */
export const MARKET_KEYS: Record<MarketKind, string[]> = {
  h2h: ["winner"],
  h2h_3way: ["result"],
  line: ["handicap"],
  total: ["total_points", "total_goals", "total_runs", "total_games", "total_rounds", "total_maps"],
};

/** Every main market key, for the `markets` filter (at most 20 keys). */
export const MAIN_MARKET_KEYS: string[] = MARKET_KINDS.flatMap((k) => MARKET_KEYS[k]);

/** Whole-game periods, best first: `full` includes extra time, `regulation` does not. */
const MAIN_PERIODS = ["full", "regulation"];
const SIDE_ORDER = ["home", "competitor_1", "away", "competitor_2", "draw", "over", "under", "yes", "no", "odd", "even"];

export interface SideView {
  /** The outcome's side key: home, away, draw, over, under, competitor_1, ... */
  side: string;
  label: string;
  quotes: Quote[];
}

export interface MarketView {
  /** market key | subject | period */
  groupKey: string;
  kind?: MarketKind;
  /** v1 market key, such as `winner` or `handicap`. */
  key: string;
  period: string;
  /** True for a handicap, whose lines carry a sign (home -6.5 pairs with away +6.5). */
  signed: boolean;
  label: string;
  sides: SideView[];
}

function kindOf(m: QuotedMarket): MarketKind | undefined {
  if (m.subject !== null || !MAIN_PERIODS.includes(m.period)) return undefined;
  return MARKET_KINDS.find((k) => MARKET_KEYS[k].includes(m.key));
}

export function eventTitle(ev: SockEvent): string {
  if (ev.name) return ev.name;
  const byRole = (role: string) => ev.participants?.find((p) => p.role === role)?.identity.name;
  const first = byRole("home") ?? byRole("competitor_1");
  const second = byRole("away") ?? byRole("competitor_2");
  return first && second ? `${first} v ${second}` : ev.id;
}

export function eventStart(ev: SockEvent): string | undefined {
  return ev.scheduled_start;
}

function subjectLabel(m: QuotedMarket): string {
  return m.subject ? m.subject.name : "";
}

function marketLabel(kind: MarketKind | undefined, m: QuotedMarket): string {
  const base =
    kind === "h2h"
      ? "Head to head"
      : kind === "h2h_3way"
        ? "Head to head (with the draw)"
        : kind === "line"
          ? "Line (handicap)"
          : kind === "total"
            ? m.name
            : `${m.name}${m.subject ? `: ${subjectLabel(m)}` : ""}`;
  const period = m.period !== "full" ? ` [period: ${m.period}]` : "";
  return base + period;
}

function groupKeyOf(m: QuotedMarket): string {
  const subject = m.subject ? ("key" in m.subject ? m.subject.key : m.subject.id) : "event";
  return [m.key, subject, m.period].join("|");
}

/**
 * Line the bookmakers' markets up by market type, subject and period, with one side per outcome
 * side and one quote per bookmaker and line. Outcomes without a current price are skipped.
 */
export function groupMarkets(ev: OddsEvent, opts: { mainOnly?: boolean } = {}): MarketView[] {
  const mainOnly = opts.mainOnly ?? true;
  const groups = new Map<string, MarketView>();
  for (const book of ev.bookmakers ?? []) {
    for (const m of book.markets ?? []) {
      const kind = kindOf(m);
      if (mainOnly && !kind) continue;
      const key = groupKeyOf(m);
      let g = groups.get(key);
      if (!g) {
        g = { groupKey: key, kind, key: m.key, period: m.period, signed: m.key === "handicap", label: marketLabel(kind, m), sides: [] };
        groups.set(key, g);
      }
      for (const o of m.outcomes ?? []) {
        if (typeof o.decimal_odds !== "number") continue;
        let side = g.sides.find((s) => s.side === o.side);
        if (!side) {
          side = { side: o.side, label: o.name || o.side, quotes: [] };
          g.sides.push(side);
        }
        side.quotes.push({
          bookmakerID: o.bookmaker || book.key,
          bookmakerName: book.name,
          decimal: o.decimal_odds,
          line: typeof o.line === "number" ? o.line : undefined,
          available: o.available !== false,
          observedAt: o.observed_at,
          outcomeID: o.id,
        });
      }
    }
  }
  const rank = (s: string) => (SIDE_ORDER.indexOf(s) === -1 ? 99 : SIDE_ORDER.indexOf(s));
  const kindRank = (k?: MarketKind) => (k ? MARKET_KINDS.indexOf(k) : 99);
  const keyRank = (g: MarketView) => (g.kind ? MARKET_KEYS[g.kind].indexOf(g.key) : 0);
  const periodRank = (p: string) => (MAIN_PERIODS.indexOf(p) === -1 ? 9 : MAIN_PERIODS.indexOf(p));
  const out = [...groups.values()].filter((g) => g.sides.length > 0);
  for (const g of out) g.sides.sort((a, b) => rank(a.side) - rank(b.side) || a.label.localeCompare(b.label));
  out.sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      keyRank(a) - keyRank(b) ||
      periodRank(a.period) - periodRank(b.period) ||
      a.groupKey.localeCompare(b.groupKey),
  );
  return out;
}

/** Find a main market of one kind, preferring the full game over regulation time. */
export function findMarket(ev: OddsEvent, kind: MarketKind, period?: string): MarketView | undefined {
  const candidates = groupMarkets(ev, { mainOnly: true }).filter((m) => m.kind === kind);
  if (period) return candidates.find((m) => m.period === period);
  return candidates[0];
}

/** Most common value, ties broken by the smallest absolute value. */
function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | undefined;
  for (const [v, c] of counts) {
    const bc = best === undefined ? -1 : counts.get(best)!;
    if (c > bc || (c === bc && Math.abs(v) < Math.abs(best!))) best = v;
  }
  return best;
}

/**
 * The line to compare prices at for one side: the given line, else the line most bookmakers
 * quote right now. Undefined for markets without lines.
 */
export function chooseLine(side: SideView, requested?: number): number | undefined {
  if (requested !== undefined) return requested;
  const lines = side.quotes.map((q) => q.line).filter((l): l is number => l !== undefined);
  if (lines.length === 0) return undefined;
  return mode(side.quotes.filter((q) => q.available).map((q) => q.line).filter((l): l is number => l !== undefined)) ?? mode(lines);
}

/**
 * Each bookmaker's complete, available market at one line, ready for de-vigging.
 * `line` is the first side's line (the home side's line for a handicap, the total for over/under).
 * A handicap pairs home at L with away at -L; a total pairs over and under at the same L.
 */
export function bookMarketsAt(market: MarketView, line?: number): { line?: number; outcomes: string[]; books: BookMarket[] } {
  const sides = market.sides;
  const first = sides[0];
  const lineUsed = first ? chooseLine(first, line) : undefined;
  const lineForSide = (i: number): number | undefined => {
    if (lineUsed === undefined) return undefined;
    if (market.signed && i > 0) return lineUsed === 0 ? 0 : -lineUsed;
    return lineUsed;
  };
  const bookIDs = new Set(sides.flatMap((s) => s.quotes.map((q) => q.bookmakerID)));
  const books: BookMarket[] = [];
  for (const id of [...bookIDs].sort()) {
    const decimals: number[] = [];
    for (let i = 0; i < sides.length; i++) {
      const want = lineForSide(i);
      const q = sides[i].quotes.find((x) => x.bookmakerID === id && x.available && (want === undefined || x.line === want));
      if (!q) break;
      decimals.push(q.decimal);
    }
    if (decimals.length === sides.length) books.push({ bookmakerID: id, decimals });
  }
  return { line: lineUsed, outcomes: sides.map((s) => s.label), books };
}

/** Objects a response uses: one for the event, plus one per priced outcome (https://sockodds.com/docs/limits/). */
export function objectsUsed(ev: OddsEvent): number {
  let outcomes = 0;
  for (const b of ev.bookmakers ?? []) for (const m of b.markets ?? []) outcomes += (m.outcomes ?? []).length;
  return 1 + outcomes;
}
