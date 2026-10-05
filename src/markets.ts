/** Turn a SockOdds event into the handful of markets people ask about. Pure functions. */
import { americanToDecimal, type BookMarket, type Quote } from "./odds-math.js";
import type { Odds, SockEvent } from "./types.js";

export type MarketKind = "h2h" | "h2h_3way" | "line" | "total";
export const MARKET_KINDS: MarketKind[] = ["h2h", "h2h_3way", "line", "total"];

const BET_TYPE_BY_KIND: Record<MarketKind, string> = { h2h: "ml", h2h_3way: "ml3way", line: "sp", total: "ou" };
const KIND_BY_BET_TYPE: Record<string, MarketKind> = { ml: "h2h", ml3way: "h2h_3way", sp: "line", ou: "total" };
const MAIN_PERIODS = ["game", "reg"];
const SIDE_ORDER = ["home", "away", "draw", "over", "under", "yes", "no", "odd", "even"];

export interface SideView {
  oddID: string;
  sideID: string;
  label: string;
  quotes: Quote[];
  /** Consensus line across books (bookSpread / bookOverUnder), when the market has one. */
  consensusLine?: number;
  /** SockOdds' consensus price across books, as decimal. Includes the margin. */
  bookDecimal?: number;
  /** SockOdds' own sharp-sourced fair price, as decimal. Null on plans without fair odds. */
  fairDecimal?: number;
  fairLine?: number;
}

export interface MarketView {
  key: string;
  kind?: MarketKind;
  statID: string;
  periodID: string;
  betTypeID: string;
  label: string;
  sides: SideView[];
}

function num(s: string | number | null | undefined): number | undefined {
  if (s === null || s === undefined || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function teamName(ev: SockEvent, side: "home" | "away"): string {
  const t = ev.teams?.[side];
  return t?.names?.long || t?.names?.medium || t?.teamID || side;
}

export function eventTitle(ev: SockEvent): string {
  if (ev.teams?.home || ev.teams?.away) return `${teamName(ev, "home")} v ${teamName(ev, "away")}`;
  return ev.info?.displayName || ev.eventID;
}

export function eventStart(ev: SockEvent): string | undefined {
  return ev.status?.startsAt || ev.info?.commenceTime;
}

export function quotesFor(odds: Odds): Quote[] {
  const out: Quote[] = [];
  for (const [id, b] of Object.entries(odds.byBookmaker ?? {})) {
    const decimal = typeof b.decimal === "number" ? b.decimal : americanToDecimal(b.odds);
    if (decimal === undefined) continue;
    out.push({
      bookmakerID: b.bookmakerID || id,
      decimal,
      american: b.odds,
      line: num(b.spread ?? b.overUnder),
      available: b.available !== false,
      lastUpdatedAt: b.lastUpdatedAt,
      expiresAt: b.expiresAt,
      carriedFrom: b.carriedFrom,
    });
  }
  return out;
}

function isComboSide(sideID: string): boolean {
  return sideID.includes("+") || sideID.startsWith("not_");
}

function sideLabel(ev: SockEvent, o: Odds): string {
  const side = o.sideID ?? "";
  if ((side === "home" || side === "away") && ["ml", "ml3way", "sp"].includes(o.betTypeID ?? "")) return teamName(ev, side);
  if (side === "draw") return "Draw";
  if (side) return side.charAt(0).toUpperCase() + side.slice(1);
  return o.marketName || o.oddID || "?";
}

function marketLabel(kind: MarketKind | undefined, o: Odds, ev: SockEvent): string {
  const base =
    kind === "h2h"
      ? "Head to head"
      : kind === "h2h_3way"
        ? "Head to head (with the draw)"
        : kind === "line"
          ? "Line (handicap)"
          : kind === "total" && o.statEntityID !== "all" && (o.statEntityID === "home" || o.statEntityID === "away")
            ? `Team total: ${teamName(ev, o.statEntityID)}`
            : kind === "total"
              ? "Total points"
              : (o.marketName ?? o.oddID ?? "Market").replace(/\s[\u2013\u2014]\s.*$/, "");
  const period = o.periodID && o.periodID !== "game" ? ` [period: ${o.periodID}]` : "";
  return base + period;
}

/** Group key: one market holds every side of the same stat, period and bet type. */
function groupKey(o: Odds): string {
  const entity = ["ml", "ml3way", "sp"].includes(o.betTypeID ?? "") ? "match" : o.statEntityID;
  return [o.statID, entity, o.periodID, o.betTypeID].join("|");
}

export function isMainMarket(o: Odds): boolean {
  const kind = KIND_BY_BET_TYPE[o.betTypeID ?? ""];
  if (!kind || o.statID !== "points" || !MAIN_PERIODS.includes(o.periodID ?? "")) return false;
  if (isComboSide(o.sideID ?? "")) return false;
  if (kind === "total") return o.statEntityID === "all";
  return true;
}

export function groupMarkets(ev: SockEvent, opts: { mainOnly?: boolean } = {}): MarketView[] {
  const mainOnly = opts.mainOnly ?? true;
  const groups = new Map<string, MarketView>();
  for (const [oddID, o] of Object.entries(ev.odds ?? {})) {
    if (mainOnly && !isMainMarket(o)) continue;
    if (isComboSide(o.sideID ?? "")) continue;
    const key = groupKey(o);
    const kind = isMainMarket(o) ? KIND_BY_BET_TYPE[o.betTypeID ?? ""] : undefined;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        kind,
        statID: o.statID ?? "",
        periodID: o.periodID ?? "",
        betTypeID: o.betTypeID ?? "",
        label: marketLabel(kind, o, ev),
        sides: [],
      };
      groups.set(key, g);
    }
    g.sides.push({
      oddID: o.oddID || oddID,
      sideID: o.sideID ?? "",
      label: sideLabel(ev, o),
      quotes: quotesFor(o),
      consensusLine: num(o.bookSpread ?? o.bookOverUnder),
      bookDecimal: americanToDecimal(o.bookOdds),
      fairDecimal: americanToDecimal(o.fairOdds),
      fairLine: num(o.fairSpread ?? o.fairOverUnder),
    });
  }
  const rank = (s: string) => (SIDE_ORDER.indexOf(s) === -1 ? 99 : SIDE_ORDER.indexOf(s));
  const kindRank = (k?: MarketKind) => (k ? MARKET_KINDS.indexOf(k) : 99);
  const out = [...groups.values()];
  for (const g of out) g.sides.sort((a, b) => rank(a.sideID) - rank(b.sideID));
  out.sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      MAIN_PERIODS.indexOf(a.periodID) - MAIN_PERIODS.indexOf(b.periodID) ||
      a.key.localeCompare(b.key),
  );
  return out;
}

/** Find a main market of one kind, preferring the full game over regulation time. */
export function findMarket(ev: SockEvent, kind: MarketKind, periodID?: string): MarketView | undefined {
  const bt = BET_TYPE_BY_KIND[kind];
  const candidates = groupMarkets(ev, { mainOnly: true }).filter((m) => m.betTypeID === bt);
  if (periodID) return candidates.find((m) => m.periodID === periodID);
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
 * The line to compare prices at for one side. Uses the given line, else SockOdds'
 * consensus line, else the line most books quote. Undefined for markets without lines.
 */
export function chooseLine(side: SideView, requested?: number): number | undefined {
  if (requested !== undefined) return requested;
  const lines = side.quotes.map((q) => q.line).filter((l): l is number => l !== undefined);
  if (lines.length === 0) return undefined;
  if (side.consensusLine !== undefined) return side.consensusLine;
  return mode(side.quotes.filter((q) => q.available).map((q) => q.line).filter((l): l is number => l !== undefined)) ?? mode(lines);
}

/**
 * Each bookmaker's complete, open market at one line, ready for de-vigging.
 * `line` is the first side's line (the home team's line for a handicap, the total for over/under).
 * A handicap pairs home at L with away at -L; a total pairs over and under at the same L.
 */
export function bookMarketsAt(market: MarketView, line?: number): { line?: number; outcomes: string[]; books: BookMarket[] } {
  const sides = market.sides;
  const first = sides[0];
  const lineUsed = first ? chooseLine(first, line) : undefined;
  const lineForSide = (i: number): number | undefined => {
    if (lineUsed === undefined) return undefined;
    if (market.betTypeID === "sp" && i > 0) return lineUsed === 0 ? 0 : -lineUsed;
    return lineUsed;
  };
  const bookIDs = new Set(sides.flatMap((s) => s.quotes.map((q) => q.bookmakerID)));
  const books: BookMarket[] = [];
  for (const id of [...bookIDs].sort()) {
    const decimals: number[] = [];
    for (let i = 0; i < sides.length; i++) {
      const want = lineForSide(i);
      const q = sides[i].quotes.find(
        (x) => x.bookmakerID === id && x.available && (want === undefined || x.line === want),
      );
      if (!q) break;
      decimals.push(q.decimal);
    }
    if (decimals.length === sides.length) books.push({ bookmakerID: id, decimals });
  }
  return { line: lineUsed, outcomes: sides.map((s) => s.label), books };
}
