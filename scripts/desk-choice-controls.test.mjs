/*
  UI1b-8: THE CHOICE CONTROLS THE GUARD COULD NOT SEE.

  The bot's finding on PR 173: the clickable walk's collector stopped at
  button/submit inputs and its cursor fallback could not recover a control with
  the browser's default cursor, so native checkboxes, radios, file inputs and
  ranges were never classified at all -- CI could report zero failures while a
  whole control family broke the target rule. The walk now collects them, and
  `scripts/lib/clickable-guard.mjs` judges a checkbox or radio on itself OR on
  the `<label>` that takes the press.

  THE TWO ROWS THAT HAD TO BE FIXED IN THE PRODUCT. Both were invisible to the
  walk on the day it learned to look:

    - `/desk/import`'s file picker is in `inputClass`, whose edge utility is
      `border-rule` -- a 1px `--line`, the hairline UI1a removed from the Quiet
      button and the exact defect the guard's 3:1 rule exists to catch. It is
      the only control on the route that the guard can see, and it failed.
    - the import cards' "Import as" / "The text this story carries" / "Who
      wrote this" choices, the source rows they keep and "Hold this on the
      desk" are native radios and checkboxes in plain `<label>`s with no drawn
      box of their own. They are `.choice-row` now: the same Quiet box
      `.astra-check` takes, so the row that takes the press looks like it.

  A pin, not a render: the arithmetic itself is driven in
  scripts/desk-clickable-guard.test.mjs with no browser, and the walk measures
  the real pixels. This file exists so a later edit cannot quietly take the box
  or the class back.

  Mutation: delete `border: 1px solid var(--fg2)` from `.choice-row` in
  src/desk-astra.css and the first test fails naming the row.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DESK_CSS = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8");
const IMPORT = readFileSync(join(ROOT, "src", "routes", "desk.import.tsx"), "utf8");

/** The rule body for an exact selector, comments stripped. */
function ruleBody(css, selector) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const found = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean))) {
    const selectors = match[1].split(",").map((s) => s.trim());
    if (selectors.includes(selector)) found.push(match[2]);
  }
  return found.join("\n");
}

test("the import cards' choice rows carry the Quiet box and the 44px floor", () => {
  const box = ruleBody(DESK_CSS, ".desk-ltr.astra .choice-row");
  assert.match(box, /border:\s*1px solid var\(--fg2\)/, "the choice row lost its edge");
  assert.doesNotMatch(box, /var\(--line\)/, "a hairline --line edge is the defect, not the fix");

  const floor = DESK_CSS.replace(/\/\*[\s\S]*?\*\//g, " ").match(
    /\.desk-ltr\.astra[^{}]*\.choice-row[^{}]*\{[^}]*min-height:\s*44px/,
  );
  assert.ok(floor, "the choice row is not in the 44px floor list");
});

test("every radio and checkbox on /desk/import is inside a choice row", () => {
  const rows = [];
  const re = /<label\b([^>]*)>([\s\S]*?)<\/label>/g;
  let match;
  while ((match = re.exec(IMPORT))) {
    const [attrs, body] = [match[1], match[2]];
    if (!/<input\b[^>]*type="(radio|checkbox)"/.test(body)) continue;
    rows.push({ attrs, at: match.index, type: RegExp.$1 });
  }
  assert.ok(rows.length >= 5, `expected the import cards' choice rows, found ${rows.length}`);
  for (const row of rows) {
    assert.match(
      row.attrs,
      /className="[^"]*\bchoice-row\b/,
      `a ${row.type} row at offset ${row.at} has no drawn box -- it is a press with nothing to press`,
    );
  }
});

test("the file picker's edge is --fg2, not the inputClass hairline", () => {
  const file = ruleBody(DESK_CSS, '.desk-ltr.astra input[type="file"]');
  assert.match(file, /border:\s*1px solid var\(--fg2\)/, "the file picker's edge is back to a hairline");
  assert.match(file, /min-height:\s*44px/, "the file picker is not a 44px target");
});
