import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { bookMarketsAt, eventTitle, findMarket, groupMarkets, quotesFor } from "../src/markets.js";
import { americanToDecimal } from "../src/odds-math.js";
import { matchEvents, parseQuery } from "../src/search.js";
import type { Envelope, Odds, SockEvent } from "../src/types.js";

test("docs quickstart response: event, teams, start and per-book decimals parse", () => {
  const env = fixture<Envelope<SockEvent[]>>("docs/events-quickstart.json");
  assert.equal(env.success, true);
  const ev = env.data[0];
  assert.equal(eventTitle(ev), "Fremantle v Hawthorn");
  assert.equal(ev.status?.startsAt, "2026-09-03T09:40:00Z");
  // The odd/even market is not a main market, so it only shows with all markets.
  assert.equal(groupMarkets(ev).length, 0);
  const all = groupMarkets(ev, { mainOnly: false });
  assert.equal(all.length, 1);
  const quotes = all[0].sides[0].quotes;
  assert.deepEqual(quotes.map((q) => [q.bookmakerID, q.decimal, q.lastUpdatedAt]), [
    ["unibet", 1.87, "2026-09-03T10:22:09.000Z"],
    ["tabtouch", 1.85, "2026-09-03T10:21:03.000Z"],
  ]);
});

test("docs odds excerpt: head to head side with book and fair consensus", () => {
  const ex = fixture<{ odds: Record<string, Odds> }>("docs/event-odds-excerpt.json");
  const ev: SockEvent = { eventID: "x", odds: ex.odds };
  const h2h = findMarket(ev, "h2h")!;
  assert.equal(h2h.sides.length, 1);
  const side = h2h.sides[0];
  assert.equal(side.fairDecimal, americanToDecimal("-115"));
  assert.equal(side.bookDecimal, americanToDecimal("-108"));
  assert.deepEqual(side.quotes.map((q) => q.decimal), [1.93, 1.91]);
  const total = findMarket(ev, "total")!;
  assert.equal(total.sides[0].quotes[0].line, 165.5);
  assert.equal(total.sides[0].consensusLine, 165.5);
  // The excerpt's over quote has no bookmakerID field; the map key fills it in.
  assert.equal(total.sides[0].quotes[0].bookmakerID, "sportsbet");
});

test("docs homepage sample: pick markets without a sideID still parse", () => {
  const env = fixture<Envelope<SockEvent[]>>("docs/events-homepage-sample.json");
  const ev = env.data[0];
  assert.equal(eventTitle(ev), "afl_2026-09-12_brisbane_lions_vs_adelaide_crows");
  const quotes = quotesFor(ev.odds!["hsh-all-game-pick-2h"]);
  assert.equal(Math.max(...quotes.map((q) => q.decimal)), 1.95);
  assert.ok(quotes.every((q) => q.available));
});

test("decimal is worked out from American odds when a book omits it", () => {
  const quotes = quotesFor({ byBookmaker: { tab: { odds: "+150", available: true } } });
  assert.equal(quotes[0].decimal, 2.5);
});

test("demo fixture: main markets, line pairing and suspended books", () => {
  const ev = fixture<Envelope<SockEvent[]>>("demo/events-demo.json").data[0];
  const kinds = groupMarkets(ev).map((m) => m.kind);
  assert.deepEqual(kinds, ["h2h", "line", "total"]);
  const line = bookMarketsAt(findMarket(ev, "line")!);
  assert.equal(line.line, -2.5);
  // unibet quotes -3.5 / +3.5, so it is not in the -2.5 market
  assert.deepEqual(line.books.map((b) => b.bookmakerID), ["sportsbet", "tab"]);
  const h2h = bookMarketsAt(findMarket(ev, "h2h")!);
  // ladbrokes is suspended and has no away price
  assert.deepEqual(h2h.books.map((b) => b.bookmakerID), ["sportsbet", "tab", "unibet"]);
  const unibetLine = bookMarketsAt(findMarket(ev, "line")!, -3.5);
  assert.deepEqual(unibetLine.books, [{ bookmakerID: "unibet", decimals: [1.98, 1.84] }]);
});

test("query parsing pulls out leagues and team words", () => {
  assert.deepEqual(parseQuery("AFL grand final"), { leagueIDs: ["AFL"], tokens: [] });
  assert.deepEqual(parseQuery("What are the odds on Broncos v Bulldogs in the NRL?"), { leagueIDs: ["NRL"], tokens: ["broncos", "bulldogs"] });
  assert.deepEqual(parseQuery("State of Origin game 3").leagueIDs, ["RUGBYLEAGUE_STATE_ORIGIN"]);
  assert.deepEqual(parseQuery("NRLW grand final").leagueIDs, ["RUGBYLEAGUE_NRLW"]);
});

test("event matching ranks full matches first and understands nicknames", () => {
  const events = fixture<Envelope<SockEvent[]>>("demo/events-demo.json").data;
  const r = matchEvents(events, parseQuery("Broncos Bulldogs"));
  assert.equal(r[0].event.leagueID, "NRL");
  assert.equal(r[0].score, 1);
  const crows = matchEvents(events, parseQuery("crows"));
  assert.equal(crows.length, 1);
  assert.equal(crows[0].event.leagueID, "AFL");
  assert.equal(matchEvents(events, parseQuery("collingwood")).length, 0);
});
