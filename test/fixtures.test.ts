import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { MAIN_MARKET_KEYS, bookMarketsAt, eventTitle, findMarket, groupMarkets, objectsUsed } from "../src/markets.js";
import { matchEvents, parseQuery } from "../src/search.js";
import { getOdds, resolveLeagueKey, checkEventID } from "../src/tools.js";
import type { Envelope, League, OddsEvent, SockEvent } from "../src/types.js";
import type { OddsSource } from "../src/client.js";

/** A source that serves one fixed odds body, as if read live just now. */
function oneEvent(ev: OddsEvent, now: Date): OddsSource {
  const fetched = { data: ev, next: null, fetchedAt: now.toISOString(), source: "live" as const };
  return {
    leagues: async () => ({ ...fetched, data: [] }),
    events: async () => ({ ...fetched, data: [] }),
    eventOdds: async () => fetched,
  };
}

test("docs quickstart response: event, participants by role, winner prices at one bookmaker", () => {
  const env = fixture<Envelope<OddsEvent[]>>("docs/odds-quickstart.json");
  const ev = env.data[0];
  assert.equal(eventTitle(ev), "Australia v New Zealand");
  assert.equal(ev.scheduled_start, "2026-10-15T09:05:00.000Z");
  // The docs list the away side first; roles, not array order, say who is home.
  assert.equal(ev.participants[0].role, "away");
  const h2h = findMarket(ev, "h2h")!;
  assert.deepEqual(h2h.sides.map((s) => [s.side, s.label, s.quotes[0].decimal, s.quotes[0].bookmakerName]), [
    ["home", "Australia", 1.72, "Sportsbet"],
    ["away", "New Zealand", 2.12, "Sportsbet"],
  ]);
  assert.equal(h2h.sides[0].quotes[0].observedAt, "2026-10-15T07:58:00.000Z");
  assert.equal(objectsUsed(ev), 3);
});

test("docs handicap response: each outcome carries its own line and they pair up", () => {
  const ev = fixture<Envelope<OddsEvent>>("docs/odds-event-handicap.json").data;
  const line = findMarket(ev, "line")!;
  assert.equal(line.signed, true);
  assert.deepEqual(line.sides.map((s) => [s.side, s.quotes[0].line]), [["home", -6.5], ["away", 6.5]]);
  const pair = bookMarketsAt(line);
  assert.equal(pair.line, -6.5);
  assert.deepEqual(pair.books, [{ bookmakerID: "tab", decimals: [1.96, 1.96] }]);
});

test("docs withheld response: a finished game with no current prices says why", async () => {
  const ev = fixture<Envelope<OddsEvent>>("docs/odds-withheld.json").data;
  const now = new Date("2026-10-15T08:00:00Z");
  const text = await getOdds({ source: oneEvent(ev, now), timeZone: "UTC", now: () => now }, { event_id: ev.id });
  assert.match(text, /Status: finished/);
  assert.match(text, /No bookmaker has a current price/);
  assert.match(text, /ten minutes/);
  assert.match(text, /This answer used 1 object/);
});

test("docs events and leagues lists parse in the v1 shape", () => {
  const events = fixture<Envelope<SockEvent[]>>("docs/events-rlwc.json");
  assert.equal(events.data[0].league.key, "rlwc");
  assert.equal(events.links?.next, null);
  const leagues = fixture<Envelope<League[]>>("docs/leagues-rugby-league.json");
  assert.deepEqual(leagues.data.map((l) => l.key), ["nrl", "nrlw", "rlwc", "rlwcw"]);
});

test("demo fixture: main markets, line pairing and other periods", () => {
  const ev = fixture<Envelope<OddsEvent[]>>("demo/odds-demo.json").data[0];
  assert.deepEqual(groupMarkets(ev).map((m) => m.kind), ["h2h", "line", "total"]);
  const line = bookMarketsAt(findMarket(ev, "line")!);
  assert.equal(line.line, -2.5);
  // unibet quotes -3.5 / +3.5, so it is not in the -2.5 market
  assert.deepEqual(line.books.map((b) => b.bookmakerID), ["sportsbet", "tab"]);
  const h2h = bookMarketsAt(findMarket(ev, "h2h")!);
  assert.deepEqual(h2h.books.map((b) => b.bookmakerID), ["sportsbet", "tab", "unibet"]);
  const unibetLine = bookMarketsAt(findMarket(ev, "line")!, -3.5);
  assert.deepEqual(unibetLine.books, [{ bookmakerID: "unibet", decimals: [1.98, 1.84] }]);
  assert.equal(findMarket(ev, "total")!.label, "Total points");
  // The first-half winner is not a main market, so it only shows with all markets.
  const all = groupMarkets(ev, { mainOnly: false });
  assert.ok(all.some((m) => m.label === "Winner [period: half_1]" && m.kind === undefined));
});

test("every main market key is a v1 catalogue key and fits the 20-key filter limit", () => {
  assert.ok(MAIN_MARKET_KEYS.length <= 20);
  for (const k of MAIN_MARKET_KEYS) assert.match(k, /^[a-z][a-z0-9_]{1,47}$/);
});

test("query parsing pulls out v1 league keys and team words", () => {
  assert.deepEqual(parseQuery("AFL grand final"), { leagues: ["afl"], tokens: [] });
  assert.deepEqual(parseQuery("What are the odds on Broncos v Bulldogs in the NRL?"), { leagues: ["nrl"], tokens: ["broncos", "bulldogs"] });
  assert.deepEqual(parseQuery("Rugby League World Cup final").leagues, ["rlwc"]);
  assert.deepEqual(parseQuery("Rugby League World Cup Women's").leagues, ["rlwcw"]);
  assert.deepEqual(parseQuery("NRLW grand final").leagues, ["nrlw"]);
  assert.deepEqual(parseQuery("Premier League").leagues, ["epl"]);
});

test("league and event IDs: names map to keys, bad ones are refused", () => {
  assert.equal(resolveLeagueKey("AFL"), "afl");
  assert.equal(resolveLeagueKey("rlwc"), "rlwc");
  assert.equal(resolveLeagueKey("Champions League"), "champions_league");
  assert.equal(resolveLeagueKey("la liga"), "la_liga");
  assert.throws(() => resolveLeagueKey("Footy!"), /not a SockOdds league/);
  assert.equal(checkEventID(" ev_000ckk0nc1tg "), "ev_000ckk0nc1tg");
  assert.throws(() => checkEventID("ev_ABC"), /not a SockOdds event ID/);
});

test("event matching ranks full matches first and understands nicknames", () => {
  const events = fixture<Envelope<OddsEvent[]>>("demo/odds-demo.json").data;
  const r = matchEvents(events, parseQuery("Broncos Bulldogs"));
  assert.equal(r[0].event.league.key, "nrl");
  assert.equal(r[0].score, 1);
  const crows = matchEvents(events, parseQuery("crows"));
  assert.equal(crows.length, 1);
  assert.equal(crows[0].event.league.key, "afl");
  assert.equal(matchEvents(events, parseQuery("collingwood")).length, 0);
});
