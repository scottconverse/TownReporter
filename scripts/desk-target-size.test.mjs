/**
 * UI1b-5: THE 44px FLOOR, ON THE CONTROLS THAT WERE DRAWN SHORTER.
 *
 * THE RULE. README §2.9: "hit targets at least 44px"; §6: "All buttons: at
 * least 44px tall". The guard's baseline (`tmp-guard/baseline.md`, unit UI1b
 * step 1) counted 67 targets under it, and the report named every class:
 *
 *     input.queue-pick (15, 24px)      button.st-btn.ghost (9, 40px)
 *     a.np-link (12, 32.4px)           summary (11, 30-32.4px)
 *     select (6, queue, 26px)          select.ml-2.border.border-rule (3, 43px)
 *     label.astra-check (5, 40.4px)    select#_r_* (6, 40px)
 *
 * WHAT THIS FILE PINS. Height, and only height -- widening any of these would
 * push the Queue's one-line controls bar or the phone header past 390px, which
 * is the sideways scroll `scripts/desk-narrow-width-walk.mjs` exists to catch.
 * The four ways this unit raises them:
 *
 *   1. one `.desk-ltr.astra` blanket for `select`, `summary`, `.np-link`,
 *      `.astra-check` and `.st-btn.ghost`, plus the `.np-link` centring that a
 *      `min-height` on an `inline-block` needs;
 *   2. the Queue's Sort and Section selects, which said `min-height: 0`;
 *   3. the Queue's row checkbox: a hollow 24px mark inside the 44px label, with
 *      the system's ink focus ring (the designer's ruling on PR 173);
 *   4. the phone Menu button, which gets its 44px from `.btn` and is asserted
 *      in `scripts/desk-menu-button.test.mjs`.
 *
 * WHY THE BLANKET BEATS `styles.css`. `.desk-ltr .model-picker select` and
 * `.desk-ltr .f select` say `min-height: 40px`. They carry the same weight as
 * `.desk-ltr.astra select` (two classes and an element either way), so the tie
 * goes to whoever is linked last -- and `__root.tsx` links `desk-astra.css`
 * after `styles.css`. Test 2 asserts that order rather than assuming it.
 *
 * Mutations of the brief: drop `min-height: 44px` from the blanket and test 1
 * fails; put the checkbox's rest state back to a fill (`background: var(--fg2)`)
 * or its focus ring back to `var(--a)` and test 3 fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DESK_CSS = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8");
const APP_CSS = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
const ROOT_TSX = readFileSync(join(ROOT, "src", "routes", "__root.tsx"), "utf8");

/** Walk a stylesheet into {selector, body} pairs, brace-depth aware. */
function parseRules(css) {
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
      if (/^@media/.test(selector)) rules.push(...parseRules(body));
      else if (selector) rules.push({ selector, body });
      i = j;
      selectorStart = i;
      continue;
    }
    i++;
  }
  return rules;
}

/** Every declaration of `property` under `selector`, in source order. */
function declarations(css, selector, property) {
  const out = [];
  for (const rule of parseRules(css)) {
    if (!rule.selector.split(",").some((p) => p.trim() === selector)) continue;
    for (const m of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+?)(?:;|$)/g)) {
      if (m[1] === property) out.push(m[2].trim());
    }
  }
  return out;
}

test("every control the baseline measured short now declares the 44px floor", () => {
  const expected = [
    ["select", "min-height", "44px"],
    ["summary", "min-height", "44px"],
    [".np-link", "min-height", "44px"],
    [".astra-check", "min-height", "44px"],
    [".st-btn.ghost", "min-height", "44px"],
  ];
  for (const [part, property, value] of expected) {
    /*
      The LAST declaration of `min-height` for that exact selector, in source
      order: `.st-btn.ghost` and `select` each have an earlier rule of their
      own, and the blanket at the foot of the file is the one that wins. A
      later rule that does not mention `min-height` (the `--fg2` edge on
      `select`, for instance) does not undo it, which is why this reads
      declarations rather than whole rules.
    */
    const found = declarations(DESK_CSS, `.desk-ltr.astra ${part}`, property);
    assert.ok(found.length, `no \`.desk-ltr.astra ${part}\` rule declares \`${property}\``);
    assert.equal(
      found.at(-1),
      value,
      `\`.desk-ltr.astra ${part}\` ends up at \`${property}: ${found.at(-1)}\`, not ${value}`,
    );
  }
  /* The centring the `.np-link` box needs: `min-height` alone on an
     `inline-block` puts the word on the top edge of its 44px box. */
  assert.equal(
    declarations(DESK_CSS, ".desk-ltr.astra .np-link", "display").at(-1),
    "inline-flex",
    "the 44px `.np-link` box does not centre its own label",
  );
});

test("desk-astra.css is linked after styles.css, so the blanket wins the tie", () => {
  const app = ROOT_TSX.indexOf('import appCss from "../styles.css?url"');
  const desk = ROOT_TSX.indexOf('import deskCss from "../desk-astra.css?url"');
  assert.ok(app > -1 && desk > -1, "the two stylesheets are no longer imported by __root.tsx");
  assert.ok(desk > app, "desk-astra.css is loaded first -- styles.css' 40px selects would win");
  /* The tie is a tie: same weight either side. */
  const weight = (selector) => ({
    classes: (selector.match(/\.[\w-]+/g) ?? []).length,
    elements: (selector.match(/(^|[\s>+~])[a-z]+/g) ?? []).length,
  });
  assert.deepEqual(
    weight(".desk-ltr.astra select"),
    weight(".desk-ltr .model-picker select"),
    "the blanket and the rules it has to beat no longer weigh the same -- recheck the cascade",
  );
});

test("the Queue's Sort and Section selects fill their 46px box", () => {
  assert.equal(
    declarations(DESK_CSS, ".desk-ltr.astra .queue-sel select", "min-height").at(-1),
    "44px",
    "the Queue's two selects are drawn short again",
  );
  /* The box they sit in, so the two cannot drift apart. */
  assert.match(
    DESK_CSS,
    /\.desk-ltr\.astra \.queue-sel \{[^}]*min-height: 46px/,
    "the Queue's select box changed height",
  );
});

test("the Queue's row checkbox is a hollow 24px mark in a 44px label, with an ink focus ring", () => {
  /* Bug caught: a filled unchecked box (reads as checked), and a yellow focus ring (1.4:1 on cream). */
  const input = ".desk-ltr.astra .queue-check > input";
  assert.equal(declarations(DESK_CSS, ".desk-ltr.astra .queue-check", "min-height").at(-1), "44px");
  assert.equal(declarations(DESK_CSS, input, "width").at(-1), "24px");
  assert.equal(declarations(DESK_CSS, input, "border").at(-1), "2px solid var(--fg)");
  assert.equal(declarations(DESK_CSS, input, "background").at(-1), "var(--bg)");
  assert.equal(declarations(DESK_CSS, `${input}:checked`, "background").at(-1), "var(--fg)");
  assert.equal(declarations(DESK_CSS, `${input}:focus-visible`, "outline").at(-1), "2px solid var(--fg)");
});

test("the two links the floor raises are the ones the guard measured", () => {
  /* styles.css is where the drawn sizes were; the astra blanket must be the
     rule that survives. Both are asserted to exist so a deletion of either is
     visible here rather than only in a browser. */
  assert.match(APP_CSS, /\.desk-ltr \.np-link \{[^}]*padding:4px 10px/, "the .np-link base changed");
  assert.match(APP_CSS, /\.desk-ltr \.model-picker select \{min-height:40px/, "the 40px select base changed");
  assert.match(APP_CSS, /\.desk-ltr \.f input, \.desk-ltr \.f select[^{]*\{[^}]*min-height:40px/, "the .f select base changed");
});
