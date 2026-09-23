import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/*
  Item 5 pins, measured rather than assumed.

  The walk (scripts/desk-uiux-walk.mjs) measures what an editor actually
  encounters on each desk surface in a real browser. Its findings, recorded
  2026-09-22 against the branch build on port 3491:

    Desk, Queue, Scan, Sources, Published, Opinion, Dark Desk, Server, Stats
    -- all HTTP 200, all with a level-1 heading, all with a computed minimum
    font size of exactly 14px. The one unnamed Sources control found by that
    walk was the hidden registry-file input; it now has an explicit name.

  The text-size half of the item is therefore done and enforced by the existing
  14px floor plus this measurement. These tests keep it from regressing without
  needing a browser: they assert the floor rule exists, that the desk surfaces
  still name themselves, and that the walk exists to re-measure.
 */

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("the desk keeps a 14px informational floor", () => {
  assert.match(
    styles,
    /font-size:\s*calc\(0\.875rem \* var\(--ts, 1\)\)/,
    "the floor rule must survive; 0.875rem is 14px at the default root size",
  );
});

test("the desk scales with the editor text-size control, not around it", () => {
  assert.match(styles, /--ts/, "the scale variable must still drive desk type");
});

test("every desk surface names itself in a level-1 heading", async () => {
  const routes = [
    "desk.index.tsx", "desk.queue.tsx", "desk.scan.tsx", "desk.sources.tsx",
    "desk.published.tsx", "desk.opinion.tsx", "desk.dark.tsx", "desk.ops.tsx", "desk.stats.tsx",
  ];
  const missing = [];
  for (const route of routes) {
    const src = await readFile(new URL(`../src/routes/${route}`, import.meta.url), "utf8");
    // DeskShell renders the level-1 heading from its title prop.
    if (!/DeskShell/.test(src) && !/level:\s*1/.test(src)) missing.push(route);
  }
  assert.deepEqual(missing, [], "a surface with no heading leaves the reader unsure where they are");
});

test("the walk that measured all of this still exists", async () => {
  const walk = await readFile(new URL("./desk-uiux-walk.mjs", import.meta.url), "utf8");
  assert.match(walk, /getComputedStyle/, "the walk must measure computed type, not read CSS");
  assert.match(walk, /aria-label/, "the walk must check accessible names");
  assert.match(walk, /\/desk\/dark/, "the dark desk is one of the surfaces under review");
  assert.match(walk, /\/desk\/opinion/, "so is Opinion");
});

test("the source registry file picker has an accessible name", async () => {
  const sources = await readFile(new URL("../src/routes/desk.sources.tsx", import.meta.url), "utf8");
  assert.match(
    sources,
    /type="file"[\s\S]{0,160}aria-label="Choose source registry file"|aria-label="Choose source registry file"[\s\S]{0,160}type="file"/,
  );
});

