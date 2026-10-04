import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MEETING_SETTINGS_OWNER_ONLY_MESSAGE,
  meetingSettingsFailureMessage,
} from "../lib/news/meeting-settings.ts";

/*
  Design review note 10: the meeting-capture panel showed
  "Loading meeting capture settings" forever for a non-owner, instead of the
  server's actual refusal ("Only the owner can configure meeting capture.").
  The panel is a `.tsx` component (real JSX + hooks), which this repo's plain
  `node --test` runner cannot execute. What the panel renders for a failed
  settings.isError comes down to one pure function,
  `meetingSettingsFailureMessage`, which is behavior-tested directly here.
*/

describe("meetingSettingsFailureMessage (backs the panel's isError branch)", () => {
  it("returns the exact owner-only refusal when that is what the server threw", () => {
    const message = meetingSettingsFailureMessage(new Error(MEETING_SETTINGS_OWNER_ONLY_MESSAGE));
    assert.equal(message, "Only the owner can configure meeting capture.");
  });

  it("returns a generic, non-committal sentence for any other failure", () => {
    const message = meetingSettingsFailureMessage(new Error("connection to the database timed out"));
    assert.doesNotMatch(message, /Only the owner/);
    assert.match(message, /could not read the meeting capture settings/);
    assert.match(message, /Reload the page/);
  });

  it("also handles a non-Error rejection (e.g. a serialized RPC failure)", () => {
    const message = meetingSettingsFailureMessage("some non-Error rejection");
    assert.match(message, /could not read the meeting capture settings/);
  });
});
