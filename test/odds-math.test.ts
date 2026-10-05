import { test } from "node:test";
import assert from "node:assert/strict";
import { americanToDecimal, consensusFairOdds, devigProportional, impliedProbability } from "../src/odds-math.js";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test("americanToDecimal converts both signs and rejects junk", () => {
  close(americanToDecimal("+240")!, 3.4);
  close(americanToDecimal("-108")!, 1 + 100 / 108);
  close(americanToDecimal("-115")!, 1 + 100 / 115);
  close(americanToDecimal(100)!, 2);
  assert.equal(americanToDecimal(null), undefined);
  assert.equal(americanToDecimal("abc"), undefined);
  assert.equal(americanToDecimal("50"), undefined);
});

test("impliedProbability rejects prices of 1 or less", () => {
  close(impliedProbability(2), 0.5);
  assert.throws(() => impliedProbability(1), RangeError);
});

test("two-way de-vig: 1.91 / 1.91 is a fair coin with a 4.7% margin", () => {
  const r = devigProportional([1.91, 1.91]);
  close(r.fairProbabilities[0], 0.5);
  close(r.fairDecimals[1], 2);
  close(r.overround, 2 / 1.91);
  assert.equal(r.margin.toFixed(4), "0.0471");
});

test("two-way de-vig: uneven prices keep their ratio and sum to one", () => {
  const r = devigProportional([1.5, 2.6]);
  const p1 = 1 / 1.5, p2 = 1 / 2.6, s = p1 + p2;
  close(r.fairProbabilities[0], p1 / s);
  close(r.fairProbabilities[1], p2 / s);
  close(r.fairProbabilities[0] + r.fairProbabilities[1], 1);
  close(r.fairDecimals[0], s / p1);
});

test("three-way de-vig works and sums to one", () => {
  const r = devigProportional([2.5, 3.4, 2.9]);
  close(r.fairProbabilities.reduce((a, b) => a + b, 0), 1);
  assert.equal(r.fairDecimals.map((d) => d.toFixed(2)).join(" "), "2.60 3.53 3.01");
  assert.ok(r.margin > 0.038 && r.margin < 0.04);
});

test("de-vig rejects one-way and four-way markets", () => {
  assert.throws(() => devigProportional([2]), RangeError);
  assert.throws(() => devigProportional([2, 3, 4, 5]), RangeError);
});

test("consensus averages each book's no-vig chances with equal weight", () => {
  const r = consensusFairOdds(["Home", "Away"], [
    { bookmakerID: "a", decimals: [1.8, 2.0] },
    { bookmakerID: "b", decimals: [1.9, 1.9] },
  ]);
  const a = devigProportional([1.8, 2.0]).fairProbabilities[0];
  close(r.fairProbabilities[0], (a + 0.5) / 2);
  close(r.fairProbabilities[0] + r.fairProbabilities[1], 1);
  assert.equal(r.books.length, 2);
  // best prices 1.9 and 2.0
  close(r.bestPriceOverround!, 1 / 1.9 + 1 / 2.0);
});

test("consensus skips books missing an outcome and errors when none are complete", () => {
  const r = consensusFairOdds(["Home", "Away"], [
    { bookmakerID: "a", decimals: [1.91, 1.91] },
    { bookmakerID: "b", decimals: [1.5] },
  ]);
  assert.deepEqual(r.books.map((b) => b.bookmakerID), ["a"]);
  assert.throws(() => consensusFairOdds(["Home", "Away"], [{ bookmakerID: "b", decimals: [1.5] }]), RangeError);
});

test("best prices under 100% are reported as such", () => {
  const r = consensusFairOdds(["Home", "Away"], [
    { bookmakerID: "a", decimals: [2.1, 1.8] },
    { bookmakerID: "b", decimals: [1.8, 2.1] },
  ]);
  assert.ok(r.bestPriceOverround! < 1);
});
