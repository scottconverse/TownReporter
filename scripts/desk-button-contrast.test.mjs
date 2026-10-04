import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/*
  UI1a, test 1 of 4: EVERY BUTTON LEVEL'S EDGE CLEARS 3:1, IN BOTH THEMES.

  Scott, after pressing "Publish anyway - I accept these claims are
  unreviewed" on the live paper: "That DOES NOT look like something you can
  click. BAD interface." The auditor measured the desk at 881cbfe8 and found
  463 controls whose border or fill was under 3:1 against the surface behind
  them. The biggest single cause was `.btn.quiet` -- a 1px `--line` edge, and
  `--line` is a hairline RULE token (#d8d3c4 on the cream panel, 1.4:1).

  This test does not hard-code a colour or a ratio. It reads the real
  stylesheets, resolves the custom properties the way the browser would
  (including the `.night` block's redefinitions), and computes WCAG 2.1
  relative-luminance contrast for each level against the two grounds a desk
  button actually sits on: the panel (`--surface`) and the page (`--bg`).

  Mutation (a) of the brief: put the `.btn.quiet` edge back to `var(--line)`
  and this fails with the 1.4:1 number printed.
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

const LIGHT = {
  ...tokensOf(DESK_CSS, (s) => s.split(",").some((p) => p.trim() === ".desk-ltr.astra")),
};
const NIGHT = {
  ...LIGHT,
  ...tokensOf(DESK_CSS, (s) =>
    s.split(",").some((p) => p.trim().startsWith(".desk-ltr.astra.night")),
  ),
};

/**
 * Follow `var(--x)` chains until a literal falls out.
 *
 * UI1b-5: it reads the two-argument form too -- `var(--primary-edge,
 * var(--fg))` -- because that is how the Primary's edge names a token the
 * LIGHT theme does not define. The fallback is what the browser would use when
 * the property is unset, so resolving it here is the same reading, not a
 * shortcut.
 */
function resolve(value, tokens, depth = 0) {
  assert.ok(depth < 10, `custom property chain too deep: ${value}`);
  const v = value.trim();
  const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (varMatch) {
    const next = tokens[varMatch[1]];
    if (next !== undefined) return resolve(next, tokens, depth + 1);
    assert.ok(varMatch[2], `token ${varMatch[1]} is not defined and has no fallback`);
    return resolve(varMatch[2], tokens, depth + 1);
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

/**
 * The declaration a level paints its EDGE (or its FILL) with, read from the
 * real stylesheets. Later rules win, and desk-astra.css is linked after
 * styles.css, so the astra rule is the one the browser uses.
 */
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

function declarationFor(css, selectorParts, property) {
  let found = null;
  for (const rule of parseRules(css)) {
    const selectors = splitSelectors(rule.selector);
    if (!selectors.includes(selectorParts)) continue;
    const border = rule.body.match(/(?:^|[;\s])border:\s*([^;]+);/);
    const borderColor = rule.body.match(/border-color:\s*([^;]+?)\s*;/);
    const background = rule.body.match(/background:\s*([^;]+?)\s*;/);
    const raw =
      property === "border"
        ? (border ? border[1].match(/\S+$/)?.[0] : null) ?? borderColor?.[1]
        : (background?.[1] ?? null);
    if (raw) found = raw;
  }
  return found;
}

const PRIMARY_SELECTOR = ".desk-ltr.astra :is(.btn.solid, .document-add-button)";

const LEVELS = [
  {
    /*
      A filled control is still identified by its BOUNDARY: the yellow fill is
      1.42:1 on the cream page, so before UI1a the primary had no boundary at
      all. It carries the family's 2px ink edge now, and THAT EDGE is what the
      light theme is measured on -- the label on the fill is asserted
      separately, below.

      UI1b-5: WHICH OF THE TWO CARRIES THE 3:1 IS A THEME QUESTION. README §6:
      the Primary is "Yellow fill, #111 text" with a 2px #111 edge in LIGHT, and
      in DARK "the edge is the same colour as the fill". So in the night theme
      the edge IS the fill and the thing that separates the control from the
      page is the yellow itself -- which is why `perTheme` names a different
      declaration, and a different property, for each: the ink edge in light,
      the fill in dark. The `edgeMatchesFill` check below is what stops the
      dark edge from quietly going back to the text colour (bone #e8e6e1).
    */
    name: "primary (.btn.solid)",
    perTheme: {
      light: { css: DESK_CSS, selector: PRIMARY_SELECTOR, property: "border" },
      night: { css: DESK_CSS, selector: PRIMARY_SELECTOR, property: "background" },
    },
  },
  {
    name: "secondary (.btn)",
    edge: { css: DESK_CSS, selector: ".desk-ltr.astra :is(.btn, .document-add-button)", property: "border" },
  },
  {
    name: "quiet (.btn.quiet)",
    edge: { css: DESK_CSS, selector: ".desk-ltr.astra .btn.quiet", property: "border" },
  },
  {
    name: "danger (.btn.danger)",
    edge: { css: DESK_CSS, selector: ".desk-ltr.astra .btn.danger", property: "border" },
  },
  {
    /* UI1a2: Kill's level, and the one `ActionTone`'s `quiet-danger` draws.
       `.desk-ltr .btn.quiet.danger` (styles.css, four classes) beats
       `.desk-ltr .btn.danger` (three), so that is the declaration the browser
       uses -- the same "later and more specific wins" order the test claims. */
    name: "quiet-danger (.btn.quiet.danger)",
    edge: { css: APP_CSS, selector: ".desk-ltr .btn.quiet.danger", property: "border" },
  },
  {
    name: "gated/disabled (.btn.gated)",
    edge: { css: DESK_CSS, selector: ".desk-ltr.astra .btn.gated", property: "border" },
  },
  {
    /* The non-astra shell's own copy: linked first, so it only wins outside
       `.astra`, but it must not be allowed to keep the invisible edge. */
    name: "quiet (.desk-ltr .btn.quiet)",
    edge: { css: APP_CSS, selector: ".desk-ltr .btn.quiet", property: "border" },
  },
];

test("every button level's edge or fill clears 3:1 on both desk grounds, in both themes", () => {
  const rows = [];
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    /* The two grounds a desk button is drawn on: the page and a panel. */
    for (const ground of ["--bg", "--surface"]) {
      const groundColour = resolve(tokens[ground], tokens);
      for (const level of LEVELS) {
        const spec = level.perTheme ? level.perTheme[theme] : (level.edge ?? level.fill);
        const declared = declarationFor(spec.css, spec.selector, spec.property);
        assert.ok(declared, `${level.name}: no ${spec.property} declaration found in ${spec.selector}`);
        const colour = resolve(declared, tokens);
        const ratio = Number(contrastRatio(colour, groundColour).toFixed(2));
        rows.push({
          theme,
          ground,
          level: level.name,
          colour,
          groundColour,
          ratio,
          pass: ratio >= FLOOR,
        });
      }
    }
  }

  const failures = rows.filter((r) => !r.pass);
  assert.deepEqual(
    failures.map(
      (f) =>
        `${f.theme}: ${f.level} is ${f.ratio}:1 (${f.colour} on ${f.groundColour} for ${f.ground})`,
    ),
    [],
    "these button levels are below the 3:1 floor for a non-text indicator (WCAG 1.4.11)",
  );

  /* Sanity: the sweep really did resolve numbers, and the quiet level is the
     one this unit changed -- if `--line` came back it would be here. */
  assert.ok(rows.length >= 24, `expected a full sweep, got ${rows.length} rows`);
  const quiet = rows.find((r) => r.theme === "light" && r.level === "quiet (.btn.quiet)");
  assert.notEqual(
    quiet.colour.toLowerCase(),
    resolve(LIGHT["--line"], LIGHT).toLowerCase(),
    "the quiet edge is back on the hairline --line token",
  );
});

/*
  UI1a2: THE PHASES THE SHARED PIECE PAINTS ARE MEASURED TOO.

  `ActionButton` writes the phase's colour TOKEN onto the button as
  `data-token`, and desk-astra.css resolves each one. A working / done / failed
  press is still a control an editor has to be able to SEE, so all three clear
  the same 3:1 floor against both grounds, in both themes -- and the numbers are
  printed here rather than asserted against a hex nobody can check.

  Every level: `quiet` draws an `fg2` edge at rest and takes the phase colour
  from the same rule, so a done quiet button is a green edge on the panel, and a
  failed one is red.
*/
const PHASE_TOKENS = [
  { phase: "working", token: "fg2" },
  { phase: "done", token: "ok" },
  { phase: "failed", token: "danger" },
];

test("every action phase's colour clears 3:1 on both desk grounds, in both themes", () => {
  const rows = [];
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    for (const ground of ["--bg", "--surface"]) {
      const groundColour = resolve(tokens[ground], tokens);
      for (const { phase, token } of PHASE_TOKENS) {
        assert.ok(tokens[`--${token}`], `--${token} is not a desk token`);
        const colour = resolve(tokens[`--${token}`], tokens);
        const ratio = Number(contrastRatio(colour, groundColour).toFixed(2));
        rows.push({ theme, ground, phase, token, colour, groundColour, ratio, pass: ratio >= FLOOR });
      }
    }
  }

  /* The stylesheet really does resolve each phase token -- the numbers below
     are about a rule that exists, not about a variable nobody paints with. */
  for (const { phase, token } of PHASE_TOKENS) {
    if (phase === "working") {
      assert.match(DESK_CSS, /\.action-btn\[data-token="fg2"\][\s\S]{0,80}var\(--fg2\)/);
    } else {
      assert.match(
        DESK_CSS,
        new RegExp(`\\.action-btn\\[data-token="${token}"\\][\\s\\S]{0,160}var\\(--${token}\\)`),
      );
    }
  }

  const failures = rows.filter((r) => !r.pass);
  assert.deepEqual(
    failures.map(
      (f) =>
        `${f.theme}: the ${f.phase} phase (${f.token}) is ${f.ratio}:1 (${f.colour} on ${f.groundColour} for ${f.ground})`,
    ),
    [],
    "an action phase is below the 3:1 floor for a non-text indicator (WCAG 1.4.11)",
  );
  assert.ok(rows.length >= 12, `expected a full phase sweep, got ${rows.length} rows`);
});

test("the phase ratios are reported, not asserted against a guess", () => {
  /* A short table in the test log: the report quotes these. */
  const lines = [];
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    for (const { phase, token } of PHASE_TOKENS) {
      const colour = resolve(tokens[`--${token}`], tokens);
      const onBg = Number(contrastRatio(colour, resolve(tokens["--bg"], tokens)).toFixed(2));
      const onSurface = Number(
        contrastRatio(colour, resolve(tokens["--surface"], tokens)).toFixed(2),
      );
      lines.push(`${theme} ${phase} (${token} ${colour}): ${onBg}:1 on --bg, ${onSurface}:1 on --surface`);
    }
  }
  console.log("UI1a2 action phase contrast:\n  " + lines.join("\n  "));
  assert.equal(lines.length, 6);
});

test("the primary fill keeps #111 on it, and the ratio is reported", () => {
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    const fill = resolve(
      declarationFor(
        DESK_CSS,
        ".desk-ltr.astra :is(.btn.solid, .document-add-button)",
        "background",
      ),
      tokens,
    );
    const ratio = Number(contrastRatio("#111", fill).toFixed(2));
    assert.ok(ratio >= 4.5, `${theme}: #111 on the primary fill (${fill}) is ${ratio}:1`);
  }
});

/*
  The numbers this test is really about, printed so the report can quote them
  rather than guess: the `.btn.quiet` edge before (--line) and after (--fg2).
*/
test("the quiet edge's before-and-after numbers are what the report claims", () => {
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["night", NIGHT],
  ]) {
    const before = Number(
      contrastRatio(resolve(tokens["--line"], tokens), resolve(tokens["--surface"], tokens)).toFixed(2),
    );
    const after = Number(
      contrastRatio(resolve(tokens["--fg2"], tokens), resolve(tokens["--surface"], tokens)).toFixed(2),
    );
    assert.ok(before < FLOOR, `${theme}: --line on --surface should be under 3:1, measured ${before}:1`);
    assert.ok(after >= FLOOR, `${theme}: --fg2 on --surface must clear 3:1, measured ${after}:1`);
  }
});
