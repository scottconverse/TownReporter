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

test("both source registry import controls have accessible names", async () => {
  const sources = await readFile(new URL("../src/routes/desk.sources.tsx", import.meta.url), "utf8");
  assert.match(
    sources,
    /<textarea[\s\S]{0,180}aria-label="Paste source registry"|aria-label="Paste source registry"[\s\S]{0,180}<textarea/,
  );
  assert.match(
    sources,
    /type="file"[\s\S]{0,160}aria-label="Choose source registry file"|aria-label="Choose source registry file"[\s\S]{0,160}type="file"/,
  );
});

test("the story editor's own-note and follow-up inputs have accessible names", async () => {
  const story = await readFile(new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url), "utf8");
  assert.match(story, /placeholder="Who — e\.g\. City Manager's office"[\s\S]{0,100}aria-label="Who owes a response"/);
  assert.match(story, /placeholder="For what — one line"[\s\S]{0,100}aria-label="What response is needed"/);
  assert.match(story, /placeholder="Your own line — a call to make, a record to pull"[\s\S]{0,100}aria-label="Add a reporting note"/);
});


/*
  Unit P item 1 pin: a lead the General Scan filed under a section the MODEL
  never chose keeps a section (the column needs one) and says so. On the story
  page -- the surface where an editor would otherwise write and print on that
  section -- the notice sits above the publish gate, names the section that was
  not chosen, and disappears once the section is confirmed.

  The rendered Queue-row notice is exercised as real markup in
  scripts/lead-badge-render.test.mjs and the clearing on confirm in
  src/lib/news/topic-confirmation-gate.test.ts; this page has no SSR harness,
  so like the other route pins here it asserts the page's own markup.
*/
test("the story page tells the editor when the scan never chose the section", async () => {
  const story = await readFile(new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url), "utf8");
  /*
    0.6.66 renamed the condition, not the rule. The desk used to hold a
    separate `topicConfirmed` flag set by a Confirm button; that button is gone
    and Publish itself records the confirmation for the version it prints, so
    the one state that matters is `sectionReady` -- the model chose a section,
    or a person has picked one, or this saved draft already has a confirmed
    one. The notice still appears while none of those is true and the scan
    never chose.
  */
  assert.match(
    story,
    /data\.lead\.topic_unchosen\s*&&\s*!sectionReady[\s\S]{0,400}Section not chosen — pick one/,
    "the notice must be gated on the not-chosen mark and the section still being unconfirmed",
  );
  /*
    The sentence wraps in the source, so the space between "newsroom" and
    "files" is a newline and its indentation. This pins the words the editor
    reads, not the line breaks of the file they are written in.
  */
  assert.match(
    story,
    /Section not chosen — pick one[\s\S]{0,600}the model named no section this newsroom\s+files\s+under/,
    "the notice must say why the lead carries a section nobody chose",
  );
  assert.match(
    story,
    /!onPaper &&[\s\S]{0,80}data\.lead\.topic_unchosen/,
    "a printed story is past the decision; the notice belongs to the working draft",
  );
});
