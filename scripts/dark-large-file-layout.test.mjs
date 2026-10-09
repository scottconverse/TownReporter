// guards: long saved evidence could hide the editor's Decide controls below the first screen
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("Decide stays in the first screen of a large saved file", async () => {
  for (const large of [false, true]) {
    const { page, close } = await fileScreen({ large, blocked: true });
    try {
      await page.locator(".astra-question").click();
      await page.evaluate(() => scrollTo(0, 0));
      const top = await page.locator(".decide").evaluate((n) => n.getBoundingClientRect().top + scrollY);
      const bottom = await page.locator('[aria-label="File decisions"] button').first().evaluate((n) => n.getBoundingClientRect().bottom + scrollY);
      console.log(`1440 ${large ? "large" : "normal"} Decide top: ${top.toFixed(2)} px; first action row bottom: ${bottom.toFixed(2)} px (262 findings, 363 activity lines)`);
      await page.screenshot({ path: `artifacts/dark-round-2/1440-${large ? "large" : "normal"}.png`, fullPage: true });
      assert.ok(bottom < 1100 && (!large || top < 1000), `Decide top ${top}, action bottom ${bottom} must fit the first screen`);
    } finally { await close(); }
  }
});
