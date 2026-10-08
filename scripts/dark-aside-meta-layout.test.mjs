// guards: clipped Set-aside titles could crowd out the date that identifies a parked file
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("a Set-aside row places its date below its title", async () => {
  for (const width of [1440, 900]) {
    const { page, close } = await fileScreen({ width, aside: true });
    try {
      await page.locator(".astra-set-aside-row").click();
      const title = await page.locator(".astra-set-aside-title").boundingBox();
      const meta = await page.locator(".astra-set-aside-meta").boundingBox();
      assert.ok(meta.y >= title.y + title.height && Math.abs(meta.x - title.x) < 2);
    } finally { await close(); }
  }
});
