import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { readSettings } from "../src/config.js";

async function connect(env: Record<string, string>) {
  const server = createServer(readSettings(env));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

test("lists the five tools, all read only", async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["best_price", "fair_odds", "find_event", "get_odds", "list_leagues"]);
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true);
  const fair = tools.find((t) => t.name === "fair_odds")!;
  assert.match(fair.description!, /proportional method/);
});

test("without a key, an odds tool returns an error result with the signup link", async () => {
  const client = await connect({});
  const r = await client.callTool({ name: "get_odds", arguments: { event_id: "ev_000ckk0nc1tg" } });
  assert.equal(r.isError, true);
  assert.match(text(r), /No SockOdds API key is set/);
  assert.match(text(r), /utm_campaign=sockodds-mcp/);
});

test("the old odd_id argument is gone; best_price takes outcome_id", async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  const props = Object.keys((tools.find((t) => t.name === "best_price")!.inputSchema as any).properties);
  assert.deepEqual(props.sort(), ["event_id", "line", "market", "outcome_id", "side"]);
});

const AFL = "ev_kqe6aepys23z";

test("demo mode answers end to end and is labelled as demo data", async () => {
  const client = await connect({ SOCKODDS_DEMO: "1" });
  const found = text(await client.callTool({ name: "find_event", arguments: { query: "Lions v Crows", league_id: "AFL" } }));
  assert.match(found, /DEMO DATA/);
  assert.match(found, new RegExp(`Event ID: ${AFL}`));
  assert.match(found, /Brisbane Lions v Adelaide Crows \(AFL\)/);
  const best = text(await client.callTool({ name: "best_price", arguments: { event_id: AFL, market: "h2h", side: "home" } }));
  assert.match(best, /1\.95 at Unibet \(seen 11 Sept 05:59:03 UTC\)/);
  assert.match(best, /TAB 1\.91, seen 11 Sept 06:01:40 UTC/);
  assert.match(best, /18\+/);
  const line = text(await client.callTool({ name: "best_price", arguments: { event_id: AFL, market: "line", side: "away" } }));
  assert.match(line, /Best price: Adelaide Crows, Line \(handicap\) at line \+2\.5/);
  assert.match(line, /Unibet \+3\.5 1\.84, seen .* \[different line\]/);
  const fair = text(await client.callTool({ name: "fair_odds", arguments: { event_id: AFL, market: "h2h" } }));
  assert.match(fair, /No-vig fair odds: Head to head, from 3 bookmakers/);
  assert.match(fair, /Brisbane Lions: fair 2\.03 \(49\.3% chance\)/);
  const odds = text(await client.callTool({ name: "get_odds", arguments: { event_id: AFL } }));
  assert.match(odds, /Head to head\n  Brisbane Lions: best 1\.95 at Unibet/);
  assert.match(odds, /Total points\n  Over: best 1\.90 at Sportsbet \(line 165\.5\)/);
  assert.doesNotMatch(odds, /half_1/);
});

test("demo mode: all_markets shows other periods with an outcome_id that best_price accepts", async () => {
  const client = await connect({ SOCKODDS_DEMO: "1" });
  const all = text(await client.callTool({ name: "get_odds", arguments: { event_id: AFL, all_markets: true } }));
  const m = /Winner \[period: half_1\]\n  Brisbane Lions: best 1\.90 at Sportsbet \[outcome_id (oc_[0-9a-z]{16})\]/.exec(all);
  assert.ok(m, all);
  const best = text(await client.callTool({ name: "best_price", arguments: { event_id: AFL, outcome_id: m[1] } }));
  assert.match(best, /Best price: Brisbane Lions, Winner \[period: half_1\]/);
  assert.match(best, /1\.90 at Sportsbet/);
});

test("demo mode: an unknown v1 event is a clear not found", async () => {
  const client = await connect({ SOCKODDS_DEMO: "1" });
  const r = await client.callTool({ name: "get_odds", arguments: { event_id: "ev_000000000000" } });
  assert.equal(r.isError, true);
  assert.match(text(r), /HTTP 404/);
});

test("a key turns demo mode off", () => {
  assert.equal(readSettings({ SOCKODDS_DEMO: "1", SOCKODDS_API_KEY: "k" }).demo, false);
});
