import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/*
  UI1b-4, the second half of the button-contrast work.

  `desk-button-contrast.test.mjs` (UI1a) pinned the four BUTTON LEVELS. This
  file pins the rest of the family the design system draws as controls but the
  desk had left as plain text: the segmented strips, the tab strips, every
  native select, the disclosure toggles, the Quiet-looking text buttons and the
  whole-row press targets. The clickable-controls guard walk measured 327 of
  them -- "no edge/fill under 3:1" -- on the built desk before this unit.

  It reads the REAL stylesheets, resolves custom properties the way the browser
  does (including the `.night` redefinitions, whose selector is
  `.desk-ltr.astra.night, :root[data-appearance="desk-dark"] .desk-ltr.astra`),
  and computes WCAG 2.1 relative-luminance contrast. Nothing here is asserted
  against a hand-copied hex: the numbers are printed so the report can quote
  them rather than guess.

  Mutations the brief asks for:
    (a) put `--line` back on any one of these edges (`.today-seg` is the one
        named) and the edge sweep fails with the 1.4:1 number printed;
    (b) remove the selected segment's ink fill (`background: var(--fg)`) and the
        fill assertion fails, because an unselected segment would then be the
        only thing the strip draws.
*/

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DESK_CSS = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8");
const APP_CSS = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
const FLOOR = 3;

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

/** The custom properties a rule sets, as a name -> value map. */
function tokensOf(css, selectorTest) {
  const tokens = {};
  for (const rule of parseRules(css)) {
    if (!selectorTest(rule.selector)) continue;
    for (const m of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[m[1]] = m[2].trim();
    }
  }
  return tokens;
}

/* The desk's own light block. styles.css's `.desk-ltr` block is deliberately
   NOT merged in: it spells the same ten names as `var(--color-rule)` chain
   links into Tailwind's fixed `@theme`, and desk-astra.css's literals are what
   the browser ends up with on a desk page (it is linked second). */
const LIGHT = {
  ...tokensOf(DESK_CSS, (s) => s.split(",").some((p) => p.trim() === ".desk-ltr.astra")),
};
const NIGHT = {
  ...LIGHT,
  ...tokensOf(DESK_CSS, (s) =>
    s.split(",").some((p) => p.trim().startsWith(".desk-ltr.astra.night")),
  ),
};

/** Follow `var(--x)` chains until a literal falls out. */
function resolve(value, tokens, depth = 0) {
  assert.ok(depth < 10, `custom property chain too deep: ${value}`);
  const v = String(value).trim();
  const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) {
    const next = tokens[varMatch[1]];
    assert.ok(next, `token ${varMatch[1]} is not defined`);
    return resolve(next, tokens, depth + 1);
  }
  return v;
}

function toRgb(value) {
  const hex = value.trim();
  const short = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return [1, 2, 3].map((i) => parseInt(short[i] + short[i], 16));
  const long = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (long) return [1, 2, 3].map((i) => parseInt(long[i], 16));
  const rgb = hex.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return [1, 2, 3].map((i) => Number(rgb[i]));
  assert.fail(`cannot read a colour out of ${value}`);
}

function luminance(value) {
  const [r, g, b] = toRgb(value).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function splitSelectors(selector) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(selector.slice(start).trim());
  return out;
}

/**
 * The declaration a rule paints its EDGE (or its FILL) with, read from the real
 * stylesheets. desk-astra.css is linked after styles.css, so where two rules
 * both carry the selector the astra one is the one the browser uses.
 */
function declarationFor(css, selectorPart, property) {
  let found = null;
  for (const rule of parseRules(css)) {
    if (!splitSelectors(rule.selector).includes(selectorPart)) continue;
    const border = rule.body.match(/(?:^|[;\s])border:\s*([^;]+);/);
    const borderLeft = rule.body.match(/border-left:\s*([^;]+?)\s*;/);
    const borderRight = rule.body.match(/border-right:\s*([^;]+?)\s*;/);
    const borderColor = rule.body.match(/border-color:\s*([^;]+?)\s*;/);
    const background = rule.body.match(/(?:^|[;\s])background:\s*([^;]+?)\s*;/);
    let raw = null;
    if (property === "border") {
      raw = (border ? border[1].match(/\S+$/)?.[0] : null) ?? borderColor?.[1];
    } else if (property === "borderLeft") {
      raw = borderLeft ? borderLeft[1].match(/\S+$/)?.[0] : null;
    } else if (property === "borderRight") {
      raw = borderRight ? borderRight[1].match(/\S+$/)?.[0] : null;
    } else {
      raw = background?.[1] ?? null;
    }
    if (raw) found = raw;
  }
  return found;
}

/**
 * Every edge this unit drew, with the selector its declaration lives under and
 * the two grounds a desk control is drawn on: the page (`--bg`) and a panel
 * (`--surface`).
 */
const EDGES = [
  {
    name: "segmented filter, Today (.today-seg)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .today-seg",
    property: "borderLeft",
  },
  {
    name: "segmented filter, Stats (.st-range)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .st-range",
    property: "borderLeft",
  },
  {
    name: "segmented filter, Follow-ups (.fu-filter)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .fu-filter",
    property: "borderLeft",
  },
  {
    name: "segmented filter, Published/Sources (.astra-seg-opt)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .astra-seg-opt",
    property: "borderLeft",
  },
  {
    name: "segmented filter, Queue/Drafts (.seg-strip > button)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .seg-strip > button",
    property: "borderRight",
  },
  {
    name: "tab strip, inspector (.astra-inspector-tabs button)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .astra-inspector-tabs button",
    property: "borderLeft",
  },
  {
    name: "tab strip, Models ([role=tablist] > [role=tab])",
    css: DESK_CSS,
    selector: '.desk-ltr.astra [role="tablist"] > [role="tab"]',
    property: "borderLeft",
  },
  {
    name: "Dark Desk file row (.astra-file-open)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .astra-file-open",
    property: "border",
  },
  {
    name: "Opinion door (.astra-card-link)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .astra-card-link",
    property: "border",
  },
  {
    name: "dialog check row (.astra-check)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .astra-check",
    property: "border",
  },
  {
    name: "select, every desk default (.desk-ltr.astra select)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra select",
    property: "border",
  },
  {
    name: "select, Queue sort/section (.queue-sel select)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .queue-sel select",
    property: "border",
  },
  {
    name: "select, model picker (.model-picker select)",
    css: APP_CSS,
    selector: ".desk-ltr .model-picker select",
    property: "border",
  },
  {
    name: "select, local model picker (.local-model-picker select)",
    css: APP_CSS,
    selector: ".desk-ltr .local-model-picker select",
    property: "border",
  },
  {
    name: "refresh (.model-picker-refresh)",
    css: APP_CSS,
    selector: ".desk-ltr .model-picker-refresh",
    property: "border",
  },
  {
    name: "stats ghost button (.st-btn.ghost)",
    css: DESK_CSS,
    selector: ".desk-ltr.astra .st-btn.ghost",
    property: "border",
  },
  {
    name: "disclosure toggle (summary:not(.btn))",
    css: DESK_CSS,
    selector: ".desk-ltr summary:not(.btn)",
    property: "border",
  },
  {
    name: "navigational link (.np-link)",
    css: APP_CSS,
    selector: ".desk-ltr .np-link",
    property: "border",
  },
];

test("every segment, tab, select, toggle and row edge clears 3:1 on both desk grounds, in both themes", () => {
  const rows = [];
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    for (const ground of ["--bg", "--surface"]) {
      const groundColour = resolve(tokens[ground], tokens);
      for (const edge of EDGES) {
        const declared = declarationFor(edge.css, edge.selector, edge.property);
        assert.ok(
          declared,
          `${edge.name}: no ${edge.property} declaration found under ${edge.selector}`,
        );
        const colour = resolve(declared, tokens);
        const ratio = Number(contrastRatio(colour, groundColour).toFixed(2));
        rows.push({ theme, ground, name: edge.name, colour, groundColour, ratio, pass: ratio >= FLOOR });
      }
    }
  }

  const failures = rows.filter((r) => !r.pass);
  assert.deepEqual(
    failures.map(
      (f) =>
        `${f.theme}: ${f.name} is ${f.ratio}:1 (${f.colour} on ${f.groundColour} for ${f.ground})`,
    ),
    [],
    "these control edges are below the 3:1 floor for a non-text indicator (WCAG 1.4.11)",
  );
  assert.ok(rows.length >= 72, `expected a full sweep, got ${rows.length} rows`);
});

/*
  The segmented strips and the tabs identify themselves with an EDGE and a
  FILL, and the fill is the half the design system actually names: README §6,
  "the selected segment in ink fill" with background-coloured text. A strip
  whose selected segment lost its fill would still pass the edge sweep above --
  every segment would be an outlined box -- so the fill is checked on its own,
  against the ground the strip sits on, and the label on the fill is checked to
  AA.
*/
const SELECTED = [
  { name: "Today", on: ".desk-ltr.astra .today-seg.on" },
  { name: "Stats", on: ".desk-ltr.astra .st-range.on" },
  { name: "Follow-ups", on: ".desk-ltr.astra .fu-filter.on" },
  { name: "Published/Sources", on: ".desk-ltr.astra .astra-seg-opt.on" },
  { name: "Queue/Drafts", on: '.desk-ltr.astra .seg-strip > button[aria-pressed="true"]' },
  { name: "inspector tabs", on: '.desk-ltr.astra .astra-inspector-tabs button[aria-selected="true"]' },
];

test("the selected segment is an ink fill, and its label is readable on the fill", () => {
  const rows = [];
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    const groundColour = resolve(tokens["--surface"], tokens);
    const ink = resolve(tokens["--fg"], tokens);
    const onInk = resolve(tokens["--bg"], tokens);
    for (const seg of SELECTED) {
      const fill = resolve(declarationFor(DESK_CSS, seg.on, "background"), tokens);
      const fillRatio = Number(contrastRatio(fill, groundColour).toFixed(2));
      const labelRatio = Number(contrastRatio(onInk, ink).toFixed(2));
      rows.push({ theme, name: seg.name, fill, fillRatio, ink, onInk, labelRatio });
      assert.ok(
        fillRatio >= FLOOR,
        `${theme}: the selected ${seg.name} segment's fill (${fill}) is ${fillRatio}:1 on the panel`,
      );
      assert.ok(
        labelRatio >= 4.5,
        `${theme}: the selected ${seg.name} segment's label (${onInk} on ${ink}) is ${labelRatio}:1`,
      );
    }
  }
  /* The Models tab strip paints its own fill inline (desk.models.tsx), so the
     stylesheet sweep above only reaches the stylesheet-painted ones. That is
     asserted at the source instead. */
  const models = readFileSync(join(ROOT, "src", "routes", "desk.models.tsx"), "utf8");
  assert.match(
    models,
    /background:\s*tab === key \? "var\(--fg\)" : "transparent"/,
    "the Models tab strip's selected fill moved out of the source",
  );
  assert.match(
    models,
    /color:\s*tab === key \? "var\(--bg\)" : "var\(--fg\)"/,
    "the Models tab strip's selected label colour moved out of the source",
  );
  assert.equal(rows.length, 12);
});

/*
  The numbers this unit is about, printed so the report can quote them rather
  than guess: the hairline `--line` a control edge used to be painted with, and
  the `--fg2` Quiet edge it is painted with now.
*/
test("the before-and-after numbers for a control edge are what the report claims", () => {
  const lines = [];
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    for (const ground of ["--bg", "--surface"]) {
      const groundColourGround = resolve(tokens[ground], tokens);
      const before = Number(
        contrastRatio(resolve(tokens["--line"], tokens), groundColourGround).toFixed(2),
      );
      const after = Number(
        contrastRatio(resolve(tokens["--fg2"], tokens), groundColourGround).toFixed(2),
      );
      assert.ok(before < FLOOR, `${theme}: --line on ${ground} should be under 3:1, measured ${before}:1`);
      assert.ok(after >= FLOOR, `${theme}: --fg2 on ${ground} must clear 3:1, measured ${after}:1`);
      lines.push(`${theme} ${ground}: --line ${before}:1 -> --fg2 ${after}:1`);
    }
  }
  console.log("UI1b-4 control-edge contrast:\n  " + lines.join("\n  "));
  assert.equal(lines.length, 4);
});

/*
  Mutation (a). `.today-seg` is the strip the brief names: with `--line` back on
  it, the segment's edge is the hairline rule token again and the sweep above
  fails. This asserts the mechanism directly, so a future edit that swaps the
  token back is caught here even if the ratio arithmetic is refactored.
*/
test("no control edge in this unit's sweep is painted with the hairline --line token", () => {
  for (const edge of EDGES) {
    const declared = declarationFor(edge.css, edge.selector, edge.property);
    const raw = String(declared).toLowerCase();
    assert.ok(
      !raw.includes("var(--line)") && raw !== "#d8d3c4" && raw !== "#3b3631",
      `${edge.name} is back on the hairline --line token (${declared})`,
    );
  }
  /* And the token really is the one that fails: if --line ever became a 3:1
     rule this assertion would be noise, so it is measured, not assumed. */
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    const ratio = contrastRatio(resolve(tokens["--line"], tokens), resolve(tokens["--surface"], tokens));
    assert.ok(ratio < FLOOR, `${theme}: --line on --surface is ${ratio.toFixed(2)}:1, no longer a hairline`);
  }
});
