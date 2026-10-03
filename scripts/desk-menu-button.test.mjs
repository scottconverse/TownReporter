import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/* The phone Menu button's edge and 44px height are measured by the clickable guard walk.
   These two pins are what a rendered measurement cannot read: its words and its state. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = readFileSync(join(ROOT, "src", "components", "desk-chrome.tsx"), "utf8");

/** The phone bar's menu `<button>`, cut out of the shell. */
function menuButton() {
  const at = CHROME.indexOf('className="btn quiet astra-menu"');
  assert.ok(at > -1, "the header draws no Quiet-level `button.astra-menu`");
  return CHROME.slice(CHROME.lastIndexOf("<button", at), CHROME.indexOf("</button>", at));
}

test("the phone menu button says the word Menu beside its icon", () => {
  /* Bug caught: a bare hamburger icon with no visible label that a phone reader cannot tell is a button. */
  assert.match(menuButton(), />\s*<Menu[\s\S]*?\/>\s*Menu\b/, 'the visible word "Menu" is gone');
  assert.doesNotMatch(menuButton(), /aria-label="Open navigation"/, "the spoken name no longer contains the visible word");
});

test("the phone menu button exposes whether the menu is open", () => {
  /* Bug caught: a screen reader user cannot tell the menu is open or what the button controls. */
  assert.match(menuButton(), /aria-expanded=\{menuOpen\}/);
  assert.match(menuButton(), /aria-controls="desk-navigation"/);
});
