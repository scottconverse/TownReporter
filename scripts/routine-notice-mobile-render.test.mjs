import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "tailwindcss";
import { installDom, moduleUrl } from "./dom-harness.mjs";

installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");

const { RoutineNoticeAutomationPreview } = await import(
  await moduleUrl("src/components/routine-notice-automation-preview.tsx")
);

// guards: an approved source address can push Notice rules past a phone screen.
test("notice attribution fits a 390-pixel screen in both themes", async () => {
  const sources = [
    "https://longmontcolorado.gov/events/category/library/",
    `https://longmontcolorado.gov/${"unbroken-source-address".repeat(30)}`,
  ].map((publicSourceUrl, index) => ({
    sourceId: 2875 + index,
    formatKey: "library-notice",
    issuer: "City of Longmont",
    locality: "Longmont, Colorado",
    publicSourceUrl,
  }));
  for (const theme of ["desk-ltr astra", "desk-ltr astra night"]) {
    const container = document.createElement("main");
    container.className = theme;
    container.style.cssText = "box-sizing:border-box;width:390px;padding:0 17px";
    document.body.append(container);
    const root = createRoot(container);
    const stylesheet = document.createElement("style");
    try {
      await React.act(async () => {
        root.render(React.createElement(RoutineNoticeAutomationPreview, { sources }));
      });

      // linkedom has no layout engine. Check the wrapping contract on the
      // rendered URLs using real Tailwind declarations, not invented CSS or
      // source-text matches; this does not claim to measure pixel geometry.
      const elements = [...container.querySelectorAll("*")];
      const classes = [...new Set(elements.flatMap((element) => [...element.classList]))];
      const utilities = await compile("@tailwind utilities;");
      stylesheet.textContent = utilities.build(classes);
      document.head.append(stylesheet);
      const urlCells = [...container.querySelectorAll("li span")];
      assert.equal(urlCells.length, sources.length, `${theme}: every source has a URL cell`);
      for (const [index, cell] of urlCells.entries()) {
        assert.equal(cell.textContent, sources[index].publicSourceUrl);
        assert.ok(cell.classList.contains("break-all"), `${theme}: URL must wrap within a word`);
      }
      assert.match(stylesheet.textContent, /\.break-all\s*\{\s*word-break:\s*break-all;/);

      const availableWidth = 390 - 2 * 17;
      for (const element of elements) {
        for (const property of ["width", "min-width"]) {
          const value = element.style.getPropertyValue(property);
          if (/^\d+(?:\.\d+)?px$/.test(value)) {
            assert.ok(
              parseFloat(value) <= availableWidth,
              `${theme}: ${property} exceeds container`,
            );
          }
        }
      }
      for (const [, width] of stylesheet.textContent.matchAll(
        /(?:^|[;{])\s*(?:min-)?width:\s*(\d+(?:\.\d+)?)px\b/g,
      )) {
        assert.ok(Number(width) <= availableWidth, `${theme}: utility width exceeds container`);
      }
    } finally {
      await React.act(async () => root.unmount());
      stylesheet.remove();
      container.remove();
    }
  }
});
