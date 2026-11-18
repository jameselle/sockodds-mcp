import { test } from "node:test";
import assert from "node:assert/strict";
import { SockOddsClient, type OddsSource, type Params } from "../src/client.js";
import { SockOddsError } from "../src/errors.js";
import { findArbs } from "../src/tools.js";
import type { Arb, Bookmaker, Fetched } from "../src/types.js";
import { fakeFetch, fixture } from "./helpers.js";

const NOW = new Date("2026-11-18T03:15:00.000Z");
const DEMO_ARBS = fixture<{ data: Arb[] }>("demo/arbs-demo.json").data;
const BOOKS = fixture<{ data: Bookmaker[] }>("demo/bookmakers-demo.json").data;

/** A live-looking source that records every call and serves arbs in pages of `pageSize`. */
function source(arbs: Arb[], opts: { pageSize?: number; fail?: SockOddsError } = {}) {
  const calls: Array<{ path: string; params: Params }> = [];
  const live = <T>(data: T, next: string | null = null): Fetched<T> => ({ data, next, fetchedAt: NOW.toISOString(), source: "live" });
  const src: OddsSource = {
    leagues: async () => live([]),
    events: async () => live([]),
    eventOdds: async () => { throw new Error("not used"); },
    bookmakers: async (params = {}) => {
      calls.push({ path: "/bookmakers", params });
      const regions = String(params.regions ?? "").split(",").filter(Boolean);
      return live(BOOKS.filter((b) => !regions.length || (b.regions ?? []).some((r) => regions.includes(r))));
    },
    arbs: async (params = {}) => {
      calls.push({ path: "/opportunities/arbs", params });
      if (opts.fail) throw opts.fail;
      const size = opts.pageSize ?? 100;
      const from = Number(params.cursor ?? 0);
      const next = from + size < arbs.length ? `https://api.sockodds.com/v1/opportunities/arbs?limit=${size}&cursor=${from + size}` : null;
      return live(arbs.slice(from, from + size), next);
    },
  };
  return { src, calls };
}

const deps = (src: OddsSource) => ({ source: src, timeZone: "Australia/Sydney", now: () => NOW });

test("by default only arbs with every bet at an Australian bookmaker are shown", async () => {
  const { src, calls } = source(DEMO_ARBS);
  const out = await findArbs(deps(src), {});
  assert.deepEqual(calls[0], { path: "/bookmakers", params: { regions: "au", limit: 100 } });
  assert.equal(calls[1].path, "/opportunities/arbs");
  assert.equal(calls[1].params.limit, 100);
  assert.match(out, /Arbitrage with every bet at Australian bookmakers:/);
  assert.match(out, /Showing 2 of 2, best profit first\./);
  assert.doesNotMatch(out, /Pinnacle/);
  assert.match(out, /1 other arb was left out because a bet was at a bookmaker outside this region\./);
  assert.match(out, /Home: 2\.10 at Neds, stake \$48\.78 \(seen 18 Nov 03:11:52 UTC\)/);
  assert.match(out, /Away: 2\.00 at TAB, stake \$51\.22/);
  assert.match(out, /\$100\.00 returns about \$102\.44 whichever side wins\./);
  assert.match(out, /Home -3\.5: 2\.05 at Sportsbet/);
  assert.match(out, /Away \+3\.5: 2\.02 at PointsBet/);
  assert.match(out, /This answer used 10 credits/);
  assert.match(out, /check each price at the bookmaker/);
  assert.match(out, /18\+/);
});

test("region all keeps every bookmaker and reads no bookmaker list", async () => {
  const { src, calls } = source(DEMO_ARBS);
  const out = await findArbs(deps(src), { region: "all" });
  assert.equal(calls.filter((c) => c.path === "/bookmakers").length, 0);
  assert.match(out, /Showing 3 of 3/);
  assert.match(out, /Over 221\.5: 2\.08 at Pinnacle/);
  assert.doesNotMatch(out, /left out/);
});

test("league, minimum profit and stake are passed through and used", async () => {
  const { src, calls } = source(DEMO_ARBS);
  const out = await findArbs(deps(src), { league_id: "NBA", min_profit_pct: 1, stake: 250 });
  assert.equal(calls[1].params.league, "nba");
  assert.equal(calls[1].params.min_edge, 1);
  assert.match(out, /NBA only/);
  assert.match(out, /\$250\.00 returns about \$256\.10/);
});

test("when every arb has a bet outside the region, it says so instead of showing them", async () => {
  const { src } = source(DEMO_ARBS.slice(0, 1));
  const out = await findArbs(deps(src), {});
  assert.match(out, /None right now\. SockOdds listed 1 arb, but each had a bet at a bookmaker outside this region\./);
  assert.doesNotMatch(out, /Pinnacle/);
});

test("an empty list says so and costs nothing", async () => {
  const { src } = source([]);
  const out = await findArbs(deps(src), {});
  assert.match(out, /None listed right now/);
  assert.doesNotMatch(out, /credits/);
});

test("follows the next page at most three times and says when more are left", async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ ...DEMO_ARBS[1], id: `op_${i}` }));
  const { src, calls } = source(many, { pageSize: 2 });
  const out = await findArbs(deps(src), {});
  const pages = calls.filter((c) => c.path === "/opportunities/arbs");
  assert.deepEqual(pages.map((c) => c.params.cursor), [undefined, "2", "4"]);
  assert.match(out, /Showing 6 of 6/);
  assert.match(out, /more arbs than the 6 read here/);
  assert.match(out, /This answer used 30 credits/);
});

test("a free key gets the Pro trial explained, not the free plan's leagues", async () => {
  const { src } = source([], { fail: new SockOddsError("plan", 403, undefined, "Plan restriction") });
  await assert.rejects(findArbs(deps(src), {}), (err: SockOddsError) => {
    assert.equal(err.status, 403);
    assert.match(err.message, /does not include arbitrage/);
    assert.match(err.message, /Start free Pro trial/);
    assert.match(err.message, /https:\/\/sockodds\.com\/account\//);
    return true;
  });
});

test("the live client calls /v1/opportunities/arbs and /v1/bookmakers with the key as a bearer header", async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { data: [], meta: { count: 0, cursor: null }, links: { next: null } } }]);
  const client = new SockOddsClient({ apiKey: "k_test", baseUrl: "https://api.sockodds.com/v1" }, fn);
  await client.arbs({ league: "nba", limit: 100 });
  await client.bookmakers({ regions: "au", limit: 100 });
  assert.equal(calls[0].url, "https://api.sockodds.com/v1/opportunities/arbs?league=nba&limit=100");
  assert.equal(calls[1].url, "https://api.sockodds.com/v1/bookmakers?limit=100&regions=au");
  assert.equal(calls[0].headers.authorization, "Bearer k_test");
});

test("demo mode answers find_arbs end to end through the MCP server, labelled as demo data", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createServer } = await import("../src/server.js");
  const { readSettings } = await import("../src/config.js");
  const server = createServer(readSettings({ SOCKODDS_DEMO: "1" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const r: any = await client.callTool({ name: "find_arbs", arguments: {} });
  const out = r.content.map((c: any) => c.text).join("\n");
  assert.notEqual(r.isError, true);
  assert.match(out, /DEMO DATA/);
  assert.match(out, /Showing 2 of 2/);
  assert.doesNotMatch(out, /Pinnacle/);
  assert.doesNotMatch(out, /credits/);
});

test("home and away are named from the free events list, one call per league shown", async () => {
  const { src, calls } = source(DEMO_ARBS);
  const team = (key: string, name: string) => ({ key, name });
  src.events = async (params = {}) => {
    calls.push({ path: "/events", params });
    const ev = (id: string, league: string, home: string, away: string) => ({
      id, name: `${home} v ${away}`, league: team(league, league.toUpperCase()), scheduled_start: "2026-11-19T00:30:00.000Z", status: "scheduled" as const,
      participants: [{ role: "away" as const, identity: team("a", away) }, { role: "home" as const, identity: team("h", home) }],
    });
    const data = params.league === "nba" ? [ev("ev_demo0000000b", "nba", "Harbour City Comets", "Riverside Owls")] : [ev("ev_demo0000000c", "nfl", "Port Mallow Gulls", "Inland Rovers")];
    return { data, next: null, fetchedAt: NOW.toISOString(), source: "live" };
  };
  const out = await findArbs(deps(src), {});
  const lookups = calls.filter((c) => c.path === "/events");
  assert.deepEqual(lookups.map((c) => c.params.league).sort(), ["nba", "nfl"]);
  assert.equal(lookups.find((c) => c.params.league === "nba")!.params.starts_after, "2026-11-18T23:30:00Z");
  assert.match(out, /Harbour City Comets: 2\.10 at Neds/);
  assert.match(out, /Riverside Owls: 2\.00 at TAB/);
  assert.match(out, /Port Mallow Gulls -3\.5: 2\.05 at Sportsbet/);
  assert.match(out, /Inland Rovers \+3\.5: 2\.02 at PointsBet/);
});

test("if the team lookup fails, the arbs still come back with Home and Away", async () => {
  const { src } = source(DEMO_ARBS);
  src.events = async () => { throw new SockOddsError("rate limited", 429, 30); };
  const out = await findArbs(deps(src), {});
  assert.match(out, /Home: 2\.10 at Neds/);
  assert.match(out, /Showing 2 of 2/);
});

test("an arb with no event name falls back to the teams, then the event ID", async () => {
  const unnamed = DEMO_ARBS.slice(1).map((a) => ({ ...a, event: { ...a.event, name: null } }));
  const { src } = source(unnamed);
  const out = await findArbs(deps(src), {});
  assert.match(out, /% profit\. Event ev_demo0000000b \(NBA\)/);
  assert.doesNotMatch(out, /null/);
});
