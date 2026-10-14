import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFetch, fixture } from "./helpers.js";
import { SockOddsClient } from "../src/client.js";
import { byBookmaker } from "../src/odds-shape.js";
import { getOdds, bestPrice, fairOdds } from "../src/tools.js";

// SockOdds groups odds by market by default (14 Oct 2026); with group_by=bookmaker, as in 1.0.x, by
// bookmaker. The tools must answer the same from either. Invented prices.
const BASE = "https://api.sockodds.com/v1";
const EVENT = "ev_000ckk0nc1tg";
const NOW = Date.parse("2026-10-15T08:00:00Z");
const NAMES: Record<string, string> = { tab: "TAB", sportsbet: "Sportsbet", pointsbet: "PointsBet" };

/** The fixture's one bookmaker, plus two more at shifted prices: the bookmaker grouping. */
function grouped() {
  const body = fixture("docs/odds-event-handicap.json");
  const [tab] = body.data.bookmakers;
  const copy = (key: string, shift: number) => ({
    key, name: NAMES[key],
    markets: tab.markets.map((m: any) => ({ ...m, outcomes: m.outcomes.map((o: any) => ({ ...o, bookmaker: key, decimal_odds: +(o.decimal_odds + shift).toFixed(2), implied_probability: +(1 / (o.decimal_odds + shift)).toFixed(6) })) })),
  });
  body.data.bookmakers = [copy("pointsbet", 0.04), copy("sportsbet", -0.03), tab];
  return body;
}

/** The same prices as the API's default sends them: each market and outcome once, prices best first. */
function byMarket(body: any) {
  const markets = new Map<string, any>();
  for (const b of body.data.bookmakers) for (const m of b.markets) {
    const market = markets.get(m.id) ?? { id: m.id, key: m.key, name: m.name, period: m.period, subject: m.subject, alternate: false, outcomes: [] };
    markets.set(m.id, market);
    for (const o of m.outcomes) {
      let outcome = market.outcomes.find((x: any) => x.id === o.id);
      if (!outcome) market.outcomes.push(outcome = { id: o.id, name: o.name, side: o.side, line: o.line, prices: [] });
      market.alternate ||= o.alternate;
      outcome.prices.push({ bookmaker: o.bookmaker, decimal_odds: o.decimal_odds, implied_probability: o.implied_probability, available: o.available ?? true, observed_at: o.observed_at });
    }
  }
  for (const m of markets.values()) for (const o of m.outcomes) o.prices.sort((a: any, b: any) => b.decimal_odds - a.decimal_odds || a.bookmaker.localeCompare(b.bookmaker));
  const { bookmakers: _omit, ...event } = body.data;
  return { ...body, data: { ...event, markets: [...markets.values()] } };
}
const catalogue = { data: Object.entries(NAMES).map(([key, name]) => ({ key, name })), meta: { count: 3, cursor: null }, links: { next: null } };

async function answers(replies: Array<{ status: number; body: unknown }>) {
  const f = fakeFetch(replies);
  const deps = { source: new SockOddsClient({ apiKey: "k", baseUrl: BASE }, f.fn, () => NOW), timeZone: "UTC", now: () => new Date(NOW) };
  const text = [
    await getOdds(deps, { event_id: EVENT }),
    await bestPrice(deps, { event_id: EVENT, market: "line", side: "home" }),
    await fairOdds(deps, { event_id: EVENT, market: "line" }),
  ];
  return { text, calls: f.calls.map((c) => c.url) };
}

test("the tools answer the same from the market grouping as from the bookmaker grouping", async () => {
  const old = await answers([{ status: 200, body: grouped() }]);
  const now = await answers([{ status: 200, body: byMarket(grouped()) }, { status: 200, body: catalogue }, { status: 200, body: byMarket(grouped()) }]);
  // Word for word, except that the first answer also counts the bookmaker catalogue it read (3 bookmakers).
  const used = (t: string) => Number(/used (\d+) object/.exec(t)?.[1]);
  assert.equal(used(now.text[0]), used(old.text[0]) + 3);
  assert.deepEqual(now.text.slice(1), old.text.slice(1));
  assert.deepEqual(now.text[0].replace(/used \d+ object/, ""), old.text[0].replace(/used \d+ object/, ""));
  assert.match(now.text[1], /PointsBet/);
});

test("the default is requested (no group_by); bookmaker names are read once, only for a market-grouped answer", async () => {
  const old = await answers([{ status: 200, body: grouped() }]);
  assert.ok(old.calls.every((u) => u.startsWith(`${BASE}/events/${EVENT}/odds`) && !u.includes("group_by")));
  const now = await answers([{ status: 200, body: byMarket(grouped()) }, { status: 200, body: catalogue }, { status: 200, body: byMarket(grouped()) }]);
  assert.equal(now.calls.filter((u) => u === `${BASE}/bookmakers?limit=100`).length, 1);
  assert.equal(now.calls[1], `${BASE}/bookmakers?limit=100`);
  assert.ok(now.calls.every((u) => !u.includes("group_by")));
});

test("without the bookmaker catalogue, keys stand in for names and prices are unchanged", () => {
  const ev = byBookmaker(byMarket(grouped()).data);
  assert.deepEqual(ev.bookmakers!.map((b) => [b.key, b.name]), [["pointsbet", "pointsbet"], ["sportsbet", "sportsbet"], ["tab", "tab"]]);
  const prices = (e: any) => e.bookmakers.flatMap((b: any) => b.markets.flatMap((m: any) => m.outcomes.map((o: any) => [b.key, o.id, o.decimal_odds, o.line, o.alternate]))).sort();
  assert.deepEqual(prices(ev), prices(grouped().data));
  assert.equal(ev.markets, undefined);
});

test("an event already grouped by bookmaker passes through untouched", () => {
  const ev = grouped().data;
  assert.equal(byBookmaker(ev), ev);
});
