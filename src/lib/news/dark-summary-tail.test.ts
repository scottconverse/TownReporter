/*
  A dark-run summary must keep the run's own status lines.

  Run 5 of the 2026-09-16 isolated acceptance stored a summary ending at
  "Hops" - the model's narrative was long enough that slice(0, 2500) cut the
  tail, which is where the hop count, the saved dials and the "Brief: run
  stopped: ..." line live. An editor reading that file sees a narrative that
  stops mid-word and no statement that the brief never ran.

  See docs/proofs/dark-desk-run-budget-0651.md.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { tailSafeDarkSummary } from "./dark.ts";

const CAP = 2_500;

/** Mirrors what a long dark round stores: narrative, then its status lines. */
function runSummary() {
  const narrative = "Council records show an unresolved allocation trail. ".repeat(60); // ~3.2k
  const status = [
    "Hops 3 of 5. Artifacts 12. Open frontier 96.",
    "Setting: dig 4/10, nerve 5/10 (Standard), scope city.",
    "Synthesis: Run stopped: elapsed-time-limit",
    "Brief: run stopped: elapsed-time-limit",
  ];
  return { narrative, status, text: [narrative, ...status].join("\n") };
}

test("the run keeps the hop count, the dials and the brief outcome", () => {
  const { text, status } = runSummary();
  const stored = tailSafeDarkSummary(text, CAP);

  assert.ok(stored.length <= CAP, "the stored summary respects the cap");
  for (const line of status) {
    assert.ok(stored.includes(line), `the stored summary keeps: ${line}`);
  }
  assert.match(stored, /Brief: run stopped: elapsed-time-limit/);
});

test("the old front-slice is what lost it, and no longer governs storage", () => {
  const { text } = runSummary();

  // The defect, stated as an assertion about the code that was replaced.
  const frontSliced = text.slice(0, CAP);
  assert.ok(
    !frontSliced.includes("Brief: run stopped"),
    "a front slice drops the brief outcome - this is the reported defect",
  );

  const stored = tailSafeDarkSummary(text, CAP);
  assert.ok(stored.includes("Brief: run stopped"), "the helper does not");
});

test("a summary inside the cap is stored exactly as-is", () => {
  const text = "Short round.\nHops 1 of 5. Artifacts 2. Open frontier 3.";
  assert.equal(tailSafeDarkSummary(text, CAP), text);
});
