import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBestPrice, type Quote } from "../src/odds-math.js";

const q = (bookmakerID: string, decimal: number, extra: Partial<Quote> = {}): Quote => ({ bookmakerID, decimal, available: true, ...extra });
const NOW = new Date("2026-09-11T06:05:00Z");

test("picks the highest open price and orders the field", () => {
  const r = selectBestPrice([q("tab", 1.91), q("unibet", 1.95), q("sportsbet", 1.93)], { now: NOW });
  assert.deepEqual(r.best.map((x) => x.bookmakerID), ["unibet"]);
  assert.deepEqual(r.field.map((x) => x.decimal), [1.95, 1.93, 1.91]);
});

test("ignores suspended and expired prices even when they are higher", () => {
  const r = selectBestPrice(
    [q("tab", 1.91), q("ladbrokes", 2.1, { available: false }), q("neds", 2.5, { expiresAt: "2026-09-11T06:00:00Z" })],
    { now: NOW },
  );
  assert.equal(r.best[0].bookmakerID, "tab");
  assert.deepEqual(r.excluded.map((x) => `${x.bookmakerID}:${x.reason}`).sort(), ["ladbrokes:suspended", "neds:expired"]);
});

test("compares only at the requested line", () => {
  const r = selectBestPrice([q("sportsbet", 1.9, { line: -2.5 }), q("unibet", 1.98, { line: -3.5 })], { line: -2.5, now: NOW });
  assert.equal(r.best[0].bookmakerID, "sportsbet");
  assert.equal(r.excluded[0].reason, "different line");
});

test("returns every bookmaker tied on the top price", () => {
  const r = selectBestPrice([q("tab", 1.9), q("sportsbet", 1.9), q("neds", 1.8)], { now: NOW });
  assert.deepEqual(r.best.map((x) => x.bookmakerID), ["sportsbet", "tab"]);
});

test("empty when nothing is open", () => {
  const r = selectBestPrice([q("tab", 1.9, { available: false })], { now: NOW });
  assert.equal(r.best.length, 0);
  assert.equal(r.field.length, 0);
});
