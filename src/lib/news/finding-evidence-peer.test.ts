import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRebaseDirtyEvidencePeers } from "./finding-evidence-peer.ts";

describe("dirty evidence peer rebasing", () => {
  it("requires reload when a dirty returned-claim peer changed in a save response", () => {
    const previous = {
      draftId: 11,
      contentToken: "same-draft",
      rows: [{ key: "finding:0" }],
      claimRows: [{ key: "claim:0:old" }],
    };
    const next = {
      ...previous,
      claimRows: [{ key: "claim:0:new" }],
    };
    assert.equal(canRebaseDirtyEvidencePeers(previous, next, ["claim:0:old"]), false);
  });
});
