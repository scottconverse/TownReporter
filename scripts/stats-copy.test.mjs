import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/routes/desk.stats.tsx", import.meta.url), "utf8");

// Redesign phase 7 (docs/design/handoff-2026-09-26/README.md "12. Stats") replaced the old
// counter copy. The honesty it must keep: loads are not readers, visits are arrivals from
// outside the site with nothing stored, the page lists what it never collects, and it says
// "returning readers" cannot be shown instead of guessing.
test("Stats names anonymous page loads and what it cannot count, honestly", () => {
  assert.match(source, /anonymous page loads, not readers/i);
  assert.match(source, /Arrivals from outside the site; nothing stored in the browser/);
  assert.match(source, /What we never collect/);
  assert.match(source, /returning readers[\s\S]{0,40}is not a number this page can show and does not guess/i);
  assert.doesNotMatch(source, /Every public page view/);
  assert.doesNotMatch(source, /ranked by all-time views/);
});
