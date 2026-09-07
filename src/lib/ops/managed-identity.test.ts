import { test } from "node:test";
import assert from "node:assert/strict";
import { ownsManagedInstall } from "./managed-identity.ts";
test("PowerShell BOM config is recognized only for this root and instance", () => {
  const id = "a".repeat(32);
  const text = "\uFEFF" + JSON.stringify({ AppRoot: "C:\\paper", InstanceId: id });
  assert.equal(ownsManagedInstall(text, "C:\\paper", id), true);
  assert.equal(ownsManagedInstall(text, "C:\\other-paper", id), false);
  assert.equal(ownsManagedInstall(text, "C:\\paper", "b".repeat(32)), false);
  assert.equal(ownsManagedInstall("{}", "C:\\paper", undefined), false);
  assert.equal(ownsManagedInstall("broken", "C:\\paper", id), false);
});
