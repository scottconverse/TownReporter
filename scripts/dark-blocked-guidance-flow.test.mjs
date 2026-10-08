// guards: a blocked file could instruct the editor to click an action that does not exist
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("blocked-page guidance names the available investigation action", async () => {
  const { page, close } = await fileScreen({ blocked: true });
  try {
    const button = page.getByRole("button", { name: "Keep investigating", exact: true });
    await button.click();
    const name = await button.textContent();
    const guidance = await page.locator(".of-stop").textContent();
    assert.ok(guidance.includes(name.trim()));
  } finally { await close(); }
});
