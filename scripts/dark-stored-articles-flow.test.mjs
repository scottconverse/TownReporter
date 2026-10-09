// guards: replaced jargon could leave ungrammatical saved case prose for the editor
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("expanded saved case prose keeps the article of its replacement word", async () => {
  const { page, close } = await fileScreen({ storedCopy: true });
  try {
    await page.locator(".astra-case-compact summary").first().click();
    const text = await page.locator(".astra-case-compact").first().textContent();
    assert.match(text, /A record/); assert.match(text, /a step/);
    assert.doesNotMatch(text, /an record|an step/i);
  } finally { await close(); }
});
