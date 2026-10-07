// guards: Windows editors could be shown a save key their keyboard does not have.
import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
const { ShortcutSheet } = await import(
  await moduleUrl("src/components/shortcut-sheet.tsx", {
    "./dialog": stubUrl("export const Dialog = ({children}) => children;"),
  })
);
test("save help follows the editor platform", () => {
  for (const [platform, key] of [
    ["Win32", "Ctrl+S"],
    ["MacIntel", "⌘S"],
  ]) {
    Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true });
    assert.ok(render(h(ShortcutSheet, { open: true, onClose() {} })).includes(key));
  }
});
