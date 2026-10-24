import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savedDraftRefusalLine } from "./draft-refusal-line.ts";

/**
 * G23-QA-5 (D279): the line the Story page shows for a refusal the desk kept
 * on the lead. Fixed instant, paper's own zone (Denver, October, UTC-6).
 */
describe("D279: a saved draft refusal reads as one line", () => {
  it("names the moment in the paper's time zone and the desk's own words", () => {
    assert.equal(
      savedDraftRefusalLine(
        { text: "No model is set up. Add a connection on the Server page.", at: "2026-10-24T09:04:00Z" },
        "America/Denver",
      ),
      "Draft did not start (Oct 24, 3:04 AM). No model is set up. Add a connection on the Server page.",
    );
  });

  it("says nothing when there is no refusal", () => {
    assert.equal(savedDraftRefusalLine(null, "America/Denver"), null);
    assert.equal(savedDraftRefusalLine(undefined, "America/Denver"), null);
  });

  it("says nothing when the stored moment is unusable", () => {
    assert.equal(savedDraftRefusalLine({ text: "No model is set up.", at: "not a date" }, "America/Denver"), null);
  });

  it("does not throw on a bad time zone name", () => {
    assert.match(
      savedDraftRefusalLine({ text: "No model is set up.", at: "2026-10-24T09:04:00Z" }, "Not/AZone") ?? "",
      /^Draft did not start \(.+\)\. No model is set up\.$/,
    );
  });
});
