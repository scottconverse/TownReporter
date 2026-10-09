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
    assert.doesNotMatch(text, /\bartifacts?\b|\bhops?\b|\$|\d{4}-\d{2}-\d{2}/i);
    assert.match(text, /record/); assert.match(text, /step/);
    assert.match(text, /Oct\. 7, 6:30 p\.m\./);
  } finally { await close(); }
});
