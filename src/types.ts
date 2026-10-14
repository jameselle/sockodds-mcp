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
