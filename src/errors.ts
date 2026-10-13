import { DEFAULT_BASE_URL, FREE_TIER, PRICING_URL, SIGNUP_URL, listWords } from "./config.js";
import type { Problem } from "./types.js";

/** An error whose message is safe and useful to show to the person asking. */
export class SockOddsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    readonly title?: string,
  ) {
    super(message);
    this.name = "SockOddsError";
  }
}

export class MissingKeyError extends SockOddsError {
  constructor() {
    super(
      [
        "No SockOdds API key is set, so no live odds can be fetched.",
        `Get a free key (no card needed) at ${SIGNUP_URL}`,
        "then set SOCKODDS_API_KEY in this MCP server's environment and restart it.",
        "To try the tools first, set SOCKODDS_DEMO=1 to use invented sample data instead.",
      ].join(" "),
    );
    this.name = "MissingKeyError";
  }
}

const FREE_PLAN = `The free Developer plan allows ${FREE_TIER.requestsPerMinute} requests a minute and ${FREE_TIER.objectsPerMonth.toLocaleString("en-AU")} objects a month (each event counts as one object, plus one for every priced outcome in it).`;

export function rateLimitMessage(retryAfterSeconds?: number): string {
  const wait =
    retryAfterSeconds !== undefined
      ? `SockOdds says to wait ${retryAfterSeconds} s before the next request.`
      : "Wait a minute before the next request.";
  return [
    "SockOdds rate limit reached for this API key (HTTP 429, Rate limit reached).",
    wait,
    FREE_PLAN,
    "This server does not retry on its own. Wait and ask again.",
  ].join(" ");
}

function monthlyAllowanceMessage(said: string): string {
  return [
    `This API key has used its objects for this month (HTTP 429, Monthly allowance reached).${said}`,
    "Retrying will not help: the allowance resets at the start of the next calendar month (UTC), or when the plan changes.",
    FREE_PLAN,
    `Plans: ${PRICING_URL}`,
  ].join(" ");
}

function asProblem(body: unknown): Problem | undefined {
  if (!body || typeof body !== "object") return undefined;
  const p = body as Problem;
  return typeof p.title === "string" || typeof p.detail === "string" ? p : undefined;
}

function seconds(header: string | null): number | undefined {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : undefined;
}

/**
 * Turn an HTTP failure into a clear message, using the problem object's title and detail
 * (https://sockodds.com/docs/errors/). Never retries.
 */
export function errorFromResponse(status: number, body: unknown, retryAfter: string | null): SockOddsError {
  const problem = asProblem(body);
  const title = problem?.title;
  const said = problem?.detail ? ` SockOdds said: "${problem.detail}".` : "";
  switch (status) {
    case 400:
      return new SockOddsError(`SockOdds did not accept the request (HTTP 400, Invalid request).${said} Retrying it unchanged gets the same answer.`, status, undefined, title);
    case 401:
      if (title === "Access changed") {
        return new SockOddsError(
          `This API key was rotated, or its plan changed, while the request was in flight (HTTP 401, Access changed).${said} Set SOCKODDS_API_KEY to the active key, restart this server and ask again.`,
          status,
          undefined,
          title,
        );
      }
      return new SockOddsError(
        `SockOdds rejected the API key (HTTP 401).${said} Check SOCKODDS_API_KEY for typos, spaces or quotes, and that it is your current key (rotating a key disables the old one). This server sends it only as an Authorization: Bearer header. Get a free key at ${SIGNUP_URL}`,
        status,
        undefined,
        title,
      );
    case 403:
      return new SockOddsError(
        `This API key's plan does not include that (HTTP 403, Plan restriction).${said} The free Developer plan covers ${listWords(FREE_TIER.leagues)}, with ${listWords(FREE_TIER.bookmakers)}. Choose a league the plan covers, or see ${PRICING_URL}`,
        status,
        undefined,
        title,
      );
    case 404:
      if (!problem) {
        return new SockOddsError(
          `SockOdds has no such API path (HTTP 404). If SOCKODDS_BASE_URL is set, check it is ${DEFAULT_BASE_URL}, or remove it.`,
          status,
        );
      }
      return new SockOddsError(
        `SockOdds could not find that (HTTP 404, Not found).${said} Use find_event to get a current event ID (they start with ev_).`,
        status,
        undefined,
        title,
      );
    case 410:
      return new SockOddsError(
        `SockOdds says this API address is retired (HTTP 410 Gone).${said} This server speaks SockOdds API v1 at ${DEFAULT_BASE_URL}. If SOCKODDS_BASE_URL is set to an older address, remove it or set it to ${DEFAULT_BASE_URL}, then restart.`,
        status,
        undefined,
        title,
      );
    case 429: {
      const secs = seconds(retryAfter);
      // Per the docs, a 429 without Retry-After is the monthly allowance (or the stream limit); retrying will not help.
      if (title === "Monthly allowance reached" || (secs === undefined && title !== "Rate limit reached")) {
        return new SockOddsError(monthlyAllowanceMessage(said), status, undefined, title);
      }
      return new SockOddsError(rateLimitMessage(secs), status, secs, title);
    }
    case 503: {
      const secs = seconds(retryAfter);
      return new SockOddsError(
        `SockOdds could not answer just now (HTTP 503, Service unavailable).${said} This server does not retry on its own; ask again ${secs !== undefined ? `in ${secs} s` : "in a moment"}.`,
        status,
        secs,
        title,
      );
    }
    default:
      return new SockOddsError(
        `SockOdds returned HTTP ${status}${title ? ` (${title})` : ""}.${said} This server does not retry automatically; try again shortly.`,
        status,
        undefined,
        title,
      );
  }
}
