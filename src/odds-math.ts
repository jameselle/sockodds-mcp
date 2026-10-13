/** Pure odds maths. No I/O, so every function here is unit tested. */

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Implied probability of decimal odds, including the bookmaker's margin. */
export function impliedProbability(decimal: number): number {
  if (!(decimal > 1)) throw new RangeError(`Decimal odds must be greater than 1, got ${decimal}`);
  return 1 / decimal;
}

export interface Devigged {
  /** Sum of the implied probabilities. 1.05 means a 5% margin. */
  overround: number;
  /** Margin as a fraction: overround minus 1. */
  margin: number;
  fairProbabilities: number[];
  fairDecimals: number[];
}

/**
 * Remove the margin from one bookmaker's complete market (every outcome, same line)
 * with the proportional (multiplicative) method: divide each implied probability by
 * their sum so the outcomes add up to exactly 100%.
 */
export function devigProportional(decimals: number[]): Devigged {
  if (decimals.length < 2 || decimals.length > 3) {
    throw new RangeError(`Need the prices for every outcome of a two- or three-way market, got ${decimals.length}`);
  }
  const implied = decimals.map(impliedProbability);
  const overround = implied.reduce((a, b) => a + b, 0);
  const fairProbabilities = implied.map((p) => p / overround);
  return {
    overround,
    margin: overround - 1,
    fairProbabilities,
    fairDecimals: fairProbabilities.map((p) => 1 / p),
  };
}

export interface BookMarket {
  bookmakerID: string;
  /** Decimal prices in the same outcome order as `outcomes`. */
  decimals: number[];
}

export interface FairResult {
  outcomes: string[];
  /** Mean of each book's no-vig probability, per outcome. Sums to 1. */
  fairProbabilities: number[];
  fairDecimals: number[];
  books: Array<{ bookmakerID: string; margin: number; fairDecimals: number[] }>;
  /** Overround of the best available price on each outcome across all books. Below 1 means the best prices beat each other. */
  bestPriceOverround?: number;
}

/**
 * Consensus fair price: de-vig each bookmaker that prices every outcome, then average
 * those no-vig probabilities across bookmakers (equal weight) and convert back to odds.
 * Books missing an outcome are skipped.
 */
export function consensusFairOdds(outcomes: string[], books: BookMarket[]): FairResult {
  if (outcomes.length < 2 || outcomes.length > 3) {
    throw new RangeError("fair odds need a two- or three-way market");
  }
  const complete = books.filter((b) => b.decimals.length === outcomes.length && b.decimals.every((d) => d > 1));
  if (complete.length === 0) {
    throw new RangeError("No bookmaker prices every outcome of this market at the same line, so a fair price cannot be worked out.");
  }
  const perBook = complete.map((b) => ({ bookmakerID: b.bookmakerID, d: devigProportional(b.decimals) }));
  const fairProbabilities = outcomes.map(
    (_, i) => perBook.reduce((sum, b) => sum + b.d.fairProbabilities[i], 0) / perBook.length,
  );
  const bestEach = outcomes.map((_, i) => Math.max(...complete.map((b) => b.decimals[i])));
  return {
    outcomes,
    fairProbabilities,
    fairDecimals: fairProbabilities.map((p) => 1 / p),
    books: perBook.map((b) => ({ bookmakerID: b.bookmakerID, margin: b.d.margin, fairDecimals: b.d.fairDecimals })),
    bestPriceOverround: bestEach.reduce((s, d) => s + 1 / d, 0),
  };
}

export interface Quote {
  /** Bookmaker key, such as `sportsbet`. */
  bookmakerID: string;
  /** Bookmaker display name from the response, when known. */
  bookmakerName?: string;
  decimal: number;
  /** This outcome's own line (a handicap or a total). Undefined when the market has no line. */
  line?: number;
  available: boolean;
  /** When SockOdds saw this price at the bookmaker (`observed_at`, UTC). */
  observedAt?: string;
  /** The outcome id (`oc_...`), the same at every bookmaker for the same market, line and side. */
  outcomeID?: string;
}

export interface BestPrice {
  /** Every quote tied on the top price (usually one). Empty when nothing is open. */
  best: Quote[];
  /** Every open quote at the chosen line, best first. */
  field: Quote[];
  /** Quotes left out because they were not available or at another line. */
  excluded: Array<Quote & { reason: string }>;
}

/**
 * Pick the highest decimal price among quotes that are available and, when a line is
 * given, at exactly that line. SockOdds already withholds prices it has not seen for
 * ten minutes, so there is no expiry check here.
 */
export function selectBestPrice(quotes: Quote[], opts: { line?: number } = {}): BestPrice {
  const field: Quote[] = [];
  const excluded: BestPrice["excluded"] = [];
  for (const q of quotes) {
    if (!q.available) excluded.push({ ...q, reason: "not available" });
    else if (!(q.decimal > 1)) excluded.push({ ...q, reason: "no price" });
    else if (opts.line !== undefined && q.line !== opts.line) excluded.push({ ...q, reason: "different line" });
    else field.push(q);
  }
  field.sort((a, b) => b.decimal - a.decimal || a.bookmakerID.localeCompare(b.bookmakerID));
  const top = field[0]?.decimal;
  return { best: field.filter((q) => q.decimal === top), field, excluded };
}
