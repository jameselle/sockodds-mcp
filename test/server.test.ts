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
  const r = await client.callTool({ name: "get_odds", arguments: { event_id: "afl_x" } });
  assert.equal(r.isError, true);
  assert.match(text(r), /No SockOdds API key is set/);
  assert.match(text(r), /utm_campaign=sockodds-mcp/);
});

test("demo mode answers end to end and is labelled as demo data", async () => {
  const client = await connect({ SOCKODDS_DEMO: "1" });
  const found = text(await client.callTool({ name: "find_event", arguments: { query: "Lions v Crows", league_id: "AFL" } }));
  assert.match(found, /DEMO DATA/);
  assert.match(found, /afl_2026-09-12_brisbane_lions_vs_adelaide_crows/);
  const best = text(
    await client.callTool({
      name: "best_price",
      arguments: { event_id: "afl_2026-09-12_brisbane_lions_vs_adelaide_crows", market: "h2h", side: "home" },
    }),
  );
  assert.match(best, /1\.95 at Unibet \(read 11 Sept 05:59:03 UTC\)/);
  assert.match(best, /Ladbrokes 2\.10 \(suspended\)/);
  assert.match(best, /18\+/);
});

test("a key turns demo mode off", () => {
  assert.equal(readSettings({ SOCKODDS_DEMO: "1", SOCKODDS_API_KEY: "k" }).demo, false);
});
