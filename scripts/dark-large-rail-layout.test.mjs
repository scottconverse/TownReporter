// guards: Large text could squeeze the file alongside the rail at tablet width
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("Large text stacks the rail above the file at 900 pixels", async () => {
  const { page, close } = await fileScreen({ width: 900, large: true });
  try {
    await page.locator(".astra-question").click();
    const [rail, file] = await Promise.all([page.locator(".astra-piles").boundingBox(), page.locator("#investigation-workspace").boundingBox()]);
    assert.ok(file.y >= rail.y + rail.height && Math.abs(file.x - rail.x) < 2);
  } finally { await close(); }
});
