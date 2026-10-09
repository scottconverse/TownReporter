// guards: Start-a-file model controls could be too small to press in the modal
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("Start-a-file stacks sentence-case model labels in its portal", async () => {
  for (const width of [1440, 390]) {
  const { page, close } = await fileScreen({ width });
  try {
    await page.getByRole("button", { name: "+ Start a file", exact: true }).click();
    await page.evaluate(() => {
      const portal = document.createElement("div"); portal.className = "desk-ltr astra-modal-layer";
      const dialog = document.createElement("div"); dialog.className = "dlg"; dialog.style.width = "620px";
      dialog.append(document.querySelector("#investigation-workspace > .model-picker")); portal.append(dialog); document.body.append(portal);
    });
    for (const label of await page.locator(".astra-modal-layer .model-picker-label").all()) {
      const result = await label.evaluate((n) => ({ transform: getComputedStyle(n).textTransform, labelBottom: n.getBoundingClientRect().bottom, controlTop: n.nextElementSibling.getBoundingClientRect().top }));
      assert.equal(result.transform, "none"); assert.ok(result.controlTop >= result.labelBottom);
    }
    for (const control of await page.locator(".astra-modal-layer select, .astra-modal-layer button").all()) {
      assert.ok((await control.boundingBox()).height >= 44, "portal controls must be at least 44 px tall");
    }
  } finally { await close(); }
  }
});
