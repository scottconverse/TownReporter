/**
 * UI1b-5: CHIPS ARE SENTENCE CASE, AND "READY TO CHECK" IS NOT GREEN.
 *
 * THE RULING. The designer, relayed by the auditor:
 *
 *   "Chips: sentence case, no ALL CAPS.  'Ready to check' chip: neutral chip,
 *    1px --ink2 border, ink text, sentence case. Not yellow. Same chip for
 *    'Ready to edit' and 'Ready to print'."
 *
 * WHAT WAS WRONG. Every chip on the desk is drawn through one rule --
 * `.desk-ltr .chip { text-transform: uppercase }` in `src/styles.css` -- so the
 * words the desk stores reached the editor as READY TO CHECK. README §7 is the
 * rule that was broken: "Sentence case everywhere except kickers, which are
 * uppercase." The Drafts screen's state chip was ALSO drawn in `d-ok`, the
 * green 1px border README §6 gives a state somebody has verified: the checks a
 * finished draft still faces live on the story page and are not on the row, so
 * green was a verdict the row could not read. It is the table's "Waiting" level
 * now -- 1px `--fg2`, and the ink for the text.
 *
 * WHAT THIS FILE PINS, off the real stylesheets and the real source:
 *
 *   1. no chip class anywhere uppercases;
 *   2. `.chip` itself declares `text-transform: none` (not merely "unset" --
 *      a later rule could put it back without anybody noticing);
 *   3. the Ready chip is 1px `--fg2`, no fill, ink text, and NOTHING in the
 *      `.night` block overrides it, so it is the same chip in both themes;
 *   4. Drafts routes the `ready` state to that chip and no longer to `d-ok`;
 *   5. Today's "Ready to edit" card stage is sentence case too.
 *
 * Mutations of the brief: put `text-transform: uppercase` back on any chip
 * class and test 1 fails naming it; point `stateTone`'s `ready` branch at
 * `d-ok` and test 4 fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHEETS = [
  ["styles.css", readFileSync(join(ROOT, "src", "styles.css"), "utf8")],
  ["desk-astra.css", readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8")],
];
const DRAFTS = readFileSync(join(ROOT, "src", "routes", "desk.drafts.tsx"), "utf8");

/**
 * Every class this desk draws a state chip or a state label with. The names
 * come from the two stylesheets' own chip families, not from a guess: rename
 * one and it stops being covered here, which is why the list is written out.
 */
const CHIP_CLASSES = [
  "chip",
  "astra-chip",
  "astra-blocker-chip",
  "astra-evidence-chip",
  "wire-chip",
  "fu-chip",
  "job-card-chip",
  "today-card-stage",
];

/** Walk a stylesheet into {selector, body, media} triples, brace-depth aware. */
function parseRules(css, media = null) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules = [];
  let i = 0;
  let selectorStart = 0;
  while (i < noComments.length) {
    if (noComments[i] === "{") {
      const selector = noComments.slice(selectorStart, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < noComments.length && depth > 0) {
        if (noComments[j] === "{") depth++;
        else if (noComments[j] === "}") depth--;
        j++;
      }
      const body = noComments.slice(i + 1, j - 1);
      if (/^@media/.test(selector)) rules.push(...parseRules(body, selector));
      else if (selector) rules.push({ selector, body, media });
      i = j;
      selectorStart = i;
      continue;
    }
    i++;
  }
  return rules;
}

function namesChip(selector) {
  const pattern = new RegExp(`\\.(${CHIP_CLASSES.join("|")})(?![\\w-])`);
  return pattern.test(selector);
}

/** The last declaration of `property` on `selector`, in cascade order. */
function declaration(selector, property) {
  let found = null;
  for (const [, css] of SHEETS) {
    for (const rule of parseRules(css)) {
      if (rule.selector !== selector) continue;
      for (const m of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+?)(?:;|$)/g)) {
        if (m[1] === property) found = m[2].trim();
      }
    }
  }
  return found;
}

test("no chip class on the desk is drawn in capitals", () => {
  const offenders = [];
  for (const [file, css] of SHEETS) {
    for (const rule of parseRules(css)) {
      if (!namesChip(rule.selector)) continue;
      const upper = rule.body.match(/text-transform\s*:\s*uppercase/);
      if (upper) offenders.push(`${file}: ${rule.selector}`);
    }
  }
  assert.deepEqual(offenders, [], "these chip rules shout the state they name");
});

test("the shared chip declares sentence case rather than inheriting it", () => {
  assert.equal(
    declaration(".desk-ltr .chip", "text-transform"),
    "none",
    "`.desk-ltr .chip` no longer says `text-transform: none` -- anything could set it back",
  );
});

test("the Ready chip is neutral, in both themes", () => {
  assert.equal(
    declaration(".desk-ltr.astra .chip.d-ready", "border"),
    "1px solid var(--fg2)",
    "the Ready chip's 1px --fg2 edge changed",
  );
  assert.equal(
    declaration(".desk-ltr.astra .chip.d-ready", "background"),
    "transparent",
    "the Ready chip is filled -- it must not be yellow and must not be green",
  );
  assert.equal(
    declaration(".desk-ltr.astra .chip.d-ready", "color"),
    "var(--fg)",
    "the Ready chip's text is not the ink",
  );
  const night = [];
  for (const [, css] of SHEETS) {
    for (const rule of parseRules(css)) {
      if (!rule.media && /\.night/.test(rule.selector) && namesChip(rule.selector)) {
        night.push(rule.selector);
      }
    }
  }
  assert.deepEqual(
    night,
    [],
    "a `.night` rule touches a state chip -- the table's chips are the same chip in both themes",
  );
});

test("Drafts draws the ready state in the neutral chip, not in green", () => {
  const tone = DRAFTS.match(/function stateTone\([\s\S]*?\n\}/);
  assert.ok(tone, "stateTone is gone from desk.drafts.tsx");
  assert.match(tone[0], /if \(state\.key === "ready"\) return "d-ready";/, 'the ready state is not the neutral chip');
  assert.doesNotMatch(tone[0], /state\.key === "ready"\) return "d-ok"/, "the ready state is green again");
});

test("Today's Ready to edit stage is sentence case", () => {
  assert.equal(
    declaration(".desk-ltr.astra .today-card-stage", "text-transform"),
    "none",
    '"Ready to edit" is shouted at the editor again',
  );
});
