import { readFileSync } from "node:fs";
import { CACHE_TTL_MS, REQUEST_TIMEOUT_MS, type Settings } from "./config.js";
import { TtlCache } from "./cache.js";
import { MissingKeyError, SockOddsError, errorFromResponse, rateLimitMessage } from "./errors.js";
import type { Envelope, Fetched, League, OddsEvent, SockEvent } from "./types.js";
import { byBookmaker } from "./odds-shape.js";

export type Params = Record<string, string | number | boolean | undefined>;

/** Where the tools get their data: the live v1 API, or the invented demo fixtures. */
export interface OddsSource {
  /** GET /v1/leagues (query: sport, limit) */
  leagues(params?: Params): Promise<Fetched<League[]>>;
  /** GET /v1/events (query: league, starts_after, starts_before, limit) */
  events(params: Params): Promise<Fetched<SockEvent[]>>;
  /** GET /v1/events/{event_id}/odds (query: markets, bookmakers) */
  eventOdds(eventId: string, params?: Params): Promise<Fetched<OddsEvent>>;
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
 * Live client for SockOdds API v1. Sends the key only as `Authorization: Bearer` (never in the URL),
 * caches each response for 60 s, and never retries. After a 429 with Retry-After it refuses to call
 * again until that time has passed, because every request counts towards the per-minute limit.
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
    return this.get<League[]>("/leagues", params);
  }

  events(params: Params): Promise<Fetched<SockEvent[]>> {
    return this.get<SockEvent[]>("/events", params);
  }

  /**
   * Accepts either grouping: the API's default (by market) is turned into the bookmaker grouping the
   * tools read. Bookmaker display names then come from /v1/bookmakers, read once per process and
   * only when a market-grouped response arrives.
   */
  async eventOdds(eventId: string, params: Params = {}): Promise<Fetched<OddsEvent>> {
    const fetched = await this.get<OddsEvent>(`/events/${encodeURIComponent(eventId)}/odds`, params);
    if (!Array.isArray(fetched.data?.markets)) return fetched;
    const fresh = this.names === undefined;
    const names = await this.bookmakerNames();
    // The catalogue read counts one object per bookmaker listed, so the answer that made it says so.
    return { ...fetched, data: byBookmaker(fetched.data, names), ...(fresh && names.size ? { extraObjects: names.size } : {}) };
  }

  private names?: Promise<Map<string, string>>;
  /** Bookmaker key → name. If the catalogue cannot be read, keys stand in for names (and the next call tries again). */
  private bookmakerNames(): Promise<Map<string, string>> {
    this.names ??= this.get<Array<{ key: string; name: string }>>("/bookmakers", { limit: 100 })
      .then((r) => new Map(r.data.map((b) => [b.key, b.name])))
      .catch(() => { this.names = undefined; return new Map<string, string>(); });
    return this.names;
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
          headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "sockodds-mcp" },
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
      const ok = res.ok && !!body && typeof body === "object" && "data" in body;
      if (!ok) {
        const err = errorFromResponse(res.ok ? 502 : res.status, body, res.headers.get("retry-after"));
        if (err.status === 429 && err.retryAfterSeconds !== undefined) {
          this.blockedUntil = this.now() + err.retryAfterSeconds * 1000;
        }
        throw err;
      }
      const env = body as Envelope<T>;
      return {
        data: env.data,
        next: env.links?.next ?? null,
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

function list(value: Params[string]): string[] | undefined {
  return value === undefined || value === "" ? undefined : String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

/** Serves the invented demo fixtures. Used only when SOCKODDS_DEMO=1 and no key is set. */
export class DemoSource implements OddsSource {
  async leagues(params: Params = {}): Promise<Fetched<League[]>> {
    const env = loadFixture<League[]>("demo/leagues-demo.json");
    const sport = params.sport ? String(params.sport) : undefined;
    return this.wrap(env.data.filter((l) => !sport || l.sport === sport));
  }

  async events(params: Params): Promise<Fetched<SockEvent[]>> {
    const env = loadFixture<OddsEvent[]>("demo/odds-demo.json");
    const league = params.league ? String(params.league) : undefined;
    const events = env.data
      .filter((e) => !league || e.league.key === league)
      .map(({ bookmakers: _omit, ...event }) => event as SockEvent);
    return this.wrap(events);
  }

  async eventOdds(eventId: string, params: Params = {}): Promise<Fetched<OddsEvent>> {
    const env = loadFixture<OddsEvent[]>("demo/odds-demo.json");
    const ev = env.data.find((e) => e.id === eventId);
    if (!ev) throw new SockOddsError(`SockOdds could not find that (HTTP 404, Not found). SockOdds said: "Event not found.". Use find_event to get a current event ID (they start with ev_).`, 404);
    const markets = list(params.markets);
    const books = list(params.bookmakers);
    const bookmakers = (ev.bookmakers ?? [])
      .filter((b) => !books || books.includes(b.key))
      .map((b) => ({ ...b, markets: b.markets.filter((m) => !markets || markets.includes(m.key)) }))
      .filter((b) => b.markets.length > 0);
    return this.wrap({ ...ev, bookmakers });
  }

  private wrap<T>(data: T): Fetched<T> {
    return { data, fetchedAt: new Date().toISOString(), source: "demo", next: null };
  }
}
