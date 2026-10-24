import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  meetingEditorChecksLines,
  meetingEditorChecksNotice,
  publishBlockers,
  type PublishBlockerState,
} from "./publish-blockers.ts";

/**
 * G23-UX-6 (D278): the writer's check list is ONE warning, but it is really a
 * lead sentence plus N items. The screens now draw the items as a real `<ol>`,
 * and the sentence they used to draw is unchanged byte for byte -- the audit
 * row, the server's refusal and the acknowledgement key all still read it.
 *
 * The old strings below were pasted from HEAD (038ba7b6) before the change, so
 * a drift in either half fails here.
 */

const STATE: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  openClaims: 0,
  namedOutlets: [],
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

describe("D278: the check list in two parts, and the same one-string notice", () => {
  it("splits three checks into the lead and the three items", () => {
    const lines = meetingEditorChecksLines([
      "Check the 6-1 tally.",
      "The parking figure is read off a slide.",
      "The quote was cut from a longer answer.",
    ]);
    assert.equal(lines.lead, "The meeting writer asks you to check 3 things before publishing:");
    assert.deepEqual(lines.items, [
      "Check the 6-1 tally.",
      "The parking figure is read off a slide.",
      "The quote was cut from a longer answer.",
    ]);
  });

  it("still says the meeting writer's one-string notice for 3 items, unchanged", () => {
    assert.equal(
      meetingEditorChecksNotice([
        "Check the 6-1 tally.",
        "The parking figure is read off a slide.",
        "The quote was cut from a longer answer.",
      ]),
      "The meeting writer asks you to check 3 things before publishing: 1. Check the 6-1 tally. 2. The parking figure is read off a slide. 3. The quote was cut from a longer answer.",
    );
  });

  it("still says the meeting writer's one-string notice for 1 item, unchanged", () => {
    assert.equal(
      meetingEditorChecksNotice(["Check the 6-1 tally."]),
      "The meeting writer asks you to check 1 thing before publishing: 1. Check the 6-1 tally.",
    );
  });

  it("keeps the news writer's wording in both halves (D235)", () => {
    const options = { fromNewsWriter: true };
    assert.equal(
      meetingEditorChecksLines(["Check the tally."], options).lead,
      "The writer asks you to check 1 thing before publishing:",
    );
    assert.equal(
      meetingEditorChecksNotice(["Check the tally."], options),
      "The writer asks you to check 1 thing before publishing: 1. Check the tally.",
    );
  });

  it("gives the blocker both the sentence and the list", () => {
    const blocker = publishBlockers({ ...STATE, meetingEditorChecks: ["Check the tally.", "Read the slide."] })
      .find((row) => row.key === "meeting-editor-checks");
    assert.ok(blocker);
    assert.equal(blocker.sentence, meetingEditorChecksNotice(["Check the tally.", "Read the slide."]));
    assert.equal(blocker.lead, "The meeting writer asks you to check 2 things before publishing:");
    assert.deepEqual(blocker.items, ["Check the tally.", "Read the slide."]);
  });
});
