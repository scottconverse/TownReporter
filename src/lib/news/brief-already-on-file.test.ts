import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALREADY_ON_FILE_MARKER,
  UNGROUNDED_MARKER,
  briefStepAlreadyOnFile,
  markAlreadyOnFile,
  prepareCorpus,
} from "./dark-specific-grounding.ts";

/*
  FB7, item 5 (A2c X3), second half: "its DO THIS NEXT asks for the licensing
  record the round had already captured".

  The grounding pass already knew which direction was which -- it marks what
  NOTHING carries. It had no word for the other case, so a step that asked for
  a record sitting in the file went out unremarked and the editor was sent to
  fetch something they already had.
*/

// The corpus is the file's captures, flattened, exactly as `groundBrief` is
// handed it. The licensing record IS here; the 2024 audit report is not.
const CORPUS = prepareCorpus(
  [
    "Colorado Shines licensing record for Kid City USA Longmont, facility 1234567.",
    "KCTV5 reported the Lee's Summit closure in the same week.",
  ].join("\n"),
);

describe("a next step that asks for what is on file says so", () => {
  it("marks a step whose record the file already carries", () => {
    const step = "Read the Colorado Shines licensing record for Kid City USA Longmont.";
    assert.equal(briefStepAlreadyOnFile(step, CORPUS), true);
    assert.equal(markAlreadyOnFile(step, CORPUS), `${step} ${ALREADY_ON_FILE_MARKER}`);
  });

  it("says nothing when the step names a record nothing carries", () => {
    // The opposite case still belongs to `UNGROUNDED_MARKER`; the two must not
    // both fire on one sentence.
    const step = "Fetch the 2024 state audit report for facility 7654321.";
    assert.equal(briefStepAlreadyOnFile(step, CORPUS), false);
    assert.equal(markAlreadyOnFile(step, CORPUS), step, "byte-for-byte unchanged");
  });

  it("says nothing for a step that names no record at all", () => {
    // "Interview the neighbours" is not asking for a document, so there is
    // nothing to have on file and nothing to claim.
    const step = "Interview the neighbours and ask what they saw that night.";
    assert.equal(briefStepAlreadyOnFile(step, CORPUS), false);
    assert.equal(markAlreadyOnFile(step, CORPUS), step);
  });

  it("marks in place, so the editor still reads what was asked for", () => {
    // The step is not deleted and not reworded: the editor sees the ask and
    // the answer beside it, which is the same convention the other marker uses.
    const step = "Read the Colorado Shines licensing record for Kid City USA Longmont.";
    const out = markAlreadyOnFile(step, CORPUS);
    assert.ok(out.startsWith(step), "the original sentence is still there");
    assert.ok(out.length > step.length);
  });

  it("does not mark the same line twice", () => {
    const once = markAlreadyOnFile(
      "Read the Colorado Shines licensing record for Kid City USA Longmont.",
      CORPUS,
    );
    assert.equal(markAlreadyOnFile(once, CORPUS), once);
  });

  it("is not confused with the ungrounded marker", () => {
    assert.notEqual(ALREADY_ON_FILE_MARKER, UNGROUNDED_MARKER);
  });
});
