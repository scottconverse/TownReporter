import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  darkInvestigationPollMs,
  darkJobStepLine,
  darkRestartNoteVisible,
} from "./dark-card-behavior.ts";

describe("Dark Desk card behaviour", () => {
  it("keeps a new worker step instead of replacing it with a generic sentence", () => {
    assert.equal(darkJobStepLine("Waiting on Planning hop 1/5"), "Waiting on Planning hop 1/5");
    assert.equal(
      darkJobStepLine("Reading document 1/4 on hop 2"),
      "Reading document 1/4 on hop 2",
    );
    assert.equal(
      darkJobStepLine("Searching 3/3 on hop 2"),
      "Checking public pages · search 3 of 3",
    );
  });

  it("refreshes the open-file list while an investigation is running", () => {
    assert.equal(darkInvestigationPollMs([{ status: "open" }]), false);
    assert.equal(darkInvestigationPollMs([{ status: "open" }, { status: "investigating" }]), 3_000);
  });

  it("shows the restart note only when there is no known stop reason", () => {
    assert.equal(darkRestartNoteVisible(true, null), true);
    assert.equal(darkRestartNoteVisible(true, "cancelled"), false);
    assert.equal(darkRestartNoteVisible(true, "hop-limit"), false);
    assert.equal(darkRestartNoteVisible(true, null, "cancelled"), false);
    assert.equal(darkRestartNoteVisible(false, null), false);
  });
});
