import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoSource, SockOddsClient, type FullSource, type Params } from "../src/client.js";
import { SockOddsError } from "../src/errors.js";
import { checkRaceID, listRaces, raceForm, raceOdds, raceResult, racingArbs, racingMovers } from "../src/tools-racing.js";
import { fakeFetch } from "./helpers.js";

const NOW = new Date("2026-11-19T03:15:00.000Z");
const R3 = "thoroughbred_2026-11-19_AUS_kestrel_downs_r3";
const R1 = "thoroughbred_2026-11-19_AUS_kestrel_downs_r1";

function liveDemo(fail?: { path: string; err: SockOddsError }) {
  const demo = new DemoSource();
  const calls: Array<{ path: string; params: Params; id?: string }> = [];
  const src = new Proxy(demo, {
    get(target, prop: string) {
      const fn = (target as any)[prop];
      if (typeof fn !== "function") return fn;
      return async (...args: any[]) => {
        const params = (args.find((a) => a && typeof a === "object") ?? {}) as Params;
        calls.push({ path: prop, params, id: typeof args[0] === "string" ? args[0] : undefined });
        if (fail && fail.path === prop) throw fail.err;
        const r = await fn.apply(target, args);
        return { ...r, source: "live", fetchedAt: NOW.toISOString() };
      };
    },
  }) as unknown as FullSource;
  return { deps: { source: src, timeZone: "Australia/Sydney", now: () => NOW }, calls };
}

test("race IDs are checked locally; an ev_ ID is refused with a pointer to list_races", () => {
  assert.equal(checkRaceID(` ${R3} `), R3);
  assert.throws(() => checkRaceID("ev_hc7rv2k9m4nq"), /not a SockOdds race ID.*list_races/);
});

test("list_races asks for Australian races in a window and groups them by meeting with race IDs", async () => {
  const { deps, calls } = liveDemo();
  const out = await listRaces(deps, { hours_ahead: 6 });
  const r = calls.find((c) => c.path === "races")!;
  assert.equal(r.params.country, "AUS");
  assert.equal(r.params.starts_after, "2026-11-19T02:45:00Z");
  assert.equal(r.params.starts_before, "2026-11-19T09:15:00Z");
  assert.match(out, /Kestrel Downs \(thoroughbred, NSW\), Thu 19 Nov, track GOOD4/);
  assert.match(out, /R3 3:40 pm AEDT \(04:40 UTC\), Kestrel Downs Maiden Plate, 1200 m, MDN: thoroughbred_2026-11-19_AUS_kestrel_downs_r3/);
  assert.match(out, /Marrow Flat \(greyhound, VIC\)/);
  assert.doesNotMatch(out, /Ashby Park/);
  const all = await listRaces(deps, { country: "all", meeting: "ashby" });
  assert.match(all, /Ashby Park \(harness, NZ\)/);
  assert.doesNotMatch(all, /Kestrel/);
});

test("a Developer key asking for racing is told racing is on every paid plan", async () => {
  const { deps } = liveDemo({ path: "races", err: new SockOddsError("plan", 403, undefined, "Plan restriction", "Racing needs a paid plan.") });
  await assert.rejects(listRaces(deps, {}), (err: SockOddsError) => {
    assert.match(err.message, /does not include racing \(HTTP 403, Plan restriction\)\. SockOdds said: "Racing needs a paid plan\."/);
    assert.match(err.message, /every paid plan \(Starter, Pro and Business\)/);
    return true;
  });
});

test("race_odds shows the best win and place, Betfair back and lay, and marks scratchings and stale prices", async () => {
  const { deps } = liveDemo();
  const out = await raceOdds(deps, { race_id: R3 });
  assert.match(out, /Kestrel Downs R3, Kestrel Downs Maiden Plate, 1200 m \(thoroughbred, NSW\)/);
  assert.match(out, /Starts: Thu, 19 Nov 2026, 3:40 pm AEDT \(04:40 UTC\)/);
  assert.match(out, /1\. Copper Lantern \(barrier 4\)\n   Best win 4\.80 at TAB, best place 1\.90 at TAB/);
  assert.match(out, /Betfair Exchange win: back 5\.00 \(\$120\.50 available\), lay 5\.20 \(\$64\.00\), \$2,310\.40 matched/);
  assert.match(out, /4\. Paper Comet \(barrier 3\): SCRATCHED/);
  // PointsBet's 7.00 on Salt Road is stale, so the best is TAB's 6.50.
  assert.match(out, /Best win 6\.50 at TAB/);
  assert.match(out, /PointsBet 7\.00\/2\.40 \(not available\)/);
  assert.match(out, /about 1 credit/);
});

test("an unknown race is a 404 that points at list_races", async () => {
  const { deps } = liveDemo();
  await assert.rejects(raceOdds(deps, { race_id: "thoroughbred_2026-11-19_AUS_nowhere_r9" }), /no race with that ID \(HTTP 404.*list_races/);
});

test("racing_arbs works out the lay stake, liability and profit, and warns when the lay size is short", async () => {
  const { deps, calls } = liveDemo();
  const out = await racingArbs(deps, { back_stake: 100, min_margin_pct: 0.5, hours_ahead: 2 });
  const a = calls.find((c) => c.path === "racingArbs")!;
  assert.equal(a.params.country, "AUS");
  assert.equal(a.params.min_margin, 0.005);
  assert.equal(a.params.starts_before, "2026-11-19T05:15:00Z");
  assert.match(out, /1\. 5\.82% profit on the back stake\. Marrow Flat R2 \(greyhound, VIC\)/);
  assert.match(out, /Back \$100\.00 at 4\.40 with TAB/);
  assert.match(out, /Lay \$111\.39 at 4\.00 on Betfair Exchange \(liability \$334\.17/);
  assert.match(out, /you keep about \$5\.82 after commission/);
  assert.match(out, /Only \$45\.00 is available at that lay price, less than the lay stake/);
  assert.doesNotMatch(out, /Tussock Gold/);
  assert.match(out, /This answer used 10 credits/);
});

test("racing arbs and movers on a plan without them explain Pro, not just a paid plan", async () => {
  for (const [path, run, what] of [
    ["racingArbs", (d: any) => racingArbs(d, {}), /does not include racing arbs/],
    ["racingMovers", (d: any) => racingMovers(d, {}), /does not include market movers/],
  ] as const) {
    const { deps } = liveDemo({ path, err: new SockOddsError("plan", 403, undefined, "Plan restriction") });
    await assert.rejects(run(deps), (err: SockOddsError) => {
      assert.match(err.message, what);
      assert.match(err.message, /on Pro and Business, and on the free 7-day Pro trial/);
      return true;
    });
  }
});

test("racing_movers says firming or drifting with the opening and current prices", async () => {
  const { deps, calls } = liveDemo();
  const out = await racingMovers(deps, { direction: "firming", min_change_pct: 20 });
  const m = calls.find((c) => c.path === "racingMovers")!;
  assert.equal(m.params.direction, "firming");
  assert.equal(m.params.min_change, 0.2);
  assert.match(out, /1\. Firming 26%: 2\. Midnight Ledger, Kestrel Downs R3/);
  assert.match(out, /Opened 4\.40 at Sportsbet \(18 Nov 22:10:00 UTC\); now median 3\.25 across 3 bookmakers, best 3\.30 at Sportsbet/);
  assert.doesNotMatch(out, /Rusty Compass/);
});

test("race_result lists placings with prices paid, scratchings and dividends", async () => {
  const { deps } = liveDemo();
  const out = await raceResult(deps, { race_id: R1 });
  assert.match(out, /1st: 3\. Ironbark Belle, fixed 3\.80\/1\.55, tote 4\.10\/1\.60, BSP 4\.25/);
  assert.match(out, /4th: 5\. Velvet Gully, fixed 12\.00\/3\.20, tote 13\.40\/3\.50\n/);
  assert.match(out, /Scratched: 9 \(win deduction 0\.08, place 0\.03\)/);
  assert.match(out, /Place: 3 \$1\.60, 7 \$2\.05, 1 \$1\.35/);
  assert.match(out, /First four: 3-7-1-5 \$412\.60/);
  assert.match(out, /This answer used 1 credit/);
});

test("race_form lists each runner's recorded starts, newest first, up to the number asked", async () => {
  const { deps, calls } = liveDemo();
  const out = await raceForm(deps, { race_id: R3, starts: 1 });
  assert.equal(calls.find((c) => c.path === "raceForm")!.params.limit, 1);
  assert.match(out, /1\. Copper Lantern, form x32\n   Mon 2 Nov Gully Vale R2 1100 m MDN SOFT5: 2nd of 11, A Fenwick, trainer M Ashgrove, barrier 3, 57 kg \(started fixed 6\.50, tote 7\.10, BSP 7\.40\)\n\n/);
  assert.doesNotMatch(out, /Thu 15 Oct/);
  assert.match(out, /unplaced \(5th or worse\) of 12/);
  assert.match(out, /4\. Paper Comet\n   No starts recorded since 1 August 2026\./);
});

test("the live client calls the v1 racing paths", async () => {
  const empty = { status: 200, body: { data: [], meta: { count: 0, cursor: null }, links: { next: null } } };
  const { fn, calls } = fakeFetch([empty]);
  const c = new SockOddsClient({ apiKey: "k_test", baseUrl: "https://api.sockodds.com/v1" }, fn);
  await c.races({ country: "AUS", limit: 100 });
  await c.raceOdds(R3);
  await c.racingArbs({ country: "AUS" });
  await c.racingMovers({ direction: "firming" });
  await c.raceResult(R1);
  await c.raceForm(R3, { limit: 3 });
  assert.deepEqual(
    calls.map((x) => x.url.replace("https://api.sockodds.com/v1", "")),
    [
      "/racing/races?country=AUS&limit=100",
      `/racing/races/${R3}/odds`,
      "/racing/arbs?country=AUS",
      "/racing/movers?direction=firming",
      `/racing/races/${R1}/result`,
      `/racing/races/${R3}/form?limit=3`,
    ],
  );
  for (const x of calls) assert.equal(x.headers.authorization, "Bearer k_test");
});

test("demo mode answers every new tool end to end through the MCP server, labelled as demo data", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createServer } = await import("../src/server.js");
  const { readSettings } = await import("../src/config.js");
  const server = createServer(readSettings({ SOCKODDS_DEMO: "1" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["find_ev", {}],
    ["find_middles", {}],
    ["find_low_holds", {}],
    ["line_moves", { league_id: "nba" }],
    ["closing_line", { event_id: "ev_hc7rv2k9m4nq" }],
    ["odds_history", { event_id: "ev_hc7rv2k9m4nq", to: "2026-11-19T00:30:00Z" }],
    ["get_results", { event_id: "ev_hc7rv2k9m4nq" }],
    ["list_races", {}],
    ["race_odds", { race_id: R3 }],
    ["racing_arbs", {}],
    ["racing_movers", {}],
    ["race_result", { race_id: R1 }],
    ["race_form", { race_id: R3 }],
  ];
  for (const [name, args] of calls) {
    const r: any = await client.callTool({ name, arguments: args });
    const out = r.content.map((c: any) => c.text).join("\n");
    assert.notEqual(r.isError, true, `${name}: ${out}`);
    assert.match(out, /^DEMO DATA/, name);
    assert.doesNotMatch(out, /credits?\b.*used|used \d+ credit/, `${name} claims demo data cost credits`);
    assert.doesNotMatch(out, /undefined|null|NaN/, `${name} printed a missing value`);
  }
});
