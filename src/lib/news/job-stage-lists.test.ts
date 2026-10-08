import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JOB_KINDS, JOB_STAGE_LISTS, type JobKind } from "./jobs.ts";

describe("every job kind's stage list", () => {
  it("covers every kind, with at least one stage each", () => {
    // The list the table is keyed by, and the list the type is built from, are
    // the same list -- `kindCoverage` in jobs.ts is what makes that true at
    // compile time. Here it is asserted at runtime so a mutation is a FAILING
    // TEST and not only a red squiggle.
    assert.equal(JOB_KINDS.length, 13);
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
