import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
  "FIND A REPLACEMENT" (SH0-10): the panel, and the invariant behind it.

  THE INVARIANT IS THE POINT OF THIS FILE. The owner's addendum is explicit --
  never auto-add, approval-only proposals -- and the way a feature like this
  goes wrong is not a bug in a rule, it is one convenient line added later:
  `status = 'accepted'` saved into a module that only meant to suggest. So the
  health modules and the replacement path are read as SOURCE and searched for
  the three ways a row can be put on the watch list without the editor:

      status = 'accepted'        a literal
      setSourceStatus            the editor's press, called from somewhere
                                 that is not a press
      update sources set status  a write

  None of them may appear in any of them. The screen MAY contain
  `setSourceStatus` -- it is the editor's own Accept/Pause/Reject/Delete press
  and it is older than this feature -- which is why the panel is checked as a
  REGION rather than the whole file.

  MUTATION: add `status = 'accepted'` to any of the health modules, or a
  `setSourceStatus(` line to the panel, and this file fails.
*/

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** The slice of a file between two markers, so a rule can be pinned to the
 *  code that is actually new. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start >= 0, `marker not found: ${from}`);
  const end = text.indexOf(to, start);
  assert.ok(end > start, `end marker not found after ${from}`);
  return text.slice(start, end);
}

const AUTO_ACCEPT = [/status\s*=\s*'accepted'/, /setSourceStatus\s*\(/, /update\s+sources\s+set\s+status/i];

const sourcesScreen = read("../../routes/desk.sources.tsx");
const dialogActions = read("./editor-dialog-actions.server.ts");
const desk = read("./desk.ts");

const PANEL = between(sourcesScreen, "function ReplacementPanel(", "function SourceTable(");
const ACTION = between(
  dialogActions,
  "/* ------------------------------------------------------- find a replacement -- */",
  "/* ------------------------------------------------------------- add to story -- */",
);
const CANDIDATE_READ = between(
  desk,
  "export async function performReplacementCandidates(",
  "export const replacementCandidates",
);

describe("nothing in this feature can put a source on the watch list", () => {
  it("the two pure modules are free of it", () => {
    for (const file of ["./source-alternates.ts", "./source-replacements.ts"]) {
      const text = read(file);
      for (const pattern of AUTO_ACCEPT) {
        assert.doesNotMatch(text, pattern, `${file} may not accept a source`);
      }
    }
  });

  it("the panel is free of it -- the editor files a suggestion, and that is all", () => {
    for (const pattern of AUTO_ACCEPT) {
      assert.doesNotMatch(PANEL, pattern, "the panel may not accept, pause or alter a source");
    }
    // ...and it says what it does instead.
    assert.match(PANEL, /Use this instead/);
    assert.match(PANEL, /Not now/);
  });

  it("the replace action proposes and writes nothing else", () => {
    for (const pattern of AUTO_ACCEPT) {
      assert.doesNotMatch(ACTION, pattern, "the find-replacement action may not accept a source");
    }
    assert.match(ACTION, /proposedBy: "desk"/, "every row says where it came from");
  });

  it("the free-tier read cannot write at all", () => {
    // One select after another, and no statement that could change a row.
    assert.doesNotMatch(CANDIDATE_READ, /\b(insert|update|delete)\b/i);
  });
});

describe("the panel itself (SH0-10)", () => {
  it("is drawn only on a row that keeps failing", () => {
    const mount = between(sourcesScreen, "{kills ? (", "</Fragment>");
    assert.match(mount, /\{keeps \? \(/, "the panel is gated on the streak, not on every row");
    assert.match(mount, /<ReplacementPanel source=\{s\} \/>/);
  });

  it("prices the model press before it is pressed", () => {
    assert.match(PANEL, /Uses one model call\./);
    // ...and the free tier is not a model call: the read is a query.
    assert.match(PANEL, /replacementCandidates\(\{ data: source\.id \}\)/);
    assert.match(PANEL, /findReplacement\(/);
  });

  it("reports the press through the shared action family", () => {
    assert.match(PANEL, /useDeskMutation\(\{/);
    assert.match(PANEL, /pending: "Filing…"/);
  });

  it("labels every candidate with the ranker's own words, official record first", () => {
    // The label is `candidateLabel`'s, printed -- not a second spelling here.
    assert.match(PANEL, /candidate\.label/);
    assert.doesNotMatch(PANEL, /"Official record"/, "the panel must not spell the label itself");
  });

  it("offers the press only where pressing it can file something (MEDIUM-1)", () => {
    /*
      Every candidate the FREE panel draws is a sibling -- built from the
      newsroom's own accepted sources -- and the proposal door refuses a URL the
      newsroom already has a row for. So "Use this instead" on a sibling could
      never file anything, and the toast afterwards said the page was already a
      source, which the editor could see before they pressed.

      The rule itself is `candidateIsWatchedSource` and is tested on its own in
      `source-replacements.test.ts`; what is pinned here is that the PANEL asks
      it, and that the two arms are what they claim: a sibling says what is true
      and has nothing to press, everything else keeps the press.
    */
    const row = PANEL.slice(PANEL.indexOf("candidates.map((candidate) => ("));
    assert.ok(row, "the candidate row must be findable");
    assert.match(row, /candidateIsWatchedSource\(candidate\)/);
    const watchedAt = row.indexOf("<span>Already on your watch list</span>");
    const pressAt = row.indexOf('<span className="row-acts">');
    assert.ok(watchedAt > 0 && pressAt > watchedAt, "the two arms, watched first");
    assert.doesNotMatch(
      row.slice(watchedAt, pressAt),
      /InkButton|<button/,
      "an already-watched suggestion has nothing to press",
    );
    assert.match(row.slice(pressAt), /Use this instead/, "and the press is kept where it can file");
  });

  it("says the honest thing when the beat has no other source", () => {
    assert.match(PANEL, /may be the only one the newsroom watches/);
  });

  it("does not promise readability", () => {
    assert.match(PANEL, /We have not checked whether any of these is free to read\./);
  });

  it("is offered from a button the editor presses, not on load", () => {
    // `enabled: open` -- the read happens when the panel is opened, so a
    // screen full of failing rows does not issue one query per row.
    assert.match(PANEL, /enabled: open/);
    assert.match(PANEL, /onClick=\{\(\) => setOpen\(true\)\}/);
  });
});
