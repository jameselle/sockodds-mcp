import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoSource, SockOddsClient, type FullSource, type Params } from "../src/client.js";
import { SockOddsError, errorFromResponse } from "../src/errors.js";
import { closingLine, findEv, findLowHolds, findMiddles, getResults, lineMoves, oddsHistory } from "../src/tools-analysis.js";
import { fakeFetch } from "./helpers.js";

const NOW = new Date("2026-11-19T03:15:00.000Z");
const EVENT = "ev_hc7rv2k9m4nq";

/** The demo data served as if read live just now, recording every call. */
function liveDemo(fail?: { path: string; err: SockOddsError }) {
  const demo = new DemoSource();
  const calls: Array<{ path: string; params: Params }> = [];
  const src = new Proxy(demo, {
    get(target, prop: string) {
      const fn = (target as any)[prop];
      if (typeof fn !== "function") return fn;
      return async (...args: any[]) => {
        const params = (args.find((a) => a && typeof a === "object") ?? {}) as Params;
        calls.push({ path: prop, params });
        if (fail && fail.path === prop) throw fail.err;
        const r = await fn.apply(target, args);
        return { ...r, source: "live", fetchedAt: NOW.toISOString() };
      };
    },
  }) as unknown as FullSource;
  return { deps: { source: src, timeZone: "Australia/Sydney", now: () => NOW }, calls };
}

const PRO_403 = new SockOddsError("plan", 403, undefined, "Plan restriction", "This endpoint requires Pro access.");

test("find_ev keeps to Australian bookmakers, names the fair price's source and counts 10 credits a page", async () => {
  const { deps, calls } = liveDemo();
  const out = await findEv(deps, { league_id: "NBA", min_ev_pct: 1 });
  assert.deepEqual(calls[0], { path: "bookmakers", params: { regions: "au", limit: 100 } });
  const ev = calls.find((c) => c.path === "ev")!;
  assert.equal(ev.params.league, "nba");
  assert.equal(ev.params.min_edge, 1);
  assert.equal(ev.params.limit, 100);
  assert.match(out, /Positive EV prices with the price at Australian bookmakers, NBA only:/);
  assert.match(out, /1\. \+5\.00% EV\. Harbour City Comets v Riverside Owls \(NBA\), Sat, 21 Nov 2026, 11:30 am AEDT \(00:30 UTC\)/);
  assert.match(out, /Price: Over 24\.5 2\.10 at TAB \(seen 19 Nov 03:07:52 UTC\)/);
  assert.match(out, /Fair price: 2\.00 \(50\.0% chance\), from Pinnacle's own market with its margin removed/);
  assert.match(out, /consensus of 4 other bookmakers/);
  assert.doesNotMatch(out, /DraftKings/);
  assert.match(out, /This answer used 10 credits/);
  assert.match(out, /not a guarantee/);
  assert.match(out, /18\+/);
});

test("find_ev with region all keeps every bookmaker and reads no bookmaker list", async () => {
  const { deps, calls } = liveDemo();
  const out = await findEv(deps, { region: "all" });
  assert.equal(calls.filter((c) => c.path === "bookmakers").length, 0);
  assert.match(out, /Showing 3 of 3/);
  assert.match(out, /Under 45\.5 2\.00 at DraftKings/);
  assert.match(out, /from Betfair Exchange's back and lay prices/);
});

test("a free key asking for +EV, middles, low holds, moves or the closing line gets the Pro trial and SockOdds' own words", async () => {
  const cases: Array<[string, (d: any) => Promise<string>, RegExp]> = [
    ["ev", (d) => findEv(d, {}), /does not include positive EV prices/],
    ["middles", (d) => findMiddles(d, {}), /does not include middles/],
    ["lowHolds", (d) => findLowHolds(d, {}), /does not include low holds/],
    ["moves", (d) => lineMoves(d, { league_id: "nba" }), /does not include line moves/],
    ["closing", (d) => closingLine(d, { event_id: EVENT }), /does not include the closing line/],
  ];
  for (const [path, run, what] of cases) {
    const { deps } = liveDemo({ path, err: PRO_403 });
    await assert.rejects(run(deps), (err: SockOddsError) => {
      assert.equal(err.status, 403);
      assert.match(err.message, what);
      assert.match(err.message, /SockOdds said: "This endpoint requires Pro access\."/);
      assert.match(err.message, /on Pro and Business, and on the free 7-day Pro trial/);
      assert.match(err.message, /Start free Pro trial/);
      return true;
    });
  }
});

test("find_middles shows the gap, both-win and one-win results; find_low_holds the hold", async () => {
  const { deps, calls } = liveDemo();
  const mid = await findMiddles(deps, { min_middle_pct: 50 });
  assert.equal(calls.find((c) => c.path === "middles")!.params.min_edge, 50);
  assert.match(mid, /1\. Middle 3 wide\. Port Mallow Gulls v Inland Rovers \(NFL\)/);
  assert.match(mid, /Over 44\.5: 2\.00 at Sportsbet/);
  assert.match(mid, /Under 47\.5: 1\.95 at TAB/);
  assert.match(mid, /both bets win: \+97\.47% of the total stake\. If only one wins: -1\.27%\./);
  assert.doesNotMatch(mid, /Pinnacle/);
  const low = await findLowHolds(deps, { max_hold_pct: 1 });
  assert.equal(calls.find((c) => c.path === "lowHolds")!.params.max_hold, 1);
  assert.match(low, /1\. Hold 0\.50%\. Harbour City Comets v Riverside Owls/);
  assert.match(low, /not an arbitrage/);
  assert.doesNotMatch(low, /Pinnacle/);
});

test("line_moves needs a league, checks the window and shows Australian moves with the others noted", async () => {
  const { deps, calls } = liveDemo();
  await assert.rejects(lineMoves(deps, { league_id: "nba", window_minutes: 7 }), /steps of 5/);
  const out = await lineMoves(deps, { league_id: "NBA", window_minutes: 120, steam_only: true });
  const moves = calls.find((c) => c.path === "moves")!;
  assert.equal(moves.params.league, "nba");
  assert.equal(moves.params.window, 120);
  assert.equal(moves.params.steam, true);
  assert.match(out, /STEAM, Pinnacle moved with the majority/);
  assert.match(out, /Handicap: home line -4\.5 to -6\.5/);
  assert.match(out, /Sportsbet -4\.5 to -6\.5 \(seen 19 Nov 02:26:00 UTC\)/);
  assert.match(out, /Also moved, outside this region: Pinnacle -4\.5 to -6\.5/);
  assert.match(out, /This answer used 10 credits/);
});

test("closing_line shows opening, closing and CLV per Australian bookmaker, and the CLV of a bet", async () => {
  const { deps, calls } = liveDemo();
  await assert.rejects(closingLine(deps, { event_id: EVENT, odds: 1.8 }), /outcome_id and odds together/);
  const out = await closingLine(deps, { event_id: EVENT, market: "h2h", outcome_id: "oc_hc7rv2k9m4nqwn00", odds: 1.8 });
  const c = calls.find((x) => x.path === "closing")!;
  assert.equal(c.params.markets, "winner");
  assert.equal(c.params.outcome_id, "oc_hc7rv2k9m4nqwn00");
  assert.match(out, /Winner: fair closing price from Pinnacle's closing market/);
  assert.match(out, /Harbour City Comets: fair close 1\.71/);
  assert.match(out, /Sportsbet: opened 1\.80 \(18 Nov 01:15:00 UTC\), closed 1\.65 \(19 Nov 00:29:10 UTC\), opening price beat the fair close by 5\.11%/);
  assert.match(out, /missed the fair close by 14\.71%/);
  assert.doesNotMatch(out, /DraftKings: opened/);
  assert.match(out, /4 prices at bookmakers outside Australian bookmakers were left out/);
  assert.match(out, /Your bet: Harbour City Comets at 1\.80 .*closing line value \+5\.14%, it beat the close/);
  assert.match(out, /This answer used 10 credits/);
});

test("odds_history reads the 24 hours before the start and summarises each bookmaker", async () => {
  const { deps, calls } = liveDemo();
  const out = await oddsHistory(deps, { event_id: EVENT });
  const h = calls.find((x) => x.path === "oddsHistory")!;
  assert.equal(h.params.from, "2026-11-18T00:30:00Z");
  assert.equal(h.params.to, "2026-11-19T00:30:00Z");
  assert.equal(h.params.markets, "winner");
  assert.equal(h.params.limit, 1000);
  assert.match(out, /Sportsbet: opened 1\.80 \(18 Nov 01:15:00 UTC\), latest 1\.65 \(19 Nov 00:29:00 UTC\), high 1\.80, low 1\.65, 3 changes/);
  assert.doesNotMatch(out, /Pinnacle:/);
  assert.match(out, /10 changes at bookmakers outside this region were left out/);
  assert.match(out, /10 times the live price/);
});

test("odds_history: a paid-plan 403 names Starter, and hours over 24 is refused locally", async () => {
  const { deps } = liveDemo({ path: "oddsHistory", err: new SockOddsError("plan", 403, undefined, "Plan restriction", "History needs a paid plan.") });
  await assert.rejects(oddsHistory(deps, { event_id: EVENT, hours: 30 }), /at most 24/);
  await assert.rejects(oddsHistory(deps, { event_id: EVENT }), (err: SockOddsError) => {
    assert.match(err.message, /does not include recorded price history/);
    assert.match(err.message, /every paid plan \(Starter, Pro and Business\)/);
    assert.match(err.message, /SockOdds said: "History needs a paid plan\."/);
    return true;
  });
});

test("get_results shows the score and the winning outcomes of the main markets", async () => {
  const { deps, calls } = liveDemo();
  await assert.rejects(getResults(deps, {}), /Give event_id .* or league_id/);
  const out = await getResults(deps, { league_id: "nba", days_back: 2 });
  const r = calls.find((x) => x.path === "results")!;
  assert.equal(r.params.league, "nba");
  assert.equal(r.params.starts_after, "2026-11-17T03:15:00Z");
  assert.match(out, /Score: Harbour City Comets 112, Riverside Owls 104/);
  assert.match(out, /Winner: Harbour City Comets won/);
  assert.match(out, /Handicap: Harbour City Comets -3\.5 won/);
  assert.match(out, /Total points: Under 216\.5 won/);
  assert.doesNotMatch(out, /Tobias Venn/);
  assert.match(out, /2 more graded outcomes in other markets/);
  assert.match(out, /This answer used 2 credits/);
  const one = await getResults(deps, { event_id: EVENT });
  assert.match(one, /Player points over\/under, Tobias Venn: Over 24\.5 won/);
  assert.match(one, /This answer used 1 credit\./);
});

test("the live client calls the v1 paths for the derived, history and results routes with a bearer key", async () => {
  const empty = { status: 200, body: { data: [], meta: { count: 0, cursor: null }, links: { next: null } } };
  const { fn, calls } = fakeFetch([empty]);
  const c = new SockOddsClient({ apiKey: "k_test", baseUrl: "https://api.sockodds.com/v1" }, fn);
  await c.ev({ league: "nba", limit: 100 });
  await c.middles({ league: "nfl" });
  await c.lowHolds({ max_hold: 1 });
  await c.moves({ league: "nba", window: 60 });
  await c.closing(EVENT, { markets: "winner" });
  await c.oddsHistory({ event_id: EVENT, from: "2026-11-18T00:30:00Z", to: "2026-11-19T00:30:00Z" });
  await c.results({ league: "nba" });
  await c.event(EVENT);
  assert.deepEqual(
    calls.map((x) => x.url.replace("https://api.sockodds.com/v1", "")),
    [
      "/opportunities/ev?league=nba&limit=100",
      "/opportunities/middles?league=nfl",
      "/opportunities/low-holds?max_hold=1",
      "/moves?league=nba&window=60",
      `/events/${EVENT}/closing?markets=winner`,
      `/odds/history?event_id=${EVENT}&from=2026-11-18T00%3A30%3A00Z&to=2026-11-19T00%3A30%3A00Z`,
      "/results?league=nba",
      `/events/${EVENT}`,
    ],
  );
  for (const x of calls) assert.equal(x.headers.authorization, "Bearer k_test");
});

test("a problem body's detail is kept on the error, so a tool can quote it", () => {
  const err = errorFromResponse(403, { title: "Plan restriction", status: 403, detail: "This endpoint requires Pro access." }, null);
  assert.equal(err.detail, "This endpoint requires Pro access.");
  assert.equal(err.title, "Plan restriction");
});
