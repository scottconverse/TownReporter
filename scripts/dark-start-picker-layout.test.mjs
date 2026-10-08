// guards: Start-a-file model labels could be detached from their controls in the modal
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileScreen } from "./dark-layout.harness.mjs";
test("Start-a-file stacks sentence-case model labels in its portal", async () => {
  const { page, close } = await fileScreen();
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
  } finally { await close(); }
});
