import assert from "node:assert/strict";
import test from "node:test";
import { sandboxedLaunchArgs } from "../src/lib/news/render-fetch.ts";

test("Chromium launches WITH its sandbox by default (ENG-203)", () => {
  const withoutEscapeHatch = sandboxedLaunchArgs({});
  assert.ok(
    !withoutEscapeHatch.includes("--no-sandbox"),
    `default launch args must not include --no-sandbox, got ${JSON.stringify(withoutEscapeHatch)}`,
  );
});

test("TOWNREPORTER_CHROMIUM_NO_SANDBOX=1 is the only way to get --no-sandbox up front", () => {
  const opted = sandboxedLaunchArgs({ TOWNREPORTER_CHROMIUM_NO_SANDBOX: "1" });
  assert.ok(opted.includes("--no-sandbox"), "the documented escape hatch must still work");

  const otherValues = ["0", "true", "yes", ""];
  for (const v of otherValues) {
    const args = sandboxedLaunchArgs({ TOWNREPORTER_CHROMIUM_NO_SANDBOX: v });
    assert.ok(
      !args.includes("--no-sandbox"),
      `TOWNREPORTER_CHROMIUM_NO_SANDBOX=${JSON.stringify(v)} must not enable --no-sandbox`,
    );
  }
});
