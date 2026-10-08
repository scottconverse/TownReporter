// guards: long saved evidence could hide the editor's Decide controls below the first screen
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("Decide stays in the first screen of a large saved file", async () => {
  for (const large of [false, true]) {
    const { page, close } = await fileScreen({ large });
    try {
      await page.locator(".astra-question").click();
      await page.evaluate(() => scrollTo(0, 0));
      const top = await page.locator(".decide").evaluate((n) => n.getBoundingClientRect().top + scrollY);
      console.log(`1440 ${large ? "large" : "normal"} Decide top: ${top.toFixed(2)} px (262 findings, 363 activity lines)`);
      await page.screenshot({ path: `artifacts/dark-round-2/1440-${large ? "large" : "normal"}.png`, fullPage: true });
      assert.ok(large || top < 1000, `Decide top ${top} must be below 1000`);
    } finally { await close(); }
  }
});
