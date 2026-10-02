#!/usr/bin/env node
/**
 * The Queue's controls must stay on ONE line at 1280, in both text sizes.
 *
 * WHY THIS EXISTS. CI on PR 173 failed `Built server boots and serves` with
 *
 *   Queue search overlaps the tab strip by 3.1px
 *   [06-1280px-light-large-queue.png]
 *
 * and nothing had seen it before, because no walk that measured it had ever
 * been run on that branch. What it is: `.queue-controls` is a `nowrap` flex row
 * (the drawing's one line, and `desk-uiux-walk.mjs` asserts it at every
 * sampled width from 1280 up), the tab strip is `flex: 0 0 auto` because a
 * squeezed strip clips its own labels, and the search field is at its
 * `min-width` floor. When the rest of the row is a few pixels wider than the
 * column, nothing in it can give -- and because `.queue-filters` is
 * `justify-content: flex-end`, what overflows comes out of the LEFT side of
 * that box, with the search field riding back underneath the tab strip. An
 * overlap, not a wrap: at a glance the bar looks fine until the two boxes are
 * measured against each other.
 *
 * UI1b made the row 20px wider by giving each of the two selects the Quiet box
 * -- its own 1px edge AND its own 4px horizontal padding, inside a wrapper
 * that already had both. At 1280 in Large text the row then needed 979.6px of
 * a 970px column. Main needed 963.6px and fit with 6.4px to spare.
 *
 * This file is the arithmetic that keeps it fitting, and it opens no browser:
 * it reads the declarations the row's width is made of out of
 * `src/desk-astra.css`. The widths that come from TEXT -- the tab labels and
 * the two selects' option lists -- are pinned as MEASURED constants from the
 * desk the walk itself seeds (`Infrastructure` is the longest default section
 * name), with where each was measured named beside it. A change to any of the
 * spacings below moves the total; if it moves it past the column, this fails
 * before a browser does.
 *
 * Run directly for the table: `node scripts/queue-controls-one-line.test.mjs`
 * Run under the suite as a node:test file: it is one (see the bottom).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = join(ROOT, "src", "desk-astra.css");
const raw = readFileSync(CSS_PATH, "utf8");

// ── Parse ───────────────────────────────────────────────────────────────────

/** Every rule in the sheet as `{ prelude, decls, media }`, `media` being the
 *  prelude of the enclosing `@media` (or null). Comments are stripped first,
 *  so a selector named inside a comment can never be mistaken for a rule. */
function rules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];

  const scan = (from, to, media) => {
    let i = from;
    let prelude = "";
    while (i < to) {
      const ch = src[i];
      if (ch === "{") {
        let depth = 1;
        let j = i + 1;
        while (j < to && depth > 0) {
          if (src[j] === "{") depth += 1;
          else if (src[j] === "}") depth -= 1;
          j += 1;
        }
        const body = src.slice(i + 1, j - 1);
        const selector = prelude.trim();
        if (selector.startsWith("@")) {
          scan(i + 1, j - 1, /^@media/.test(selector) ? selector : media);
        } else if (selector) {
          found.push({ prelude: selector, decls: body, media });
        }
        i = j;
        prelude = "";
        continue;
      }
      if (ch !== "}") prelude += ch;
      i += 1;
    }
  };

  scan(0, src.length, null);
  return found;
}

const SHEET = rules(raw);

/** The value of `prop` in the LAST rule whose selector is exactly `selector`
 *  and whose enclosing `@media` is exactly `media` (null for the base rules).
 *  Last one wins, which is how the cascade reads for equal specificity. */
function declared(selector, prop, media = null) {
  let value = null;
  for (const rule of SHEET) {
    if (rule.prelude !== selector) continue;
    if ((rule.media || null) !== (media || null)) continue;
    const match = rule.decls.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]+)`, "i"));
    if (match && match[1].trim()) value = match[1].trim();
  }
  return value;
}

const Q = ".desk-ltr.astra";

/** The band that compacts the bar: the narrowest @media that both starts at or
 *  under 1280 and reaches at least 1340 -- the range the walk pins to one line
 *  while the column is still narrow. */
const BAND =
  [...new Set(SHEET.map((rule) => rule.media).filter(Boolean))].find((media) => {
    const min = Number((media.match(/min-width:\s*(\d+)px/) || [])[1]);
    const max = Number((media.match(/max-width:\s*(\d+)px/) || [])[1]);
    return Number.isFinite(min) && Number.isFinite(max) && min <= 1280 && max >= 1340;
  }) || null;

// ── The two controls the fix is about ───────────────────────────────────────

test("the Queue's selects keep their edge and their 44px target", () => {
  const select = `${Q} .queue-sel select`;
  assert.equal(
    declared(select, "min-height"),
    "44px",
    "the select is a control the clickable guard measures: it stays 44px tall",
  );
  assert.equal(
    declared(select, "border"),
    "1px solid var(--fg2)",
    "the select keeps the 1px --fg2 edge that makes it read as a control",
  );
});

test("the Queue's selects carry no second horizontal inset", () => {
  const select = `${Q} .queue-sel select`;
  const padding = declared(select, "padding") || "0";
  const parts = padding.split(/\s+/);
  // 1 value = all sides; 2 = vertical horizontal; 3 = top horizontal bottom;
  // 4 = top right bottom left.
  const horizontal =
    parts.length === 1
      ? parts[0]
      : parts.length === 2 || parts.length === 3
        ? parts[1]
        : parts[3];
  assert.ok(
    horizontal === "0" || horizontal === "0px",
    `the wrapper already insets the select (padding: ${declared(`${Q} .queue-sel`, "padding")}); ` +
      `a second horizontal inset on the select is the 8px per control that put the row ` +
      `past its column (found padding: ${padding})`,
  );
});

// ── The band where the one line is tight ────────────────────────────────────

test("a compaction band covers 1280 through 1439", () => {
  assert.ok(
    BAND,
    "no @media rule covers 1280-1340. At 1340 the strip's full 14px tab padding " +
      "came back, so the one-line bar was at its widest exactly where the column " +
      "was still narrow -- main itself had 3.6px of overflow there",
  );
  assert.match(BAND, /min-width:\s*1280px/);
  assert.match(BAND, /max-width:\s*1439px/);
});

test("the narrow band spends less on chrome than the base rules do", () => {
  assert.equal(
    declared(`${Q} .queue-controls`, "gap", BAND),
    "10px",
    "the row's own gap comes down in the band",
  );
  assert.equal(
    declared(`${Q} .queue-controls .queue-tabs > button`, "padding-inline", BAND),
    "6px",
    "the tab labels' padding is the row's biggest lever",
  );
  assert.equal(
    declared(`${Q} .queue-filters`, "gap", BAND),
    "8px",
    "the filters' gaps come down in the band",
  );
});

// ── The row's width against the column it sits in ───────────────────────────

/* Every number below that is not read from the sheet is MEASURED, on the desk
   `desk-uiux-walk.mjs` seeds (five lead tabs, `Infrastructure` the longest
   section name), at 1280x1000 in Chromium -- and the parts of those widths
   that a declaration moves are then derived from the declaration, so a change
   to one of them moves the total below instead of sitting outside it. */
const COLUMN_AT_1280 = 970; // .queue-controls' border box: 270..1240
const TABS = 5; // Open, Held, Killed, ≈ Printed, All
const STRIP_TEXT_LARGE = 337.02; // the five labels' words, Large text, 18.7px bold
const STRIP_EDGES = 6; // the strip's own 1px left edge + five 1px button edges
const WRAPPER_BASE_LARGE = [184.58, 230.03]; // both wrappers with NO select inset
/* Measured: the two wrappers go 184.58 -> 194.58 and 230.03 -> 240.03 when the
   select carries `padding: 2px 4px`, so 4px of inset per side costs 10px of
   control -- 2.5px per 1px declared, which is what this charges. */
const WRAPPER_INSET_COST = 2.5;
const SEARCH_FLOOR = 100; // .queue-search's min-width, and the walk's floor for it
const FILTER_GAPS = 2; // three items in .queue-filters

test("at 1280 in Large text the one-line bar fits its column with room to spare", () => {
  const rowGap = Number.parseFloat(declared(`${Q} .queue-controls`, "gap", BAND));
  const filtersGap = Number.parseFloat(declared(`${Q} .queue-filters`, "gap", BAND));
  const tabPadding =
    Number.parseFloat(
      declared(`${Q} .queue-controls .queue-tabs > button`, "padding-inline", BAND) ||
        declared(`${Q} .seg-strip > button`, "padding")?.split(/\s+/).pop(),
    ) || 0;
  const selectInset = Number.parseFloat(
    (declared(`${Q} .queue-sel select`, "padding") || "0").split(/\s+/).pop(),
  ) || 0;
  assert.equal(tabPadding, 6, "the tab padding in the band -- see the test above");
  const strip = STRIP_TEXT_LARGE + STRIP_EDGES + TABS * 2 * tabPadding;
  const wrappers = WRAPPER_BASE_LARGE.map((width) => width + selectInset * WRAPPER_INSET_COST);
  const total =
    strip + rowGap + SEARCH_FLOOR + filtersGap * FILTER_GAPS + wrappers.reduce((sum, w) => sum + w, 0);
  const slack = COLUMN_AT_1280 - total;
  assert.ok(
    slack >= 15,
    `the Queue's one-line controls need ${total.toFixed(1)}px of a ${COLUMN_AT_1280}px ` +
      `column: ${slack.toFixed(1)}px ${slack < 0 ? "OVER" : "spare"}. CI's own font ` +
      `measured ~5.5px wider than this machine's, and below zero the row does not ` +
      `wrap -- it overlaps, because .queue-filters is justify-content: flex-end`,
  );
});

test("the search keeps the floor the walk insists on, and the strip is not squeezed", () => {
  assert.equal(
    declared(`${Q} .queue-search`, "min-width"),
    "100px",
    "shrinking the search is not a fix: desk-uiux-walk fails it under 100px",
  );
  assert.equal(
    declared(`${Q} .queue-tabs`, "flex"),
    "0 0 auto",
    "a squeezed strip clips its own labels, which the walk also fails",
  );
});
