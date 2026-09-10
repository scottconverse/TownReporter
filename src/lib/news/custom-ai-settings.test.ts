import assert from "node:assert/strict";
import test from "node:test";
import { capabilityStatus, managementActionsLocked } from "./custom-ai-settings.ts";

test("capability display distinguishes unsupported from untested", () => {
  assert.equal(capabilityStatus(true), "yes");
  assert.equal(capabilityStatus(false), "no");
  assert.equal(capabilityStatus(null), "not tested");
});

test("saving and row actions use one interaction lock", () => {
  assert.equal(managementActionsLocked(false, null), false);
  assert.equal(managementActionsLocked(true, null), true);
  assert.equal(managementActionsLocked(false, "delete-id"), true);
});
