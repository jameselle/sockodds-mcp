/**
 * The parts of the SockOdds API v1 schema this server reads, with the contract's own field names.
 * Source: https://sockodds.com/openapi.json (SockOdds API 1.0.0). See docs/API-NOTES.md.
 */

/** Every successful v1 response: `{ data, meta, links }`. */
export interface Envelope<T> {
  data: T;
  meta?: { count: number; cursor: string | null };
  links?: { next: string | null };
}

/** An error body (`application/problem+json`). */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
}

export interface NamedKey {
  key: string;
  name: string;
}

export interface League {
  key: string;
  name: string;
  sport?: string;
  region?: string;
}

/** A team is a NamedKey; a tennis player or fighter is `{ id, name }`. */
export type Identity = { key: string; name: string } | { id: string; name: string };

export type Role = "home" | "away" | "competitor_1" | "competitor_2";

export interface Participant {
  role: Role;
  identity: Identity;
}

export type EventStatus = "scheduled" | "live" | "final" | "postponed" | "cancelled";

export interface SockEvent {
  id: string;
  name: string;
  league: NamedKey;
  scheduled_start: string;
  status: EventStatus;
  participants: Participant[];
}

export interface Outcome {
  id: string;
  name: string;
  /** home, away, draw, over, under, yes, no, competitor_1, competitor_2, or a player id. */
  side: string;
  /** The outcome's own line (home -6.5 pairs with away 6.5). Null when the market has no line. */
  line: number | null;
  decimal_odds: number | null;
  implied_probability: number | null;
  available?: boolean;
  alternate: boolean;
  bookmaker: string;
  observed_at: string;
}

export interface QuotedMarket {
  /** Built from the event, market type, subject, period and line, so it is the same at every bookmaker. */
  id: string;
  key: string;
  name: string;
  subject: null | { key: string; name: string } | { id: string; name: string };
  period: string;
  outcomes: Outcome[];
}

export interface QuotedBookmaker {
  key: string;
  name: string;
  markets: QuotedMarket[];
}

/** One bookmaker's price in a market-grouped response (the API default from 14 Oct 2026). */
export interface Price {
  bookmaker: string;
  decimal_odds: number | null;
  implied_probability: number | null;
  available?: boolean;
  observed_at: string;
}

export interface PricedOutcome {
  id: string;
  name: string;
  side: string;
  line: number | null;
  /** Best first: prices[0] is the best price among the bookmakers asked for. */
  prices: Price[];
}

export interface PricedMarket {
  id: string;
  key: string;
  name: string;
  period: string;
  subject: QuotedMarket["subject"];
  /** True when this line is not the market's main line. */
  alternate: boolean;
  outcomes: PricedOutcome[];
}

/**
 * Prices for one event. The API groups them by market (`markets`); with `group_by=bookmaker` (and in
 * 1.0.x) by bookmaker (`bookmakers`). The client turns either into `bookmakers` for the tools.
 */
export interface OddsEvent extends SockEvent {
  bookmakers?: QuotedBookmaker[];
  markets?: PricedMarket[];
}

/** The result of one API call, with the moment it was read. */
export interface Fetched<T> {
  data: T;
  /** `links.next`: set when there is another page. */
  next?: string | null;
  fetchedAt: string;
  source: "live" | "demo";
  /** Objects this answer also used on a lookup it needed (the bookmaker catalogue, read once). */
  extraObjects?: number;
}

/** GET /v1/bookmakers: a bookmaker in the catalogue, with where it operates. */
export interface Bookmaker {
  key: string;
  name: string;
  kind?: "sportsbook" | "exchange" | "prediction_market";
  /** Region keys such as au, us or intl (https://sockodds.com/bookmakers/). */
  regions?: string[];
}

/** One bet of an arbitrage pair (GET /v1/opportunities/arbs, https://sockodds.com/docs/opportunities/). */
export interface ArbLeg {
  market_id: string;
  outcome_id: string;
  /** home, away, draw, over, under, yes, no, competitor_1, competitor_2. */
  side: string;
  line: number | null;
  bookmaker: string;
  bookmaker_name?: string;
  decimal_odds: number;
  implied_probability?: number;
  stake_pct?: number | null;
  observed_at: string;
}

/** An arbitrage pair: two prices at two bookmakers that cover one market for a profit either way. */
export interface Arb {
  id: string;
  type: string;
  event: { id: string; name: string | null; league: string; scheduled_start: string | null };
  market: { key: string; name: string; period?: string; subject: null | string | { name?: string } };
  legs: ArbLeg[];
  implied_sum: number;
  profit_pct: number;
  price_age_seconds?: number;
  computed_at?: string;
  expires_at?: string;
}

// ---------------------------------------------------------------- 1.3.0: derived endpoints, history, results, racing

/** A market or player a derived entry is about: null for a game market. */
export type MarketSubject = null | { key: string; name: string } | { id: string; name: string };

/** The event of a derived entry (opportunities and line moves). */
export interface OpportunityEvent {
  id: string;
  name: string | null;
  league: string;
  scheduled_start: string | null;
}

/** GET /v1/opportunities/middles and /v1/opportunities/low-holds: a pair of prices at two bookmakers. */
export interface PairOpportunity {
  id: string;
  type: "arbitrage" | "low_hold" | "middle";
  event: OpportunityEvent;
  market: { key: string; name: string; period: string; subject: MarketSubject };
  legs: ArbLeg[];
  implied_sum: number;
  profit_pct?: number | null;
  hold_pct?: number;
  gap?: number | null;
  middle_profit_pct?: number | null;
  price_age_seconds: number;
  computed_at: string | null;
  expires_at: string | null;
}

/** GET /v1/opportunities/ev: one bookmaker price longer than the outcome's fair price. */
export interface EvOpportunity {
  id: string;
  type: "positive_ev";
  event: OpportunityEvent;
  market: { id: string; key: string; name: string; period: string; subject: MarketSubject };
  outcome: { id: string; side: string; line: number | null };
  bookmaker: string;
  bookmaker_name: string;
  decimal_odds: number;
  implied_probability: number;
  fair: {
    probability: number;
    decimal_odds: number;
    method: "sharp_book" | "exchange" | "consensus";
    bookmaker: string | null;
    devig: string | null;
    books: number;
  };
  ev_pct: number;
  kelly_pct: number | null;
  observed_at: string;
  price_age_seconds: number;
  computed_at: string | null;
  expires_at: string | null;
}

/** GET /v1/moves: a market whose main line moved at one or more bookmakers. */
export interface LineMove {
  id: string;
  event: OpportunityEvent;
  market: { key: string; name: string; period: string; subject: MarketSubject };
  direction: "up" | "down" | "mixed";
  steam: boolean;
  sharp: boolean;
  books_moved: number;
  books_up: number;
  books_down: number;
  from_line: number;
  to_line: number;
  first_move_at: string;
  last_move_at: string;
  moves: Array<{ bookmaker: string; from_line: number; to_line: number; observed_at: string }>;
}

/** A price at one moment: an opening or closing snapshot. */
export interface PriceSnapshot {
  decimal_odds: number;
  implied_probability: number;
  observed_at: string;
}

/** GET /v1/events/{event_id}/closing: opening and closing prices, the fair closing price and CLV. */
export interface ClosingEvent extends SockEvent {
  markets: Array<{
    id: string;
    key: string;
    name: string;
    period: string;
    subject: MarketSubject;
    alternate: boolean;
    closing_fair: null | { source: "sharp_book" | "consensus"; bookmaker: string | null; devig: string; books: number; overround: number };
    outcomes: Array<{
      id: string;
      name: string;
      side: string;
      line: number | null;
      closing_fair_probability: number | null;
      closing_fair_decimal_odds: number | null;
      prices: Array<{ bookmaker: string; opening: PriceSnapshot | null; closing: PriceSnapshot | null; opening_clv_pct: number | null }>;
    }>;
  }>;
  bet?: { outcome_id: string; decimal_odds: number; closing_fair_decimal_odds: number | null; clv_pct: number | null; beat_close: boolean | null };
}

/** GET /v1/odds/history: one recorded price change. */
export interface HistoryChange {
  event: string;
  market: { id: string; key: string; name: string; period: string; subject: MarketSubject };
  outcome: { id: string; name: string; side: string };
  bookmaker: string;
  observed_at: string;
  kind: "opened" | "changed" | "withdrawn";
  decimal_odds: number | null;
  implied_probability?: number | null;
  line?: number | null;
}

export type Verdict = "won" | "lost" | "void" | "dead_heat" | "half_won" | "half_lost";

/** GET /v1/results: one finished event's graded outcomes. Only the box score's period scores are read. */
export interface Result {
  event: SockEvent;
  box_score?: null | { revision?: number; periods?: Array<{ period: string; completed?: boolean; void?: boolean; home?: number; away?: number }> };
  status: "final" | "corrected";
  settlement: "complete" | "partial";
  pending_markets: number;
  settled_at: string;
  outcomes: Array<{
    id: string;
    name: string;
    verdict: Verdict;
    dead_heat_factor?: number;
    void_reason?: string;
    market: { id: string; key: string; name: string; period: string; subject: MarketSubject };
    side: string;
    line: number | null;
  }>;
}

export type RacingCode = "thoroughbred" | "harness" | "greyhound";

/** GET /v1/racing/races: a race (Australian and New Zealand racing). */
export interface Race {
  id: string;
  code: RacingCode;
  meeting: { name: string | null; state: string | null; country: "AUS" | "NZL" | null };
  race_number: number | null;
  name?: string | null;
  distance_m?: number | null;
  scheduled_start: string;
  jumped_at?: string | null;
  status?: string;
  runner_count?: number | null;
  bookmaker_count?: number | null;
  updated_at?: string;
  class_conditions?: string | null;
  prize_money?: number | null;
  track_condition?: string | null;
}

/** One bookmaker's price for a runner. On Betfair Exchange win and place are the best back prices. */
export interface RacePrice {
  bookmaker: string;
  bookmaker_name: string;
  win?: number;
  place?: number;
  win_lay?: number;
  place_lay?: number;
  win_back_size?: number;
  win_lay_size?: number;
  win_matched?: number;
  observed_at: string | null;
  available: boolean;
}

/** GET /v1/racing/races/{race_id}/odds */
export interface RaceOdds {
  race: Race;
  runners: Array<{ number: number | null; name: string | null; barrier: number | null; scratched: boolean; prices: RacePrice[] }>;
}

/** GET /v1/racing/arbs: a bookmaker win price against the Betfair Exchange win lay. */
export interface RacingArb {
  race: Race;
  runner_number: number | null;
  runner_name: string | null;
  market: string;
  back: { bookmaker: string; decimal_odds: number; observed_at: string };
  lay: { bookmaker: string; decimal_odds: number; size: number | null; observed_at: string };
  lay_stake_per_unit: number;
  margin: number;
}

/** GET /v1/racing/movers: a runner's opening win price against the current median and best. */
export interface RacingMover {
  race: Race;
  runner_number: number | null;
  runner_name: string | null;
  opening: { decimal_odds: number; bookmaker: string; observed_at: string };
  current: { median: number; best: number; best_bookmaker: string; bookmaker_count: number; observed_at: string };
  change: number;
  direction: "firming" | "drifting";
}

/** GET /v1/racing/races/{race_id}/result */
export interface RaceResultData {
  race: Partial<Race> & { id: string };
  result: null | {
    placings: Array<{ runner_number: number; position: number; name?: string | null; fixed_win?: number | null; fixed_place?: number | null; tote_win?: number | null; tote_place?: number | null; bsp_win?: number | null; bsp_place?: number | null }>;
    scratched: Array<{ runner_number: number; win_deduction?: number | null; place_deduction?: number | null }>;
    pools?: Array<{ pool: string; total: number | null; status?: string }>;
    dividends?: Array<{ pool: string; selections: number[]; dividend: number | null }>;
    recorded_at?: string | null;
  };
  betfair_sp?: Array<{ runner_number: number; market: string; bsp: number | null }>;
}

/** GET /v1/racing/races/{race_id}/form: one runner and its last recorded starts. */
export interface RunnerForm {
  number: number | null;
  name: string | null;
  form_figures: string | null;
  starts: Array<{
    race_id: string;
    start: string;
    meeting: { name: string | null; state?: string | null; country?: string | null };
    race_number?: number | null;
    distance_m?: number | null;
    class_conditions?: string | null;
    track_condition?: string | null;
    jockey?: string | null;
    trainer?: string | null;
    barrier?: number | null;
    weight_kg?: number | null;
    position: number | null;
    placed?: boolean;
    field_size?: number | null;
    fixed_win?: number | null;
    tote_win?: number | null;
    bsp?: number | null;
  }>;
}
