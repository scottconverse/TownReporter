/**
 * UI1b-5: THE PHONE MENU IS A LABELLED BUTTON, NOT A BARE HAMBURGER.
 *
 * THE RULING. The designer, relayed by the auditor: "Phone menu = labelled
 * 'Menu' button (Quiet, 44px), not a bare hamburger + 'Desk' chip."
 *
 * WHY IT WAS THE LAST ONE. The guard's baseline (`tmp-guard/baseline.md`, unit
 * UI1b step 1) found 18 "no edge/fill under 3:1" failures, and all 18 were the
 * same control: `button.astra-icon.astra-menu`, drawn once per desk route in
 * the phone bar. `.astra-icon` gave it `background: none; border: 0` and the
 * only thing in it was a 20px lucide glyph -- so the thing that opens the whole
 * navigation for a phone reader was, measurably, plain text. Every other level
 * of the desk's button family had been given an edge by UI1a and UI1b-4.
 *
 * WHAT THIS FILE PINS, from the real source and the real stylesheets:
 *
 *   1. the control is the Quiet level of the one button family (`.btn quiet`),
 *      it carries the WORD "Menu" visibly beside the icon, and its icon is
 *      `aria-hidden` so the word is the label;
 *   2. its accessible name is that word -- not "Open navigation", which the
 *      visible label does not contain (WCAG 2.5.3, Label in Name);
 *   3. it still says what it opens: `aria-expanded` and `aria-controls`;
 *   4. the edge is `--fg2` at 1px and the box is 44px tall, in the phone block;
 *   5. the "Desk" tag is not drawn beside it in the phone bar -- the two labels
 *      said the same thing, and the drawn bar did not fit a 390px phone at
 *      Text: Large with both -- and the brand link keeps the words for a
 *      screen reader through `aria-label`.
 *
 * Mutations of the brief: delete the word "Menu" from the button and test 1
 * fails; put `className="astra-icon astra-menu"` back and test 4 fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = readFileSync(join(ROOT, "src", "components", "desk-chrome.tsx"), "utf8");
const DESK_CSS = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8");

/**
 * The phone bar's `<button>` … `</button>`, cut out of the shell so a match
 * cannot come from somewhere else on a 2,000-line file.
 */
function menuButtonSource() {
  const at = CHROME.indexOf('className="btn quiet astra-menu"');
  assert.ok(at > -1, 'the header draws no `button.astra-menu` at the Quiet level');
  const start = CHROME.lastIndexOf("<button", at);
  const end = CHROME.indexOf("</button>", at);
  assert.ok(start > -1 && end > start, "the menu button is not a closed element");
  return CHROME.slice(start, end);
}

test("the phone menu is the Quiet level and says the word Menu", () => {
  const button = menuButtonSource();
  assert.match(button, /className="btn quiet astra-menu"/, "the level is not `.btn quiet`");
  assert.match(
    button,
    />\s*<Menu[\s\S]*?\/>\s*Menu\b/,
    'the visible word "Menu" is gone -- the icon is the whole label again',
  );
  assert.match(button, /<Menu[^>]*aria-hidden/, "the icon is announced as well as the word");
  assert.doesNotMatch(
    button,
    /aria-label="Open navigation"/,
    "the accessible name is not the visible word (WCAG 2.5.3, Label in Name)",
  );
});

test("the phone menu still says what it opens", () => {
  const button = menuButtonSource();
  assert.match(button, /aria-expanded=\{menuOpen\}/, "the open/closed state is not exposed");
  assert.match(button, /aria-controls="desk-navigation"/, "the controlled panel is not named");
  assert.match(button, /onClick=\{\(\) => setMenuOpen\(!menuOpen\)\}/, "the press changed");
  assert.match(button, /ref=\{menuButton\}/, "the button lost its ref (focus handling)");
});

/**
 * The last declaration of `property` on `.astra-menu` INSIDE the desk's phone
 * block. The phone block is the only place the control is drawn -- every rule
 * above it is the desktop `display: none` -- so the block's own text is what
 * this reads, rather than a cascade the test would have to re-implement.
 */
function phoneMenuDeclaration(property) {
  const phoneBlock = DESK_CSS.slice(DESK_CSS.indexOf("@media (max-width: 700px)"));
  const rule = phoneBlock.match(/\.desk-ltr\.astra \.astra-menu \{([^}]*)\}/);
  assert.ok(rule, "no `.astra-menu` rule in the phone block of desk-astra.css");
  let found = null;
  for (const m of rule[1].matchAll(/([a-z-]+)\s*:\s*([^;]+?)(?:;|$)/g)) {
    if (m[1] === property) found = m[2].trim();
  }
  return found;
}

test("the phone menu keeps the Quiet edge and grows to 44px", () => {
  /* `.desk-ltr.astra .astra-menu` is `display: none` at the desk and
     `display: inline-flex` under 700px; the height and the edge come from the
     `.btn.quiet` level the button now wears. */
  assert.match(
    DESK_CSS,
    /\.desk-ltr\.astra \.btn\.quiet \{[^}]*border: 1px solid var\(--fg2\)/,
    "the Quiet level's 1px --fg2 edge is gone -- the hairline --line is back",
  );
  assert.match(
    DESK_CSS,
    /\.desk-ltr\.astra :is\(\.btn, \.document-add-button\) \{[^}]*min-height: 44px/,
    "the button family's 44px floor is gone",
  );
  const display = phoneMenuDeclaration("display");
  assert.equal(display, "inline-flex", "the phone menu is not drawn on a phone");
  assert.equal(phoneMenuDeclaration("flex"), "none", "the wordmark can still squeeze the label");
});

test("the Desk tag is not drawn beside the Menu button", () => {
  assert.match(
    DESK_CSS,
    /\.desk-ltr\.astra \.astra-brand-bar span \{\s*display: none;/,
    "the phone bar draws the Desk tag next to the Menu button again",
  );
  assert.match(
    CHROME,
    /className="astra-brand astra-brand-bar"[\s\S]{0,200}aria-label="TownReporter, the public news page"/,
    "the brand link lost the words a screen reader needs when the tag is hidden",
  );

  /*
    UI1b-8: THE WORDMARK IS A 44px TARGET AT PHONE WIDTHS.

    Hiding the "Desk" tag left the phone link as its ~24px `<strong>` line box:
    `padding: 0`, no `min-height`, in a bar that centres its children. The
    allowlist entry covers the underline only and its reason promises the
    target rule still applies, so the rule has to hold.
  */
  assert.match(
    DESK_CSS,
    /\.desk-ltr\.astra \.astra-brand-bar \{[^}]*min-height: 44px/,
    "the phone wordmark fell back under 44px",
  );
  assert.match(
    DESK_CSS,
    /\.desk-ltr\.astra \.astra-brand-bar \{[^}]*display: inline-flex/,
    "the wordmark needs a box it can be 44px tall in",
  );
});
