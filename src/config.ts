/** Public constants. Everything here comes from the public SockOdds docs. */

/** Base URL of SockOdds API v1, from https://sockodds.com/docs/ and https://sockodds.com/openapi.json */
export const DEFAULT_BASE_URL = "https://api.sockodds.com/v1";

/** Free key signup page, tagged for the "$1M in 365 Days" series. */
export const SIGNUP_URL =
  "https://sockodds.com/signup/?utm_source=1m365-gh&utm_medium=github&utm_campaign=sockodds-mcp";

export const PRICING_URL = "https://sockodds.com/pricing/";

/** Responses are cached this long, so asking the same thing twice in a minute costs nothing. */
export const CACHE_TTL_MS = 60_000;

/** Give up on a request after this long. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Free Developer plan, as stated on https://sockodds.com/pricing/ and https://sockodds.com/docs/limits/ */
export const FREE_TIER = {
  requestsPerMinute: 10,
  objectsPerMonth: 2500,
  leagues: ["MLB", "NFL", "AFL", "NRL", "Rugby League World Cup", "Rugby League World Cup Women's"],
  bookmakers: ["Sportsbet", "TAB", "Ladbrokes"],
} as const;

export const RESPONSIBLE_GAMBLING =
  "18+. Odds change and nothing here is a tip. Gamble responsibly: Gambling Help Online 1800 858 858 (gamblinghelponline.org.au), BetStop (betstop.gov.au).";

export interface Settings {
  apiKey?: string;
  baseUrl: string;
  demo: boolean;
  timeZone: string;
}

export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const apiKey = env.SOCKODDS_API_KEY?.trim() || undefined;
  return {
    apiKey,
    baseUrl: (env.SOCKODDS_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    demo: !apiKey && /^(1|true|yes)$/i.test(env.SOCKODDS_DEMO ?? ""),
    timeZone: env.SOCKODDS_TIMEZONE?.trim() || "Australia/Sydney",
  };
}

/** True when the base URL points at the retired v2 API, which answers 410 Gone. */
export function isRetiredBaseUrl(baseUrl: string): boolean {
  return /\/v2$/i.test(baseUrl);
}

export function listWords(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
