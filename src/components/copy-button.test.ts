import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COPY_DONE_LABEL, COPY_FAILURE_MESSAGE, COPY_IDLE_LABEL, copyButtonLabel } from "./copy-button-copy.ts";

/**
 * copy-button.tsx has no DOM-rendering test harness in this repo (there is
 * no component-render test setup for it) -- this exercises the pure label
 * helper the component's onClick handler drives, and pins the exact wording
 * of the failure notice the owner asked for ("never a silent no-op, never
 * colour-only"). The rendered component itself (empty-text hides the
 * button, a real clipboard write flips the label for 2s and announces
 * through announceToDesk, a rejected write shows the failure line) is
 * covered by the Opinion desk gate walkthrough.
 */
describe("copyButtonLabel", () => {
  it("reads \"Copy\" before a click", () => {
    assert.equal(copyButtonLabel(false), COPY_IDLE_LABEL);
    assert.equal(copyButtonLabel(false), "Copy");
  });

  it("reads \"Copied\" right after a successful copy", () => {
    assert.equal(copyButtonLabel(true), COPY_DONE_LABEL);
    assert.equal(copyButtonLabel(true), "Copied");
  });
});

describe("COPY_FAILURE_MESSAGE", () => {
  it("is a plain-words notice, never a bare error and never colour-only", () => {
    assert.equal(COPY_FAILURE_MESSAGE, "Could not copy. Select the text and copy it by hand.");
    assert.match(COPY_FAILURE_MESSAGE, /select the text/i);
  });
});
