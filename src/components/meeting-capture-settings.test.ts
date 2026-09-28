import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEETING_SETTINGS_OWNER_ONLY_MESSAGE,
  meetingSettingsFailureMessage,
} from "../lib/news/meeting-settings.ts";

/*
  Design review note 10: the meeting-capture panel showed
  "Loading meeting capture settings" forever for a non-owner, instead of the
  server's actual refusal ("Only the owner can configure meeting capture.").
  The panel is a `.tsx` component (real JSX + hooks), which this repo's plain
  `node --test` runner cannot execute -- see meeting-source-block-wiring.test.ts
  for the same constraint on another `.tsx` file. What the panel renders for a
  failed settings.isError comes down to one pure function,
  `meetingSettingsFailureMessage`, which is behavior-tested directly here; a
  source check below confirms the panel actually calls it (and renders no form)
  rather than drifting back to its own inline copy.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const panelSource = fs.readFileSync(path.join(here, "meeting-capture-settings.tsx"), "utf8");

describe("MeetingCaptureSettings source wiring", () => {
  it("renders settings.isError through meetingSettingsFailureMessage, not an inline copy of the sentence", () => {
    assert.match(panelSource, /meetingSettingsFailureMessage\(settings\.error\)/);
    assert.doesNotMatch(
      panelSource,
      /could not read the meeting capture settings/,
      "the failure sentence must live only in meeting-settings.ts, not be duplicated inline in the panel",
    );
  });

  it("shows the isError branch before ever rendering the editable form", () => {
    const pendingAt = panelSource.indexOf("settings.isPending");
    const errorAt = panelSource.indexOf("settings.isError");
    const formAt = panelSource.indexOf("Meeting channels");
    assert.ok(pendingAt >= 0 && errorAt > pendingAt, "pending is checked before error");
    assert.ok(errorAt > 0 && formAt > errorAt, "the error branch returns before the form section");
  });

  it("retries are off, so a refused non-owner is never stuck behind backoff delay", () => {
    const queryAt = panelSource.indexOf("queryKey: [\"meeting-settings\"]");
    const retryAt = panelSource.indexOf("retry: false", queryAt);
    assert.ok(queryAt >= 0 && retryAt > queryAt && retryAt < queryAt + 800);
  });
});
