import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFetch, fixture } from "./helpers.js";
import { SockOddsClient } from "../src/client.js";
import { MissingKeyError, SockOddsError } from "../src/errors.js";
import { findEvent, getOdds, fairOdds } from "../src/tools.js";

const BASE = "https://api.sockodds.com/v2";

test("missing key: tools explain how to get a free key and never call the API", async () => {
  const f = fakeFetch([{ status: 200, body: fixture("docs/events-quickstart.json") }]);
  const deps = { source: new SockOddsClient({ apiKey: undefined, baseUrl: BASE }, f.fn), timeZone: "Australia/Sydney" };
  await assert.rejects(() => findEvent(deps, { query: "AFL" }), (err: Error) => {
    assert.ok(err instanceof MissingKeyError);
    assert.match(err.message, /SOCKODDS_API_KEY/);
    assert.match(err.message, /sockodds\.com\/signup\/\?utm_source=1m365-gh/);
    return true;
  });
  await assert.rejects(() => getOdds(deps, { event_id: "x" }), MissingKeyError);
  assert.equal(f.calls.length, 0);
});

test("fair_odds by hand works with no key at all", async () => {
  const deps = { source: new SockOddsClient({ apiKey: undefined, baseUrl: BASE }), timeZone: "UTC" };
  const text = await fairOdds(deps, { prices: { outcomes: ["Home", "Away"], books: [{ bookmaker: "sportsbet", odds: [1.91, 1.91] }] } });
  assert.match(text, /Home: fair 2\.00 \(50\.0% chance\)/);
});

test("sends the key as x-api-key, keeps it out of the URL and caches for 60 s", async () => {
  let now = Date.parse("2026-10-06T00:00:00Z");
  const f = fakeFetch([{ status: 200, body: fixture("docs/events-quickstart.json") }]);
  const c = new SockOddsClient({ apiKey: "test-key", baseUrl: BASE }, f.fn, () => now);
  const a = await c.events({ leagueID: "AFL" });
  const b = await c.events({ leagueID: "AFL" });
  assert.equal(f.calls.length, 1);
  assert.equal(a, b);
  assert.equal(f.calls[0].headers["x-api-key"], "test-key");
  assert.ok(!f.calls[0].url.includes("test-key"));
  assert.equal(f.calls[0].url, `${BASE}/events/?leagueID=AFL`);
  now += 61_000;
  await c.events({ leagueID: "AFL" });
  assert.equal(f.calls.length, 2);
});

test("429: clear limit message, no retry, and no further calls until Retry-After passes", async () => {
  let now = Date.parse("2026-10-06T00:00:00Z");
  const f = fakeFetch([{ status: 429, body: fixture("docs/error-429.json"), headers: { "retry-after": "30" } }]);
  const c = new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn, () => now);
  await assert.rejects(() => c.events({ leagueID: "AFL" }), (err: Error) => {
    assert.ok(err instanceof SockOddsError);
    assert.equal(err.status, 429);
    assert.match(err.message, /wait 30 s/);
    assert.match(err.message, /10 requests a minute/);
    assert.match(err.message, /does not retry/);
    return true;
  });
  assert.equal(f.calls.length, 1);
  // A different request inside the window is refused locally.
  await assert.rejects(() => c.events({ leagueID: "NRL" }), /rate limit/i);
  assert.equal(f.calls.length, 1);
  now += 31_000;
  await assert.rejects(() => c.events({ leagueID: "NRL" }));
  assert.equal(f.calls.length, 2);
});

test("401 and 500 give plain messages and are not retried or cached", async () => {
  const f = fakeFetch([
    { status: 401, body: fixture("docs/error-401.json") },
    { status: 500, body: { success: false, error: "Query failed" } },
  ]);
  const c = new SockOddsClient({ apiKey: "bad", baseUrl: BASE }, f.fn);
  await assert.rejects(() => c.leagues(), /rejected the API key \(HTTP 401\).*Invalid API key/);
  await assert.rejects(() => c.leagues(), /HTTP 500/);
  assert.equal(f.calls.length, 2);
});

test("a plan notice from SockOdds is passed through to the person", async () => {
  const f = fakeFetch([{ status: 200, body: fixture("docs/rate-limit-notice.json") }]);
  const deps = { source: new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn), timeZone: "UTC" };
  const text = await findEvent(deps, { query: "AFL" });
  assert.match(text, /SockOdds notice: Response is missing 3 events/);
  assert.match(text, /No events with open odds/);
});
