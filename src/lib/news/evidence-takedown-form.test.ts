/*
  Unit U23, second finding: THE TAKEDOWN FORM BELONGS TO ONE CAPTURE.

  The defect these cases pin down: the open flag, the reason and the
  remove-the-link tick outlived the capture they were filled in for, so opening
  a second capture showed the first one's reason above a press that would purge
  the SECOND capture with it. The reason is the audit record of why a publisher's
  excerpt was destroyed -- borrowed, it reads as deliberate.

  THE MUTATION THAT MATTERS: make `takeDownFormForCapture` return `state`
  untouched (i.e. drop the reset), or key the form on nothing, and the second
  case fails: capture B's form still holds capture A's reason and A's tick.

  These are the real functions the component renders from -- see
  src/components/finding-evidence-review.tsx, where `takeDownFormForCapture` is
  applied on every render and every edit.
*/

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blankTakeDownForm,
  takeDownConfirmText,
  takeDownFormForCapture,
} from "./evidence-takedown-form.ts";

const CAPTURE_A = {
  versionId: 11,
  title: "City council packet, March",
  url: "https://publisher.example/packets/march",
};
const CAPTURE_B = {
  versionId: 22,
  title: "Budget memo",
  url: "https://publisher.example/budget",
};

/** What the owner does in the form: open it, write a reason, tick the box. */
const filledIn = (versionId: number): ReturnType<typeof blankTakeDownForm> => ({
  ...blankTakeDownForm(versionId),
  open: true,
  reason: `Publisher asked on ${versionId}`,
  removeLink: true,
});

describe("the takedown form is about one capture", () => {
  it("keeps the form while the pane stays on the same capture", () => {
    const typed = filledIn(CAPTURE_A.versionId);
    assert.equal(
      takeDownFormForCapture(typed, CAPTURE_A.versionId),
      typed,
      "the same capture must not blank a reason the owner is still writing",
    );
    assert.equal(takeDownFormForCapture(blankTakeDownForm(null), null).open, false);
  });

  it("drops the open flag, the reason and the tick when the capture changes", () => {
    const aboutA = filledIn(CAPTURE_A.versionId);
    const aboutB = takeDownFormForCapture(aboutA, CAPTURE_B.versionId);

    assert.equal(aboutB.versionId, CAPTURE_B.versionId, "the form now belongs to B");
    assert.equal(aboutB.open, false, "B's form is not left open by A's press");
    assert.equal(aboutB.reason, "", "A's reason never reaches B's takedown");
    assert.equal(aboutB.removeLink, false, "and A's tick neither");
  });

  it("drops all three when the pane closes, and does not restore them on the way back", () => {
    const aboutA = filledIn(CAPTURE_A.versionId);

    const closed = takeDownFormForCapture(aboutA, null);
    assert.deepEqual(closed, { versionId: null, open: false, reason: "", removeLink: false });

    const reopened = takeDownFormForCapture(closed, CAPTURE_A.versionId);
    assert.equal(reopened.versionId, CAPTURE_A.versionId);
    assert.equal(
      reopened.reason,
      "",
      "a reason typed at an earlier look must not reappear: it may no longer be true",
    );
    assert.equal(reopened.removeLink, false);
  });

  it("names the capture in the line above the press, even with no title", () => {
    assert.equal(
      takeDownConfirmText(CAPTURE_A),
      `You are taking down “City council packet, March” — ${CAPTURE_A.url}. It cannot be undone.`,
    );
    // No title, and a whitespace-only title, fall back to the address rather
    // than confirming a takedown of nothing.
    assert.equal(
      takeDownConfirmText({ title: null, url: CAPTURE_B.url }),
      `You are taking down ${CAPTURE_B.url}. It cannot be undone.`,
    );
    assert.equal(
      takeDownConfirmText({ title: "   ", url: CAPTURE_B.url }),
      `You are taking down ${CAPTURE_B.url}. It cannot be undone.`,
    );
    // Both captures are named, so the two sentences cannot be mistaken for each
    // other -- which is the whole point of printing one.
    assert.notEqual(takeDownConfirmText(CAPTURE_A), takeDownConfirmText(CAPTURE_B));
  });
});
