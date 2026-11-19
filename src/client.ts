import { readFileSync } from "node:fs";
import { CACHE_TTL_MS, REQUEST_TIMEOUT_MS, type Settings } from "./config.js";
import { TtlCache } from "./cache.js";
import { MissingKeyError, SockOddsError, errorFromResponse, rateLimitMessage } from "./errors.js";
import type {
  Arb,
  Bookmaker,
  ClosingEvent,
  Envelope,
  EvOpportunity,
  Fetched,
  HistoryChange,
  League,
  LineMove,
  OddsEvent,
  PairOpportunity,
  Race,
  RaceOdds,
  RaceResultData,
  RacingArb,
  RacingMover,
  Result,
  RunnerForm,
  SockEvent,
} from "./types.js";
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
  /** GET /v1/bookmakers (query: regions, limit). A list without prices: it costs no credits. */
  bookmakers(params?: Params): Promise<Fetched<Bookmaker[]>>;
  /** GET /v1/opportunities/arbs (query: league, min_edge, limit, cursor). Pro or the Pro trial; 10 credits a page. */
  arbs(params?: Params): Promise<Fetched<Arb[]>>;
}

/**
 * The routes added in 1.3.0: the other derived endpoints, recorded history, results and racing. Kept apart
 * from OddsSource so a source that serves only the first six tools still type-checks.
 */
export interface MoreSource {
  /** GET /v1/events/{event_id} (free) */
  event(eventId: string): Promise<Fetched<SockEvent>>;
  /** GET /v1/opportunities/ev (query: league, markets, min_edge, fair, limit, cursor). Pro; 10 credits a page. */
  ev(params?: Params): Promise<Fetched<EvOpportunity[]>>;
  /** GET /v1/opportunities/middles (query: league, markets, min_edge, limit, cursor). Pro; 10 credits a page. */
  middles(params?: Params): Promise<Fetched<PairOpportunity[]>>;
  /** GET /v1/opportunities/low-holds (query: league, markets, max_hold, limit, cursor). Pro; 10 credits a page. */
  lowHolds(params?: Params): Promise<Fetched<PairOpportunity[]>>;
  /** GET /v1/moves (query: league, window, min_books, steam, markets, limit, cursor). Pro; 10 credits a call. */
  moves(params: Params): Promise<Fetched<LineMove[]>>;
  /** GET /v1/events/{event_id}/closing (query: markets, bookmakers, outcome_id, odds). Pro; 10 credits. */
  closing(eventId: string, params?: Params): Promise<Fetched<ClosingEvent>>;
  /** GET /v1/odds/history (query: event_id, from, to, markets, bookmakers, limit, cursor). Paid plans. */
  oddsHistory(params: Params): Promise<Fetched<HistoryChange[]>>;
  /** GET /v1/results (query: league, event_id, starts_after, starts_before, limit, cursor). 1 credit, 2 with a window. */
  results(params: Params): Promise<Fetched<Result[]>>;
  /** GET /v1/racing/races (query: code, country, starts_after, starts_before, limit, cursor). Paid plans; free. */
  races(params?: Params): Promise<Fetched<Race[]>>;
  /** GET /v1/racing/races/{race_id}/odds (query: bookmakers). Paid plans; 1 credit per region. */
  raceOdds(raceId: string, params?: Params): Promise<Fetched<RaceOdds>>;
  /** GET /v1/racing/arbs (query: code, country, starts_before, commission, min_margin, limit). Pro; 10 credits. */
  racingArbs(params?: Params): Promise<Fetched<RacingArb[]>>;
  /** GET /v1/racing/movers (query: code, country, starts_before, min_change, direction, limit). Pro; 10 credits. */
  racingMovers(params?: Params): Promise<Fetched<RacingMover[]>>;
  /** GET /v1/racing/races/{race_id}/result. Paid plans; 1 credit. */
  raceResult(raceId: string): Promise<Fetched<RaceResultData>>;
  /** GET /v1/racing/races/{race_id}/form (query: limit). Paid plans; 1 credit. */
  raceForm(raceId: string, params?: Params): Promise<Fetched<RunnerForm[] | { runners?: RunnerForm[] }>>;
}

/** Every route the tools read. */
export type FullSource = OddsSource & MoreSource;

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
export class SockOddsClient implements FullSource {
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

  bookmakers(params: Params = {}): Promise<Fetched<Bookmaker[]>> {
    return this.get<Bookmaker[]>("/bookmakers", params);
  }

  arbs(params: Params = {}): Promise<Fetched<Arb[]>> {
    return this.get<Arb[]>("/opportunities/arbs", params);
  }

  event(eventId: string): Promise<Fetched<SockEvent>> {
    return this.get<SockEvent>(`/events/${encodeURIComponent(eventId)}`, {});
  }

  ev(params: Params = {}): Promise<Fetched<EvOpportunity[]>> {
    return this.get<EvOpportunity[]>("/opportunities/ev", params);
  }

  middles(params: Params = {}): Promise<Fetched<PairOpportunity[]>> {
    return this.get<PairOpportunity[]>("/opportunities/middles", params);
  }

  lowHolds(params: Params = {}): Promise<Fetched<PairOpportunity[]>> {
    return this.get<PairOpportunity[]>("/opportunities/low-holds", params);
  }

  moves(params: Params): Promise<Fetched<LineMove[]>> {
    return this.get<LineMove[]>("/moves", params);
  }

  closing(eventId: string, params: Params = {}): Promise<Fetched<ClosingEvent>> {
    return this.get<ClosingEvent>(`/events/${encodeURIComponent(eventId)}/closing`, params);
  }

  oddsHistory(params: Params): Promise<Fetched<HistoryChange[]>> {
    return this.get<HistoryChange[]>("/odds/history", params);
  }

  results(params: Params): Promise<Fetched<Result[]>> {
    return this.get<Result[]>("/results", params);
  }

  races(params: Params = {}): Promise<Fetched<Race[]>> {
    return this.get<Race[]>("/racing/races", params);
  }

  raceOdds(raceId: string, params: Params = {}): Promise<Fetched<RaceOdds>> {
    return this.get<RaceOdds>(`/racing/races/${encodeURIComponent(raceId)}/odds`, params);
  }

  racingArbs(params: Params = {}): Promise<Fetched<RacingArb[]>> {
    return this.get<RacingArb[]>("/racing/arbs", params);
  }

  racingMovers(params: Params = {}): Promise<Fetched<RacingMover[]>> {
    return this.get<RacingMover[]>("/racing/movers", params);
  }

  raceResult(raceId: string): Promise<Fetched<RaceResultData>> {
    return this.get<RaceResultData>(`/racing/races/${encodeURIComponent(raceId)}/result`, {});
  }

  raceForm(raceId: string, params: Params = {}): Promise<Fetched<RunnerForm[] | { runners?: RunnerForm[] }>> {
    return this.get<RunnerForm[] | { runners?: RunnerForm[] }>(`/racing/races/${encodeURIComponent(raceId)}/form`, params);
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

function demoNotFound(detail: string): SockOddsError {
  return new SockOddsError(`SockOdds could not find that (HTTP 404, Not found). SockOdds said: "${detail}".`, 404, undefined, "Not found", detail);
}

function list(value: Params[string]): string[] | undefined {
  return value === undefined || value === "" ? undefined : String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

/** Serves the invented demo fixtures. Used only when SOCKODDS_DEMO=1 and no key is set. */
export class DemoSource implements FullSource {
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

  async bookmakers(params: Params = {}): Promise<Fetched<Bookmaker[]>> {
    const env = loadFixture<Bookmaker[]>("demo/bookmakers-demo.json");
    const regions = list(params.regions);
    return this.wrap(env.data.filter((b) => !regions || (b.regions ?? []).some((r) => regions.includes(r))));
  }

  async arbs(params: Params = {}): Promise<Fetched<Arb[]>> {
    const env = loadFixture<Arb[]>("demo/arbs-demo.json");
    const league = params.league ? String(params.league) : undefined;
    const minEdge = params.min_edge === undefined ? undefined : Number(params.min_edge);
    return this.wrap(env.data.filter((a) => (!league || a.event.league === league) && (minEdge === undefined || a.profit_pct >= minEdge)));
  }

  async event(eventId: string): Promise<Fetched<SockEvent>> {
    const odds = loadFixture<OddsEvent[]>("demo/odds-demo.json").data.find((e) => e.id === eventId);
    if (odds) {
      const { bookmakers: _omit, ...event } = odds;
      return this.wrap(event as SockEvent);
    }
    const closing = loadFixture<ClosingEvent>("demo/closing-demo.json").data;
    if (closing.id !== eventId) throw demoNotFound("Event not found.");
    const { markets: _m, bet: _b, ...event } = closing;
    return this.wrap(event as SockEvent);
  }

  async ev(params: Params = {}): Promise<Fetched<EvOpportunity[]>> {
    const minEdge = params.min_edge === undefined ? undefined : Number(params.min_edge);
    const methods = list(params.fair);
    return this.wrap(
      this.byLeague(loadFixture<EvOpportunity[]>("demo/ev-demo.json").data, params).filter(
        (e) => (minEdge === undefined || e.ev_pct >= minEdge) && (!methods || methods.includes(e.fair.method)),
      ),
    );
  }

  async middles(params: Params = {}): Promise<Fetched<PairOpportunity[]>> {
    const minEdge = params.min_edge === undefined ? undefined : Number(params.min_edge);
    return this.wrap(this.byLeague(loadFixture<PairOpportunity[]>("demo/middles-demo.json").data, params).filter((m) => minEdge === undefined || (m.middle_profit_pct ?? 0) >= minEdge));
  }

  async lowHolds(params: Params = {}): Promise<Fetched<PairOpportunity[]>> {
    const maxHold = params.max_hold === undefined ? undefined : Number(params.max_hold);
    return this.wrap(this.byLeague(loadFixture<PairOpportunity[]>("demo/low-holds-demo.json").data, params).filter((m) => maxHold === undefined || (m.hold_pct ?? 0) <= maxHold));
  }

  async moves(params: Params): Promise<Fetched<LineMove[]>> {
    const steamOnly = String(params.steam) === "true";
    return this.wrap(this.byLeague(loadFixture<LineMove[]>("demo/moves-demo.json").data, params).filter((m) => !steamOnly || m.steam));
  }

  async closing(eventId: string, params: Params = {}): Promise<Fetched<ClosingEvent>> {
    const ev = loadFixture<ClosingEvent>("demo/closing-demo.json").data;
    if (ev.id !== eventId) throw demoNotFound("Event not found.");
    const markets = list(params.markets);
    const books = list(params.bookmakers);
    const shown = {
      ...ev,
      markets: ev.markets
        .filter((m) => !markets || markets.includes(m.key))
        .map((m) => ({ ...m, outcomes: m.outcomes.map((o) => ({ ...o, prices: o.prices.filter((p) => !books || books.includes(p.bookmaker)) })) })),
    };
    const outcome = params.outcome_id ? String(params.outcome_id) : undefined;
    const odds = params.odds === undefined ? undefined : Number(params.odds);
    if (outcome && odds !== undefined) {
      const fair = ev.markets.flatMap((m) => m.outcomes).find((o) => o.id === outcome)?.closing_fair_decimal_odds ?? null;
      const clv = fair === null ? null : Math.round((odds / fair - 1) * 100_000) / 1000;
      return this.wrap({ ...shown, bet: { outcome_id: outcome, decimal_odds: odds, closing_fair_decimal_odds: fair, clv_pct: clv, beat_close: clv === null ? null : clv > 0 } });
    }
    const { bet: _omit, ...rest } = shown;
    return this.wrap(rest);
  }

  async oddsHistory(params: Params): Promise<Fetched<HistoryChange[]>> {
    const markets = list(params.markets);
    const books = list(params.bookmakers);
    const from = Date.parse(String(params.from ?? "")), to = Date.parse(String(params.to ?? ""));
    const rows = loadFixture<HistoryChange[]>("demo/history-demo.json").data.filter((r) => {
      const t = Date.parse(r.observed_at);
      return r.event === params.event_id && (!markets || markets.includes(r.market.key)) && (!books || books.includes(r.bookmaker)) && (Number.isNaN(from) || t >= from) && (Number.isNaN(to) || t <= to);
    });
    return this.wrap(rows);
  }

  async results(params: Params): Promise<Fetched<Result[]>> {
    const eventId = params.event_id ? String(params.event_id) : undefined;
    const league = params.league ? String(params.league) : undefined;
    return this.wrap(loadFixture<Result[]>("demo/results-demo.json").data.filter((r) => (!eventId || r.event.id === eventId) && (!league || r.event.league.key === league)));
  }

  async races(params: Params = {}): Promise<Fetched<Race[]>> {
    const codes = list(params.code);
    const countries = list(params.country);
    return this.wrap(
      loadFixture<Race[]>("demo/racing-races-demo.json").data.filter(
        (r) => (!codes || codes.includes(r.code)) && (!countries || countries.includes(r.meeting.country ?? "")),
      ),
    );
  }

  async raceOdds(raceId: string, params: Params = {}): Promise<Fetched<RaceOdds>> {
    const odds = loadFixture<RaceOdds>("demo/racing-odds-demo.json").data;
    if (odds.race.id !== raceId) throw demoNotFound("Race not found.");
    const books = list(params.bookmakers);
    return this.wrap({ ...odds, runners: odds.runners.map((r) => ({ ...r, prices: r.prices.filter((p) => !books || books.includes(p.bookmaker)) })) });
  }

  async racingArbs(params: Params = {}): Promise<Fetched<RacingArb[]>> {
    const minMargin = params.min_margin === undefined ? 0 : Number(params.min_margin);
    return this.wrap(this.byRacing(loadFixture<RacingArb[]>("demo/racing-arbs-demo.json").data, params).filter((a) => a.margin >= minMargin));
  }

  async racingMovers(params: Params = {}): Promise<Fetched<RacingMover[]>> {
    const minChange = params.min_change === undefined ? 0.1 : Number(params.min_change);
    const direction = params.direction ? String(params.direction) : "any";
    return this.wrap(
      this.byRacing(loadFixture<RacingMover[]>("demo/racing-movers-demo.json").data, params).filter(
        (m) => Math.abs(m.change) >= minChange && (direction === "any" || m.direction === direction),
      ),
    );
  }

  async raceResult(raceId: string): Promise<Fetched<RaceResultData>> {
    const result = loadFixture<RaceResultData>("demo/racing-result-demo.json").data;
    if (result.race.id !== raceId) throw demoNotFound("Race not found.");
    return this.wrap(result);
  }

  async raceForm(raceId: string, params: Params = {}): Promise<Fetched<RunnerForm[]>> {
    const env = loadFixture<RunnerForm[]>("demo/racing-form-demo.json") as Envelope<RunnerForm[]> & { race_id?: string };
    if (env.race_id !== raceId) throw demoNotFound("Race not found.");
    const limit = params.limit === undefined ? 5 : Number(params.limit);
    return this.wrap(env.data.map((r) => ({ ...r, starts: r.starts.slice(0, limit) })));
  }

  private byLeague<T extends { event: { league: string } }>(rows: T[], params: Params): T[] {
    const league = params.league ? String(params.league) : undefined;
    return rows.filter((r) => !league || r.event.league === league);
  }

  private byRacing<T extends { race: Race }>(rows: T[], params: Params): T[] {
    const codes = list(params.code);
    const countries = list(params.country);
    return rows.filter((r) => (!codes || codes.includes(r.race.code)) && (!countries || countries.includes(r.race.meeting.country ?? "")));
  }

  private wrap<T>(data: T): Fetched<T> {
    return { data, fetchedAt: new Date().toISOString(), source: "demo", next: null };
  }
}
