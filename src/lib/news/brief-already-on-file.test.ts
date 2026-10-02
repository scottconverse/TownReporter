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

/*
  MEDIUM-3 (A-B8). THE MARKER USED TO PROVE THE WRONG THING.

  Its rule was "the step names at least one specific and everything it names is
  in the file", and every specific it can see is a NAME, a date, an address or a
  number. So a capture that merely mentioned "Kid City USA Longmont" made
  "Request the 2025 inspection reports for Kid City USA Longmont" read as
  "(already on file)" -- telling the editor to skip asking for a document the
  file does not hold. What was established was that the NAME is on file.

  So the step must also name the RECORD it is asking for, and that noun and any
  year it names must be on file too. These two corpora differ in exactly one
  way -- whether a capture holds the inspection report -- and the marker must
  follow.
*/
const NAME_ONLY = prepareCorpus(
  "Kid City USA Longmont is a childcare centre in Longmont, Colorado.",
);
const REPORT_ON_FILE = prepareCorpus(
  [
    "Kid City USA Longmont is a childcare centre in Longmont, Colorado.",
    "The 2025 inspection report for Kid City USA Longmont found two violations.",
  ].join("\n"),
);
const REPORT_STEP = "Request the 2025 inspection reports for Kid City USA Longmont.";

describe("the marker follows the RECORD, not the name (MEDIUM-3)", () => {
  it("says nothing when only the facility's name is on file", () => {
    assert.equal(briefStepAlreadyOnFile(REPORT_STEP, NAME_ONLY), false);
    assert.equal(markAlreadyOnFile(REPORT_STEP, NAME_ONLY), REPORT_STEP, "byte-for-byte unchanged");
  });

  it("marks the step when a capture really does hold the 2025 inspection report", () => {
    assert.equal(briefStepAlreadyOnFile(REPORT_STEP, REPORT_ON_FILE), true);
    assert.equal(
      markAlreadyOnFile(REPORT_STEP, REPORT_ON_FILE),
      `${REPORT_STEP} ${ALREADY_ON_FILE_MARKER}`,
    );
  });

  it("says nothing when the record is on file for another year", () => {
    // The report is there; the one the step asks for is not. "Inspection
    // report" being somewhere in the file does not answer a question about
    // 2024.
    const corpus = prepareCorpus(
      "The 2025 inspection report for Kid City USA Longmont found two violations.",
    );
    const step = "Request the 2024 inspection reports for Kid City USA Longmont.";
    assert.equal(briefStepAlreadyOnFile(step, corpus), false);
    assert.equal(markAlreadyOnFile(step, corpus), step);
  });

  it("says nothing when the name and the year are on file but the step asks for a different record", () => {
    const step = "Request the 2025 fire safety certificates for Kid City USA Longmont.";
    assert.equal(briefStepAlreadyOnFile(step, REPORT_ON_FILE), false);
  });
});

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
