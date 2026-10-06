import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JOB_KINDS, JOB_STAGE_LISTS, type JobKind } from "./jobs.ts";

/*
  EVERY KIND HAS A STAGE LIST, AND EVERY PHRASE IN IT IS ONE ITS WORKER WRITES
  (FB1, unit 2).

  THE GAP THIS CLOSES. `JOB_STAGE_LISTS` had entries for three kinds --
  `follow-up`, `draft` and `reconcile` -- and `executeJob` seeds `stages_json`
  from it at claim time. So the other eight kinds were seeded with NULL, which
  the card renders as "no chip row", no matter how much their workers reported.
  A Scan, a Dark Desk round, a brief, a PDF read, a Pull, a transcription and a
  routine edition could never light a chip.

  TWO CLAIMS, TWO TESTS, because they fail for different reasons:

    1. COVERAGE -- every kind has a non-empty list. Its failure mode is a new
       kind added to the union and forgotten here. `tsc` catches that first (the
       table is a `Record<JobKind, ...>` and `kindCoverage` fails to compile),
       but a compile error is not a test, and the mutation this test is written
       against -- deleting a key -- is exactly what a JS-level check catches.

    2. EMISSION -- every phrase is a string literal in the worker that reports
       it. This is the rule the table's own docstring states and nothing
       enforced: "a phrase nothing ever writes is a chip that never lights up:
       a stage the editor waits for and never sees finish."

  WHY A SOURCE READING AND NOT A RUN. Running eleven real workers needs eleven
  models, a database and an hour. What is being asserted is a property of the
  CODE -- "the string 'Filing the leads' appears in desk.ts" -- and reading the
  file answers exactly that question. `job-progress-kinds.test.ts` is the other
  half: it drives a fake run per kind through the claim/report machinery, so the
  phrases are proved against the progress model as well as against the source.

  NO MODEL IS LOADED OR CALLED ANYWHERE IN THIS FILE.
*/

/**
 * Where each kind's worker lives, and only where it lives. `dark.ts` reports
 * three kinds (the round, the brief and the PDF read) and is listed three
 * times, which is the honest shape of the file rather than a shared superset
 * that would let one kind's phrase be found in another's module.
 */
const WORKER_FILES: Record<JobKind, readonly string[]> = {
  draft: ["report.ts"],
  reconcile: ["draft-reconcile.server.ts"],
  "follow-up": ["follow-up-agents.ts"],
  scan: ["desk.ts"],
  dark: ["dark.ts"],
  editorial: ["editorial.server.ts"],
  brief: ["dark.ts"],
  "routine-notice": ["routine-notice-worker.server.ts"],
  "artifact-ocr": ["dark.ts"],
  pull: ["pull.server.ts"],
  "audio-transcribe": ["textflowkit-transcribe.server.ts"],
  reporting: ["civic-reporting-run.server.ts"],
};

const here = fileURLToPath(new URL(".", import.meta.url));
const workerText = (kind: JobKind) =>
  WORKER_FILES[kind]
    .map((file) => readFileSync(here + file, "utf8"))
    .join("\n");

describe("every job kind's stage list", () => {
  it("covers every kind, with at least one stage each", () => {
    // The list the table is keyed by, and the list the type is built from, are
    // the same list -- `kindCoverage` in jobs.ts is what makes that true at
    // compile time. Here it is asserted at runtime so a mutation is a FAILING
    // TEST and not only a red squiggle.
    assert.equal(JOB_KINDS.length, 12);
    assert.equal(new Set(JOB_KINDS).size, JOB_KINDS.length, "no duplicates");
    assert.deepEqual(
      Object.keys(JOB_STAGE_LISTS).sort(),
      [...JOB_KINDS].sort(),
      "the table has an entry for exactly the kinds that exist",
    );
    for (const kind of JOB_KINDS) {
      const stages = JOB_STAGE_LISTS[kind];
      assert.ok(Array.isArray(stages), `${kind} has a stage list`);
      assert.ok(stages.length > 0, `${kind}'s stage list is not empty`);
      for (const phrase of stages) {
        assert.equal(typeof phrase, "string", `${kind}: every stage is a string`);
        assert.ok(phrase.trim().length > 0, `${kind}: no blank stage`);
        // A phrase with a newline or a trailing space can never match what a
        // worker writes -- `stageIndexFor` is an exact comparison -- so it
        // would be a chip that never lights.
        assert.equal(phrase, phrase.trim(), `${kind}: "${phrase}" has no stray whitespace`);
        assert.ok(!phrase.includes("\n"), `${kind}: "${phrase}" is one line`);
      }
    }
  });

  it("writes every phrase in the worker that reports it", () => {
    const missing: string[] = [];
    for (const kind of JOB_KINDS) {
      const text = workerText(kind);
      for (const phrase of JOB_STAGE_LISTS[kind]) {
        /*
          The QUOTED literal, not a substring. `JSON.stringify` produces exactly
          the double-quoted form a TypeScript string literal has, so this asks
          "is this phrase written as a string in this file" rather than "do
          these words appear somewhere" -- the difference that lets a
          commented-out phrase or a half-written sentence in a docblock count as
          absent, which is what it is.
        */
        if (!text.includes(JSON.stringify(phrase))) missing.push(`${kind}: "${phrase}"`);
      }
    }
    assert.deepEqual(missing, [], `phrases no worker writes:\n  ${missing.join("\n  ")}`);
  });

  it("keeps the three lists that already existed exactly as they were", () => {
    /*
      The kinds that had a list before FB1 keep theirs, phrase for phrase. Two
      of them are read by other tests and by the card's own render test, and a
      reworded chip is a behaviour change in a screen nobody asked to change --
      `job-progress.test.ts` asserts `"Writing the draft"` and
      `"Opening source material"` by name.
    */
    assert.deepEqual(JOB_STAGE_LISTS.draft, [
      "Opening source material",
      "Looking for primary sources",
      "Planning the reporting",
      "Writing the draft",
      "Checking the draft against the evidence",
      "Connecting the story to saved sources",
    ]);
    assert.deepEqual(JOB_STAGE_LISTS.reconcile, [
      "Checking the saved draft against the evidence",
      "Reconciling the draft with the saved evidence",
    ]);
    assert.deepEqual(JOB_STAGE_LISTS["follow-up"], ["Running the check", "Recording the result"]);
  });

  it("gives the nine kinds that had none a list their worker can actually reach", () => {
    /*
      The headline of the report's R2: eight kinds seeded NULL at claim, so the
      card showed no chip row for any of them. This is the same fact stated as a
      list of names, so a future edit that quietly drops one fails here with the
      kind's own name in the message rather than as a count.
    */
    const wasMissing: JobKind[] = [
      "scan",
      "dark",
      "editorial",
      "brief",
      "routine-notice",
      "artifact-ocr",
      "pull",
      "audio-transcribe",
      "reporting",
    ];
    for (const kind of wasMissing) {
      assert.ok(JOB_STAGE_LISTS[kind]?.length, `${kind} has stages now`);
    }
  });
});
