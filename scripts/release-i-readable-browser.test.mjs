import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [appCss, deskCss] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/desk-astra.css", import.meta.url), "utf8"),
]);

function rgb(value) {
  const parts = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert.ok(parts?.length === 3, `Expected an RGB color, received ${value}`);
  return parts.map((part) => {
    const channel = part / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function contrastRatio(foreground, background) {
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [a, b] = [luminance(rgb(foreground)), luminance(rgb(background))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

test("FA09: selected desk navigation stays readable on the first dark-mode frame", async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(
        '<html><body><div class="desk-ltr astra"><nav class="astra-navigation">' +
          '<a id="selected" class="astra-nav active" aria-current="page">Queue</a>' +
        '</nav></div></body></html>',
      );
      await page.addStyleTag({ content: appCss });
      await page.addStyleTag({ content: deskCss });
      const frame = await page.locator("#selected").evaluate((element) => {
        document.documentElement.dataset.appearance = "desk-dark";
        const style = getComputedStyle(element);
        return { foreground: style.color, background: style.backgroundColor };
      });
      const ratio = contrastRatio(frame.foreground, frame.background);
      assert.ok(
        ratio >= 4.5,
        `${width}px first dark frame contrast was ${ratio.toFixed(2)}:1 (${frame.foreground} on ${frame.background})`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test("FB21: the one-time invite message wraps its long link at phone width", async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const token = "a".repeat(180);
    const message = `You are invited to edit the paper. Open this link on the computer you will write from:\nhttps://127.0.0.1:3400/login?invite=${token}\nIt works once and expires in seven days.`;
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(
        `<html data-desk-size="large"><body style="margin:0"><div class="desk-ltr astra">` +
          `<section style="width:calc(100vw - 32px);max-width:640px;margin:16px">` +
          `<p id="message" class="invite-copy-message" style="white-space:pre-wrap;font-size:calc(16px * var(--ts, 1))">${message}</p>` +
          `</section></div></body></html>`,
      );
      await page.addStyleTag({ content: appCss });
      await page.addStyleTag({ content: deskCss });
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        message: document.querySelector("#message").scrollWidth,
        messageWidth: document.querySelector("#message").clientWidth,
      }));
      assert.ok(
        layout.document <= layout.viewport && layout.message <= layout.messageWidth,
        `${width}px invite message overflowed: document ${layout.document}px; message ${layout.message}/${layout.messageWidth}px`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
