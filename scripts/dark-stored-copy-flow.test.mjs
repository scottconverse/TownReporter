// guards: imported findings and historical activity could expose internal jargon or forbidden dollar amounts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("expanded stored findings and activity use plain record language without dollars", async () => {
  const { page, close } = await fileScreen({ storedCopy: true });
  try {
    await page.locator(".astra-case-compact summary").first().click();
    await page.getByText("Show earlier", { exact: true }).click();
    const text = await page.locator("#investigation-workspace").textContent();
    assert.doesNotMatch(text, /\bartifacts?\b|\bhops?\b|\$/i);
    assert.match(text, /record/); assert.match(text, /step/);
  } finally { await close(); }
});
