import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBestPrice, type Quote } from "../src/odds-math.js";

const q = (bookmakerID: string, decimal: number, extra: Partial<Quote> = {}): Quote => ({ bookmakerID, decimal, available: true, ...extra });

test("picks the highest open price and orders the field", () => {
  const r = selectBestPrice([q("tab", 1.91), q("unibet", 1.95), q("sportsbet", 1.93)]);
  assert.deepEqual(r.best.map((x) => x.bookmakerID), ["unibet"]);
  assert.deepEqual(r.field.map((x) => x.decimal), [1.95, 1.93, 1.91]);
});

test("ignores prices that are not available even when they are higher", () => {
  const r = selectBestPrice([q("tab", 1.91), q("ladbrokes", 2.1, { available: false })]);
  assert.equal(r.best[0].bookmakerID, "tab");
  assert.deepEqual(r.excluded.map((x) => `${x.bookmakerID}:${x.reason}`), ["ladbrokes:not available"]);
});

test("compares only at the requested line", () => {
  const r = selectBestPrice([q("sportsbet", 1.9, { line: -2.5 }), q("unibet", 1.98, { line: -3.5 })], { line: -2.5 });
  assert.equal(r.best[0].bookmakerID, "sportsbet");
  assert.equal(r.excluded[0].reason, "different line");
});

test("returns every bookmaker tied on the top price", () => {
  const r = selectBestPrice([q("tab", 1.9), q("sportsbet", 1.9), q("neds", 1.8)]);
  assert.deepEqual(r.best.map((x) => x.bookmakerID), ["sportsbet", "tab"]);
});

test("empty when nothing is open", () => {
  const r = selectBestPrice([q("tab", 1.9, { available: false })]);
  assert.equal(r.best.length, 0);
  assert.equal(r.field.length, 0);
});
