import { it } from "node:test";
import assert from "node:assert/strict";
import { saveShortcutLabel } from "./save-shortcut-label.ts";

it("shows the save key for the reader's platform", () => {
  assert.equal(saveShortcutLabel("Win32"), "Ctrl+S");
  assert.equal(saveShortcutLabel("Linux x86_64"), "Ctrl+S");
  assert.equal(saveShortcutLabel("MacIntel"), "⌘S");
});
