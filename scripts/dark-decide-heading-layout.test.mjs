// guards: the editor could miss Decide because its heading looks like a minor label
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("Decide has the same sentence-case hierarchy as the evidence sections", async () => {
  const { page, close } = await fileScreen();
  try {
    await page.locator(".astra-question").click();
    const styles = await page.locator(".decide .astra-label").evaluate((n) => ({ size: getComputedStyle(n).fontSize, transform: getComputedStyle(n).textTransform }));
    assert.deepEqual(styles, { size: "19px", transform: "none" });
    assert.equal(await page.locator(".decide .astra-case-h .astra-note").count(), 0);
  } finally { await close(); }
});
