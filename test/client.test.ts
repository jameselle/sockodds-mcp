import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFetch, fixture } from "./helpers.js";
import { SockOddsClient } from "../src/client.js";
import { MissingKeyError, SockOddsError } from "../src/errors.js";
import { findEvent, getOdds, fairOdds, bestPrice } from "../src/tools.js";

const BASE = "https://api.sockodds.com/v1";
const EVENT = "ev_000ckk0nc1tg";

test("missing key: tools explain how to get a free key and never call the API", async () => {
  const f = fakeFetch([{ status: 200, body: fixture("docs/events-rlwc.json") }]);
  const deps = { source: new SockOddsClient({ apiKey: undefined, baseUrl: BASE }, f.fn), timeZone: "Australia/Sydney" };
  await assert.rejects(() => findEvent(deps, { query: "AFL" }), (err: Error) => {
    assert.ok(err instanceof MissingKeyError);
    assert.match(err.message, /SOCKODDS_API_KEY/);
    assert.match(err.message, /sockodds\.com\/signup\/\?utm_source=1m365-gh/);
    return true;
  });
  await assert.rejects(() => getOdds(deps, { event_id: EVENT }), MissingKeyError);
  assert.equal(f.calls.length, 0);
});

test("fair_odds by hand works with no key at all", async () => {
  const deps = { source: new SockOddsClient({ apiKey: undefined, baseUrl: BASE }), timeZone: "UTC" };
  const text = await fairOdds(deps, { prices: { outcomes: ["Home", "Away"], books: [{ bookmaker: "sportsbet", odds: [1.91, 1.91] }] } });
  assert.match(text, /Home: fair 2\.00 \(50\.0% chance\)/);
});

test("sends the key only as a bearer token, keeps it out of the URL and caches for 60 s", async () => {
  let now = Date.parse("2026-10-15T08:00:00Z");
  const f = fakeFetch([{ status: 200, body: fixture("docs/events-rlwc.json") }]);
  const c = new SockOddsClient({ apiKey: "test-key", baseUrl: BASE }, f.fn, () => now);
  const a = await c.events({ league: "rlwc" });
  const b = await c.events({ league: "rlwc" });
  assert.equal(f.calls.length, 1);
  assert.equal(a, b);
  assert.equal(f.calls[0].headers.authorization, "Bearer test-key");
  assert.equal(f.calls[0].headers["x-api-key"], undefined);
  assert.ok(!f.calls[0].url.includes("test-key"));
  assert.equal(f.calls[0].url, `${BASE}/events?league=rlwc`);
  assert.equal(a.data[0].id, EVENT);
  assert.equal(a.next, null);
  now += 61_000;
  await c.events({ league: "rlwc" });
  assert.equal(f.calls.length, 2);
});

test("v1 paths and query names: /events and /events/{id}/odds", async () => {
  const f = fakeFetch([
    { status: 200, body: fixture("docs/events-rlwc.json") },
    { status: 200, body: fixture("docs/odds-event-handicap.json") },
  ]);
  const deps = {
    source: new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn, () => Date.parse("2026-10-15T08:00:00Z")),
    timeZone: "UTC",
    now: () => new Date("2026-10-15T08:00:00Z"),
  };
  await findEvent(deps, { query: "Australia v New Zealand", league_id: "Rugby League World Cup", days_ahead: 3, limit: 10 });
  assert.equal(
    f.calls[0].url,
    `${BASE}/events?league=rlwc&limit=10&starts_after=2026-10-15T02%3A00%3A00Z&starts_before=2026-10-18T08%3A00%3A00Z`,
  );
  await getOdds(deps, { event_id: EVENT, bookmakers: "TAB, sportsbet" });
  assert.equal(
    f.calls[1].url,
    `${BASE}/events/${EVENT}/odds?bookmakers=tab%2Csportsbet&markets=winner%2Cresult%2Chandicap%2Ctotal_points%2Ctotal_goals%2Ctotal_runs%2Ctotal_games%2Ctotal_rounds%2Ctotal_maps`,
  );
  await bestPrice(deps, { event_id: EVENT, market: "line", side: "home" });
  assert.equal(f.calls[2].url, `${BASE}/events/${EVENT}/odds?markets=handicap`);
});

test("an old v2 event ID is refused locally with a pointer to find_event", async () => {
  const f = fakeFetch([{ status: 200, body: fixture("docs/odds-event-handicap.json") }]);
  const deps = { source: new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn), timeZone: "UTC" };
  await assert.rejects(() => getOdds(deps, { event_id: "afl_2026-09-12_brisbane_lions_vs_adelaide_crows" }), /not a SockOdds event ID.*find_event/);
  assert.equal(f.calls.length, 0);
});

test("429 Rate limit reached: clear message, no retry, and no further calls until Retry-After passes", async () => {
  let now = Date.parse("2026-10-15T08:00:00Z");
  const f = fakeFetch([{ status: 429, body: fixture("docs/error-429.json"), headers: { "retry-after": "30" } }]);
  const c = new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn, () => now);
  await assert.rejects(() => c.events({ league: "afl" }), (err: Error) => {
    assert.ok(err instanceof SockOddsError);
    assert.equal(err.status, 429);
    assert.match(err.message, /wait 30 s/);
    assert.match(err.message, /10 requests a minute/);
    assert.match(err.message, /does not retry/);
    return true;
  });
  assert.equal(f.calls.length, 1);
  // A different request inside the window is refused locally.
  await assert.rejects(() => c.events({ league: "nrl" }), /rate limit/i);
  assert.equal(f.calls.length, 1);
  now += 31_000;
  await assert.rejects(() => c.events({ league: "nrl" }));
  assert.equal(f.calls.length, 2);
});

test("429 Monthly allowance reached: says retrying will not help and does not block locally", async () => {
  const f = fakeFetch([{ status: 429, body: fixture("docs/error-429-monthly.json") }]);
  const c = new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn);
  await assert.rejects(() => c.events({ league: "afl" }), /Monthly allowance reached.*Retrying will not help.*next calendar month/);
  await assert.rejects(() => c.events({ league: "nrl" }), /Monthly allowance reached/);
  assert.equal(f.calls.length, 2);
});

test("401, 403, 404, 410 and 500 give plain messages and are not retried or cached", async () => {
  const f = fakeFetch([
    { status: 401, body: fixture("docs/error-401.json") },
    { status: 403, body: fixture("docs/error-403.json") },
    { status: 404, body: fixture("docs/error-404.json") },
    { status: 410, body: { type: "https://api.sockodds.com/problems/410", title: "Gone", status: 410, detail: "Gone.", instance: "/v2/events" } },
    { status: 500, body: { type: "about:blank", title: "Server error", status: 500, detail: "Server error.", instance: "/v1/leagues" } },
  ]);
  const c = new SockOddsClient({ apiKey: "bad", baseUrl: BASE }, f.fn);
  await assert.rejects(() => c.leagues(), /rejected the API key \(HTTP 401\).*Provide a valid bearer key.*Authorization: Bearer/);
  await assert.rejects(() => c.leagues(), /Plan restriction.*This league is not in your plan.*Rugby League World Cup/);
  await assert.rejects(() => c.eventOdds("ev_000000000000"), /HTTP 404, Not found.*Event not found.*find_event/);
  await assert.rejects(() => c.leagues(), /HTTP 410 Gone.*https:\/\/api\.sockodds\.com\/v1/);
  await assert.rejects(() => c.leagues(), /HTTP 500/);
  assert.equal(f.calls.length, 5);
});

test("400 shows the problem detail; a 404 with no problem body points at the base URL", async () => {
  const f = fakeFetch([
    { status: 400, body: fixture("docs/error-400.json") },
    { status: 404, body: { message: "no route" } },
  ]);
  const c = new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn);
  await assert.rejects(() => c.leagues(), /HTTP 400, Invalid request.*Invalid starts_after/);
  await assert.rejects(() => c.leagues(), /no such API path.*SOCKODDS_BASE_URL/);
});

test("401 Access changed asks for the active key", async () => {
  const f = fakeFetch([{ status: 401, body: { type: "https://api.sockodds.com/problems/401", title: "Access changed", status: 401, detail: "Access changed.", instance: "/v1/leagues" } }]);
  const c = new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn);
  await assert.rejects(() => c.leagues(), /rotated, or its plan changed.*active key/);
});
