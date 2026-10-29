// guards: a closed Dark Desk file must explain the grey Keep press and its reopen path
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DARK_PULL_BACK_LABEL,
  darkDecidePanelChoice,
} from "./dark-closed-file.ts";

describe("Dark Desk closed-file Decide panel", () => {
  it("says why Keep investigating is grey, names Pull back, and marks Close already closed", () => {
    const choice = darkDecidePanelChoice("closed");

    assert.equal(choice.closed, true);
    assert.equal(choice.keepDisabled, true);
    assert.match(choice.keepNote ?? "", /^This file is closed\./);
    assert.match(choice.keepNote ?? "", /Pull back/);
    assert.match(choice.keepNote ?? "", /More file actions/);
    assert.equal(choice.closeLabel, "Already closed");
    assert.equal(choice.closeDisabled, true);
    assert.equal(choice.pullBackLabel, DARK_PULL_BACK_LABEL);
  });

  it("keeps today's open-file labels and controls", () => {
    assert.deepEqual(darkDecidePanelChoice("open"), {
      closed: false,
      keepDisabled: false,
      keepNote: null,
      closeLabel: "Close: no finding",
      closeDisabled: false,
      pullBackLabel: null,
    });
  });
});
