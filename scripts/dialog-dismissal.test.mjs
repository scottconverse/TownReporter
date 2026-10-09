// guards: an editor loses an open dialog while trying to scroll it or dragging out of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dialogBrowser } from "./dialog-browser-harness.mjs";

test("scrollbar presses and drags keep the dialog open until a complete scrim press", async () => {
  const { browser, page } = await dialogBrowser();
  try {
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.evaluate(() => window.mount());
    await page.locator('[role="dialog"]').waitFor();
    await page.waitForTimeout(100);
    // The original layer owns the scrollbar. A pointer on its gutter is outside
    // Content, but is not a press on the scrim (even with overlay scrollbars).
    await page.locator('.astra-modal-layer').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 1439, clientY: 300 });
    assert.equal(await page.evaluate(() => window.closes), 0);
    await page.locator('.astra-modal-layer').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 1439, clientY: 300 });
    await page.locator('.astra-modal-layer').dispatchEvent('click', { button: 0, clientX: 1439, clientY: 300 });
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => window.closes), 0);
    const box = await page.locator('[role="dialog"]').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.closes), 0);
    await page.mouse.move(5, 5);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.closes), 0);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.closes), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.closes), 2);
    await page.getByRole('button', {name:'Cancel',exact:true}).click();
    await page.getByRole('button', {name:'Close',exact:true}).click();
    assert.equal(await page.evaluate(() => window.closes), 4);
    await page.evaluate(() => { window.closes=0; window.mount(true); });
    const native = page.locator('dialog');
    await native.waitFor();
    const rect = await native.boundingBox();
    await page.mouse.click(rect.x+rect.width-3, rect.y+rect.height/2);
    await page.mouse.move(rect.x+10, rect.y+10); await page.mouse.down();
    await page.mouse.move(5,5); await page.mouse.up();
    assert.equal(await native.evaluate(el=>el.open),true);
    await page.mouse.click(5,5);
    await page.waitForFunction(()=>window.closes===1);
  } finally { await browser.close(); }
});


