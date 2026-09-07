import { test } from "node:test";
import assert from "node:assert/strict";
import { unavailableOpsReason } from "./install-policy.ts";

test("an unconfigured instance cannot control machine-wide operations", () => {
  for (const id of ["restart-app", "watchdog", "restart-tunnel", "rotate-logs"])
    assert.ok(unavailableOpsReason(id, false, false), id);
});
test("managed installs expose only their scoped lifecycle, not global tasks", () => {
  for (const id of ["watchdog", "restart-app", "migrate", "refresh-fonts"])
    assert.equal(unavailableOpsReason(id, true, false), null, id);
  for (const id of ["restart-tunnel", "rotate-logs"])
    assert.ok(unavailableOpsReason(id, true, false), id);
});
test("legacy host operations require explicit ownership", () => {
  assert.equal(unavailableOpsReason("restart-app", false, true), null);
});
