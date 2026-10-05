/** The parts of the SockOdds (SportsGameOdds v2 style) schema this server reads. See docs/API-NOTES.md. */

export interface Envelope<T> {
  success: boolean;
  data: T;
  nextCursor?: string | null;
  notice?: string;
  error?: string;
}

export interface League {
  leagueID: string;
  sportID?: string;
  name?: string;
  shortName?: string;
  enabled?: boolean;
  activeEvents?: number;
}

export interface TeamSide {
  teamID?: string;
  names?: { long?: string; medium?: string; short?: string };
  statEntityID?: string;
}

export interface ByBookmakerOdds {
  bookmakerID?: string;
  odds?: string;
  decimal?: number;
  available?: boolean;
  lastUpdatedAt?: string;
  spread?: string;
  overUnder?: string;
  expiresAt?: string;
  carriedFrom?: string;
  independentlyObserved?: boolean;
  deeplink?: string;
}

export interface Odds {
  oddID?: string;
  opposingOddID?: string | null;
  marketName?: string;
  statID?: string;
  statEntityID?: string;
  periodID?: string;
  betTypeID?: string;
  sideID?: string;
  bookOdds?: string | null;
  fairOdds?: string | null;
  bookSpread?: string | null;
  bookOverUnder?: string | null;
  fairSpread?: string | null;
  fairOverUnder?: string | null;
  byBookmaker?: Record<string, ByBookmakerOdds>;
}

export interface SockEvent {
  eventID: string;
  sportID?: string;
  leagueID?: string;
  type?: string;
  teams?: { home?: TeamSide; away?: TeamSide };
  status?: {
    started?: boolean;
    ended?: boolean;
    live?: boolean;
    cancelled?: boolean;
    startsAt?: string;
    displayLong?: string;
  };
  info?: { displayName?: string; commenceTime?: string; lastUpdatedAt?: string; stale?: boolean };
  odds?: Record<string, Odds>;
  links?: { bookmakers?: Record<string, string> };
}

/** The result of one API call, with the moment it was read. */
export interface Fetched<T> {
  data: T;
  notice?: string;
  nextCursor?: string | null;
  fetchedAt: string;
  source: "live" | "demo";
}
