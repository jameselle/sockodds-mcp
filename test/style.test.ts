import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ROOT } from "./helpers.js";

const LONG_DASH = /[\u2013\u2014]/;

function files(): string[] {
  const src = readdirSync(new URL("src/", ROOT)).map((f) => `src/${f}`);
  const tests = readdirSync(new URL("test/", ROOT)).map((f) => `test/${f}`);
  return ["README.md", "skill/SKILL.md", "docs/API-NOTES.md", "package.json", ...src, ...tests];
}

test("no en or em dashes in the README, skill, notes or source", () => {
  for (const f of files()) {
    const text = readFileSync(new URL(f, ROOT), "utf8");
    assert.ok(!LONG_DASH.test(text), `${f} contains an en or em dash`);
  }
});

test("the source talks to API v1 only: no x-api-key header, no key in a query string", () => {
  for (const f of readdirSync(new URL("src/", ROOT))) {
    const text = readFileSync(new URL(`src/${f}`, ROOT), "utf8");
    assert.ok(!/x-api-key/i.test(text), `src/${f} mentions x-api-key`);
    assert.ok(!/[?&]apiKey=/.test(text), `src/${f} puts a key in a query string`);
    assert.ok(!/api\.sockodds\.com\/v2/.test(text), `src/${f} calls the v2 API`);
  }
});
