import { readFileSync } from "node:fs";
import { CACHE_TTL_MS, REQUEST_TIMEOUT_MS, type Settings } from "./config.js";
import { TtlCache } from "./cache.js";
import { MissingKeyError, SockOddsError, errorFromResponse, rateLimitMessage } from "./errors.js";
import type { Envelope, Fetched, League, SockEvent } from "./types.js";

export type Params = Record<string, string | number | boolean | undefined>;

export interface OddsSource {
  leagues(params?: Params): Promise<Fetched<League[]>>;
  events(params: Params): Promise<Fetched<SockEvent[]>>;
}

type FetchFn = typeof fetch;

function queryString(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Live client. Sends the key in the x-api-key header (never in the URL), caches each
 * response for 60 s, and never retries. After a 429 it refuses to call again until
 * Retry-After has passed, because rejected calls still count against the minute.
 */
export class SockOddsClient implements OddsSource {
  private readonly cache: TtlCache<Fetched<unknown>>;
  private blockedUntil = 0;

  constructor(
    private readonly settings: Pick<Settings, "apiKey" | "baseUrl">,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(CACHE_TTL_MS, now);
  }

  leagues(params: Params = {}): Promise<Fetched<League[]>> {
    return this.get<League[]>("/leagues/", params);
  }

  events(params: Params): Promise<Fetched<SockEvent[]>> {
    return this.get<SockEvent[]>("/events/", params);
  }

  async get<T>(path: string, params: Params): Promise<Fetched<T>> {
    const key = this.settings.apiKey;
    if (!key) throw new MissingKeyError();
    const url = `${this.settings.baseUrl}${path}${queryString(params)}`;
    return this.cache.getOrLoad(url, async () => {
      const waitMs = this.blockedUntil - this.now();
      if (waitMs > 0) {
        throw new SockOddsError(rateLimitMessage(Math.ceil(waitMs / 1000)), 429, Math.ceil(waitMs / 1000));
      }
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          headers: { "x-api-key": key, accept: "application/json", "user-agent": "sockodds-mcp" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new SockOddsError(`Could not reach SockOdds: ${(err as Error).message}. Not retrying automatically.`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      if (!res.ok || !body || (body as Envelope<T>).success !== true) {
        const err = errorFromResponse(res.ok ? 502 : res.status, body, res.headers.get("retry-after"));
        if (err.status === 429) this.blockedUntil = this.now() + (err.retryAfterSeconds ?? 60) * 1000;
        throw err;
      }
      const env = body as Envelope<T>;
      return {
        data: env.data,
        notice: env.notice,
        nextCursor: env.nextCursor ?? null,
        fetchedAt: new Date(this.now()).toISOString(),
        source: "live",
      } satisfies Fetched<T>;
    }) as Promise<Fetched<T>>;
  }
}

function loadFixture<T>(name: string): Envelope<T> {
  const url = new URL(`../../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Envelope<T>;
}

/** Serves the invented demo fixtures. Used only when SOCKODDS_DEMO=1 and no key is set. */
export class DemoSource implements OddsSource {
  async leagues(params: Params = {}): Promise<Fetched<League[]>> {
    const env = loadFixture<League[]>("demo/leagues-demo.json");
    const sport = params.sportID ? String(params.sportID) : undefined;
    return this.wrap(env.data.filter((l) => !sport || l.sportID === sport));
  }

  async events(params: Params): Promise<Fetched<SockEvent[]>> {
    const env = loadFixture<SockEvent[]>("demo/events-demo.json");
    const ids = params.eventID ? [String(params.eventID)] : undefined;
    const leagues = params.leagueID ? String(params.leagueID).split(",") : undefined;
    return this.wrap(
      env.data.filter((e) => (!ids || ids.includes(e.eventID)) && (!leagues || leagues.includes(e.leagueID ?? ""))),
    );
  }

  private wrap<T>(data: T): Fetched<T> {
    return { data, fetchedAt: new Date().toISOString(), source: "demo", nextCursor: null };
  }
}
