import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateFollowUpDialog } from "./follow-up-dialog-validation.ts";

describe("follow-up dialog validation", () => {
  it("names every blocker while an empty re-check dialog is still disabled", () => {
    assert.deepEqual(
      validateFollowUpDialog({ what: "", agentKind: "recheck", targets: [] }),
      [
        { field: "what", message: "Say what the follow-up should find out." },
        { field: "targets", message: "Add at least one link to check." },
      ],
    );
  });

  it("allows a search follow-up without a URL but still rejects malformed links", () => {
    assert.deepEqual(validateFollowUpDialog({ what: "Find the vote", agentKind: "search", targets: [] }), []);
    assert.deepEqual(
      validateFollowUpDialog({ what: "Find the vote", agentKind: "search", targets: ["example.org"] }),
      [{ field: "targets", message: "Links to look at must start with http:// or https://" }],
    );
  });

  it("renders its blocking reasons as a live alert instead of only disabling Start", () => {
    const source = readFileSync(new URL("../../components/follow-up-dialog.tsx", import.meta.url), "utf8");
    assert.match(source, /validateFollowUpDialog\(/);
    assert.match(source, /targetIssues\.map\(/);
    assert.match(source, /role="alert"/);
  });
});
