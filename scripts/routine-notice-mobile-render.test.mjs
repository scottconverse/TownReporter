import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { moduleUrl } from "./dom-harness.mjs";

const { RoutineNoticeAutomationPreview } = await import(
  await moduleUrl("src/components/routine-notice-automation-preview.tsx")
);

// guards: an approved source address can push Notice rules past a phone screen.
test("notice attribution fits a 390-pixel screen in both themes", async () => {
  const markup = renderToStaticMarkup(
    createElement(RoutineNoticeAutomationPreview, {
      sources: [
        {
          sourceId: 2875,
          formatKey: "library-notice",
          issuer: "City of Longmont",
          locality: "Longmont, Colorado",
          publicSourceUrl: "https://longmontcolorado.gov/events/category/library/",
        },
      ],
    }),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const theme of ["desk-ltr astra", "desk-ltr astra night"]) {
      await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}main{box-sizing:border-box;width:390px;padding:0 17px;font:16px/1.5 Arial}.break-all{word-break:break-all}</style><div class="${theme}"><main>${markup}</main></div>`);
      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        right: Math.max(...[...document.querySelectorAll("*")].map((el) => el.getBoundingClientRect().right)),
      }));
      assert.equal(layout.scrollWidth, 390);
      assert.ok(layout.right <= 390);
    }
  } finally {
    await browser.close();
  }
});
