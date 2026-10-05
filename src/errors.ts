import { FREE_TIER, SIGNUP_URL } from "./config.js";

/** An error whose message is safe and useful to show to the person asking. */
export class SockOddsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
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

export function rateLimitMessage(retryAfterSeconds?: number): string {
  const wait =
    retryAfterSeconds !== undefined
      ? `SockOdds says to wait ${retryAfterSeconds} s before the next request.`
      : "Wait a minute before the next request.";
  return [
    "SockOdds rate limit reached for this API key (HTTP 429).",
    wait,
    `The free Developer plan allows ${FREE_TIER.requestsPerMinute} requests a minute and ${FREE_TIER.objectsPerMonth.toLocaleString("en-AU")} objects a month (one event counts as one object).`,
    "This server does not retry on its own. Check usage at https://sockodds.com/pricing/ or wait and ask again.",
  ].join(" ");
}

/** Turn an HTTP failure into a clear message. Never retries. */
export function errorFromResponse(status: number, body: unknown, retryAfter: string | null): SockOddsError {
  const apiMessage =
    body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : undefined;
  const said = apiMessage ? ` SockOdds said: "${apiMessage}".` : "";
  switch (status) {
    case 401:
      return new SockOddsError(
        `SockOdds rejected the API key (HTTP 401).${said} Check SOCKODDS_API_KEY for typos or spaces, or get a new free key at ${SIGNUP_URL}`,
        status,
      );
    case 403:
      return new SockOddsError(
        `This SockOdds API key is inactive (HTTP 403).${said} Contact api@sockodds.com with the key's keyID.`,
        status,
      );
    case 429: {
      const secs = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) : undefined;
      return new SockOddsError(rateLimitMessage(secs), status, secs);
    }
    case 400:
      return new SockOddsError(`SockOdds did not accept the request (HTTP 400).${said}`, status);
    case 404:
      return new SockOddsError(`SockOdds could not find that (HTTP 404).${said}`, status);
    default:
      return new SockOddsError(
        `SockOdds returned HTTP ${status}.${said} This server does not retry automatically; try again shortly.`,
        status,
      );
  }
}
