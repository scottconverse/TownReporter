import { test } from "node:test";
import assert from "node:assert/strict";
import { OPS_ACTIONS } from "./actions.ts";
import { installAction, installLogFiles, siteProbeDescription } from "./install-display.ts";

test("portable health explains the read-only check instead of automatic repair", () => {
  const action = installAction(
    OPS_ACTIONS.find((action) => action.id === "watchdog")!,
    true,
  );
  assert.match(action.detail, /read-only/i);
  assert.doesNotMatch(action.detail, /repairs|every five minutes/i);
  const restart = installAction(
    OPS_ACTIONS.find((action) => action.id === "restart-app")!,
    true,
  );
  assert.match(restart.detail, /this installation/i);
});
test("loopback responses establish local readiness, never tunnel routing", () => {
  for (const site of ["http://127.0.0.1:4390", "http://localhost:4388", "http://[::1]:4388"]) {
    const probe = siteProbeDescription(site);
    assert.equal(probe.label, "Local site");
    assert.match(probe.note, /does not verify public access/i);
  }
  assert.doesNotMatch(siteProbeDescription("https://example.org").note, /proves the tunnel/);
});
test("portable logs name files the owned launcher actually writes", () => {
  const files = installLogFiles(true).map((log) => log.file);
  assert.ok(files.includes("app.out.log"));
  assert.ok(files.includes("app.err.log"));
  assert.ok(files.includes("restart.err.log"));
  assert.ok(!files.includes("watchdog.log"));
  assert.ok(!files.includes("cloudflared.err.log"));
});
