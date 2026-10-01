import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  FB7, item 2, on the Dark Desk: a JobCard in context for the dig round, the
  brief and the PDF read.

  FB0-REPORT.md Table B called all three "LAZY BAR": a whole dig round drew one
  `Busy` line, a brief rewrite drew `Busy`, and a retained-PDF read drew a
  sentence and a `stage` with a 1.5 s poll and no Cancel -- even though the
  worker honours a cancel the screen never offered.

  WHY A SOURCE PIN. `JobCard` is a `.tsx` component and the suite runs under
  `node --experimental-strip-types`, which strips `.ts` and refuses `.tsx`, so
  there is no render test to hand these sites (the same constraint
  `scan-card-placement.test.ts` records). What is checkable is the thing that
  actually goes wrong here, and it is not the card's markup -- the card is one
  component drawn on six screens already. It is WHICH JOB each site picks.

  A card drawn for the wrong file is the failure this pins against: before this
  item the desk had no way to attribute a non-story job to a subject at all
  (`leadId` is 0 for every kind that is not a draft or a reconcile), so the
  obvious wrong fix -- "draw the newsroom's open dig" -- would put another
  editor's round, on another file, under this file's Decide strip.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

const dark = read("../../routes/desk.dark.tsx");

describe("a job can say which subject it is about", () => {
  it("carries the row's subject_id through to the client view", () => {
    const progress = read("job-progress.ts");
    assert.match(
      progress,
      /^\s*subjectId: number;$/m,
      "JobProgressView exposes the subject, or no screen can attribute a job",
    );
    assert.match(progress, /subjectId: row\.subject_id,/, "and it is the row's own column");
  });
});

describe("the three card sites exist and pick the right job", () => {
  it("draws one card per kind, for the open file", () => {
    const cards = dark.match(/<DeskJobCard job=\{(digJob|briefJob|ocrJob)\} \/>/g) ?? [];
    assert.equal(cards.length, 3, "the dig round, the brief and the PDF read");
  });

  it("matches on kind AND subject, never on 'whatever is open'", () => {
    assert.match(
      dark,
      /const digJob = fileJob\("dark", openId\);/,
      "a dig round's subject is the investigation the editor has open",
    );
    assert.match(dark, /const briefJob = fileJob\("brief", openId\);/);
    assert.match(
      dark,
      /row\.kind === kind &&\s*row\.subjectId === subjectId/,
      "the match is the pair, not the kind alone",
    );
  });

  it("matches the PDF read on the ARTIFACT, not on the file", () => {
    // An `artifact-ocr` job's subject_id is the artifact (dark.ts), so a match
    // on the open investigation would draw nothing -- or, worse, whatever
    // artifact happened to share the investigation's number.
    assert.match(
      dark,
      /row\.kind === "artifact-ocr" &&\s*row\.subjectId === selected\.id/,
      "the card follows the record the editor is looking at",
    );
  });

  it("draws only running and queued -- done and failed are reported in place", () => {
    // `darkJobError` above the Decide strip, the brief card's own line and the
    // PDF reader's two `role="alert"` lines already say what stopped, next to
    // the press that stopped it. A second statement of one failure is how a
    // screen starts contradicting itself.
    assert.ok(
      dark.includes('(row.status === "queued" || row.status === "running"),'),
      "the card sites take open jobs only",
    );
    assert.match(dark, /<p className="note err" role="alert">\s*\{darkJobError\}/);
  });
});

describe("each card sits with the control that started the job", () => {
  it("the dig round's card is inside the Decide strip, by Keep digging", () => {
    const start = dark.indexOf('<div className="astra-panel decide">');
    const end = dark.indexOf("astra-panel-acts", start);
    assert.ok(start > 0 && end > start, "the Decide panel is where it was");
    assert.match(dark.slice(start, end), /digJob \? \(/, "the card is inside that panel");
  });

  it("the brief's card is directly under the brief it rewrites", () => {
    const at = dark.indexOf("<InvestigationBriefCard");
    assert.ok(at > 0);
    assert.match(dark.slice(at, at + 900), /briefJob \? \(/);
  });

  it("the PDF read's card is beside the two read buttons", () => {
    const at = dark.indexOf("Read entire PDF");
    assert.ok(at > 0);
    assert.match(dark.slice(at, at + 1200), /ocrJob \? \(/);
  });
});
