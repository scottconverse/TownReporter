// guards: clipped model help could hide the selected model's limits and effort behavior
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("model and effort help wrap completely at every Dark Desk width", async () => {
  for (const width of [1440, 900, 390]) {
    const { page, close } = await fileScreen({ width });
    try {
      await page.locator("#investigation-workspace > .model-picker select").first().click();
      for (const help of await page.locator("#investigation-workspace > .model-picker .model-picker-help").all()) {
        assert.ok(await help.evaluate((n) => n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1));
      }
    } finally { await close(); }
  }
});
