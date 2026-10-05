/** Public constants. Everything here comes from the public SockOdds docs. */

/** Base URL from https://sockodds.com/docs/reference/ */
export const DEFAULT_BASE_URL = "https://api.sockodds.com/v2";

/** Free key signup page, tagged for the "$1M in 365 Days" series. */
export const SIGNUP_URL =
  "https://sockodds.com/signup/?utm_source=1m365-gh&utm_medium=github&utm_campaign=sockodds-mcp";

/** Responses are cached this long. SockOdds refreshes about every 2 minutes, so 60 s loses nothing. */
export const CACHE_TTL_MS = 60_000;

/** Give up on a request after this long. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Free Developer plan, as stated on https://sockodds.com/pricing/ */
export const FREE_TIER = {
  requestsPerMinute: 10,
  objectsPerMonth: 2500,
  leagues: ["MLB", "NFL", "AFL", "NRL"],
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
