import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateFollowUpDialog } from "./follow-up-dialog-validation.ts";

describe("follow-up dialog validation", () => {
  it("names every blocker while an empty re-check dialog is still disabled", () => {
    assert.deepEqual(
      validateFollowUpDialog({ what: "", agentKind: "recheck", targets: [] }),
      [
        { field: "what", message: "Say what the follow-up should find out." },
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

  it("lets every method reach the server's missing-link warning", () => {
    for (const agentKind of ["recheck", "search", "agenda"] as const) {
      assert.deepEqual(validateFollowUpDialog({ what: "Find the vote", agentKind, targets: [] }), []);
    }
  });
});
