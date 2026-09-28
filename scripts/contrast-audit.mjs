#!/usr/bin/env node
/**
 * Contrast audit for the desk's readability tokens.
 *
 * An operator screenshot of the Killed tab in dark mode: text that was both
 * small (chips, dates, meta lines as low as 9.5px) and, for anything routed
 * through the Tailwind `text-muted` / `text-ink-2` utilities on desk.ops.tsx
 * / desk.dark.tsx / desk-leads.tsx / model-picker.tsx, the *fixed light-mode*
 * brown rendered on a dark background -- as low as 1.4:1. "Bad design for
 * old eyes."
 *
 * This parses the desk's actual CSS custom properties out of
 * `src/styles.css` (the `.desk-ltr` block for light values, `.desk-ltr.night`
 * for the dark overrides, `@theme` for the raw `--color-*` values those
 * reference) rather than hardcoding hex, so a future change to a token's
 * color is audited automatically instead of silently drifting out of sync
 * with this file. It then walks every (foreground token, background token)
 * pair actually paired in the CSS -- chips, meta lines, section
 * sub-headings, table labels, the "hot" score badge, the inverted
 * solid-button/chip colors -- computes WCAG contrast for both themes, and
 * prints a PASS/FAIL table.
 *
 * Run directly for the table: `node scripts/contrast-audit.mjs`
 * Run under the suite as a node:test file: it is one (see the bottom).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = join(ROOT, "src", "styles.css");
const css = readFileSync(CSS_PATH, "utf8");

// ── Parse CSS custom properties ─────────────────────────────────────────────

/** Grab the declarations inside the first `{...}` after a literal selector text. */
function blockAfter(text, selector) {
  const at = text.indexOf(selector);
  if (at < 0) throw new Error(`selector not found: ${selector}`);
  const open = text.indexOf("{", at);
  const close = text.indexOf("}", open);
  return text.slice(open + 1, close);
}

/** The same, against this file's own stylesheet. */
function block(selector) {
  return blockAfter(css, selector);
}

/** Parse `--name: value;` pairs out of a declaration block. */
function customProps(text) {
  const out = new Map();
  for (const m of text.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const themeVars = customProps(block("@theme {"));
const deskLightVars = customProps(block(".desk-ltr {"));
const deskDarkVars = customProps(block(".desk-ltr.night, .desk-ltr .nightpanel {"));

/**
 * Resolve a value that may itself be `var(--color-x)` (against @theme) or
 * `var(--n-x)` (the dark-mode raw hex constants declared alongside the rest
 * of the desk tokens in the `.desk-ltr` block, e.g. `--n-bg`, `--n-a`).
 */
function resolveHex(value) {
  const varMatch = value.match(/^var\(--([\w-]+)\)$/);
  if (!varMatch) return value;
  const name = varMatch[1];
  const resolved = themeVars.get(name) ?? deskLightVars.get(name);
  if (!resolved) throw new Error(`unresolved var: --${name}`);
  return resolved;
}

/** The named desk tokens (--bg, --fg, --mut, ...), resolved to hex, per theme. */
function deskTokens(overrideVars) {
  const names = ["bg", "bg2", "fg", "fg2", "mut", "line", "a", "adeep", "sel", "ok", "warn", "danger"];
  const out = {};
  for (const name of names) {
    const raw = overrideVars.has(name) ? overrideVars.get(name) : deskLightVars.get(name);
    out[name] = resolveHex(raw);
  }
  return out;
}

const light = deskTokens(new Map()); // .desk-ltr itself, no override
const dark = deskTokens(deskDarkVars); // .desk-ltr.night overrides on top

// ── WCAG contrast math ──────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance({ r, g, b }) {
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [chan(r), chan(g), chan(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA, hexB) {
  const La = relLuminance(hexToRgb(hexA));
  const Lb = relLuminance(hexToRgb(hexB));
  const [lighter, darker] = La >= Lb ? [La, Lb] : [Lb, La];
  return (lighter + 0.05) / (darker + 0.05);
}

// ── The pairs actually rendered by the desk's CSS ───────────────────────────
//
// size: "normal" text needs 4.5:1 (AA); "large" (>=18px, or >=14px + bold,
// per WCAG's large-text definition -- note that is *not* the same as this
// pass's 14px informational floor, which is normal-weight) needs 3:1.
// kind: "text" pairs are asserted against the floor below (fails the test
// under it). "ui" pairs (the hover/active link color, a non-text component
// indicator) are reported and checked against the 3:1 non-text minimum but
// not asserted here. "decorative" pairs (hairline dividers) carry no
// information on their own and have no WCAG requirement; reported only.

const PAIRS = [
  { fg: "mut", bg: "bg", label: ".meta / .sec-sub / chip default / table headers, on page bg", kind: "text", size: "normal" },
  { fg: "mut", bg: "bg2", label: ".meta-family text over a bg2 panel (.side-note, .openfile, .deskfile.sel)", kind: "text", size: "normal" },
  { fg: "fg2", bg: "bg", label: ".lead-why / .side-why / .worth-line / text-ink-2, on page bg", kind: "text", size: "normal" },
  { fg: "fg2", bg: "bg2", label: "fg2 text inside a bg2 panel", kind: "text", size: "normal" },
  { fg: "fg", bg: "bg", label: "primary body/heading text (.h1, .sec-title, default)", kind: "text", size: "normal" },
  { fg: "warn", bg: "bg", label: ".warn-inline / .wire-warn / .chip.dnp / .note-gate -- attention, on page bg", kind: "text", size: "normal" },
  { fg: "danger", bg: "bg", label: ".chip.st-killed / .screen-error-message / .note.err / .of-stop.err -- failure, on page bg", kind: "text", size: "normal" },
  { fg: "ok", bg: "bg", label: ".chip.st-published, on page bg", kind: "text", size: "normal" },
  { fg: "adeep", bg: "bg", label: ".chip.st-drafted / .kick / .inline-link / .np-link, on page bg", kind: "text", size: "normal" },
  // This row used to check `--a` on `--bg`, which is 1.42:1 in light (yellow on
  // cream) and was reported as a FAIL. Nothing paints it any more: every
  // indicator that has to be seen reads `--sel` (ink in light, gold in dark),
  // which is the whole reason `--sel` exists as a token. The audit follows the
  // CSS rather than the old name.
  { fg: "sel", bg: "bg", label: "accent-colored native controls (accent-color on checkboxes /.document-progress) and the current-step marks, on page bg", kind: "ui", size: "large" },
  { fg: "bg", bg: "fg", label: "inverted ink fills (.nav-dark, .seg-opt.on) -- the two that survived the redesign's move of .btn.solid to the yellow", kind: "text", size: "normal" },
  { fg: "bg", bg: "danger", label: ".btn.danger.solid (Yes, delete / Yes, do it) -- bg text on the danger fill", kind: "text", size: "normal" },
  { fg: "line", bg: "bg", label: "hairline borders (.rule1, .chip border, .sechead) -- decorative dividers, not asserted", kind: "decorative", size: "large" },
  // Notice (states.tsx) carries the README's three shapes: ok is a solid 1px
  // `--ok`, err is 2px dashed `--danger`, warn is solid 2px `--warn` (amber).
  // All three sit on the notice's own `--bg2` panel, which is what these rows
  // check -- the shape is not contrast, but the color still has to be legible.
  { fg: "danger", bg: "bg2", label: ".notice-err text on the notice's bg2 panel", kind: "text", size: "normal" },
  { fg: "warn", bg: "bg2", label: ".notice-warn text on the notice's bg2 panel", kind: "text", size: "normal" },
  { fg: "ok", bg: "bg2", label: ".notice-ok text on the notice's bg2 panel", kind: "text", size: "normal" },
];

// score.hot is a special case: the number sits on the accent FILL, and text on
// the yellow is #111 in both themes (styles.css `.score.hot`, and the same
// answer for the primary button and the `new` chip). #111 is ~13:1 on #ffd23f
// and ~11:1 on #e6c35c; white would be 1.7:1 and the dark theme's own ground
// 1.5:1, which is why this is checked as its own pair rather than through a
// named desk token.
const SCORE_HOT = {
  light: { fg: "#111111", bg: light.a },
  dark: { fg: "#111111", bg: dark.a },
};

// ── Compute + report ─────────────────────────────────────────────────────

function verdict(ratio, size, kind) {
  const floor = size === "large" ? 3 : 4.5;
  // Decorative dividers carry no text and aren't required to meet WCAG
  // contrast at all; the ratio is still reported for the record.
  return { pass: kind === "decorative" ? null : ratio >= floor, floor };
}

function rows() {
  const out = [];
  for (const pair of PAIRS) {
    for (const [themeName, tokens] of [["light", light], ["dark", dark]]) {
      const fgHex = tokens[pair.fg];
      const bgHex = tokens[pair.bg];
      const ratio = contrastRatio(fgHex, bgHex);
      const { pass, floor } = verdict(ratio, pair.size, pair.kind);
      out.push({ ...pair, theme: themeName, fgHex, bgHex, ratio, pass, floor });
    }
  }
  for (const [themeName, pair] of [["light", SCORE_HOT.light], ["dark", SCORE_HOT.dark]]) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    const { pass, floor } = verdict(ratio, "normal", "text");
    out.push({
      fg: "score.hot text",
      bg: "score.hot bg (--a)",
      label: ".score.hot number (14px bold)",
      kind: "text",
      size: "normal",
      theme: themeName,
      fgHex: pair.fg,
      bgHex: pair.bg,
      ratio,
      pass,
      floor,
    });
  }
  return out;
}

function printTable(data) {
  const header = ["theme", "ratio", "floor", "verdict", "kind", "fg→bg", "label"];
  const lines = [header.join(" | ")];
  for (const r of data) {
    lines.push(
      [
        r.theme.padEnd(5),
        r.ratio.toFixed(2).padStart(5),
        `${r.floor}:1`,
        r.pass === null ? "N/A " : r.pass ? "PASS" : "FAIL",
        r.kind,
        `${r.fgHex} on ${r.bgHex}`,
        r.label,
      ].join(" | "),
    );
  }
  console.log(lines.join("\n"));
}

/*
  The pending/error screens ("Opening the desk") are the one surface that
  renders outside the desk shell, so they cannot inherit either palette --
  they declare their own (0.6.64, Unit AE; the rule is in styles.css). Before
  that rule they took the letterpress black above (`--n-bg: #000000`), which
  the desk never uses. A palette declared in this file rather than inherited
  is exactly the kind of thing this audit exists to catch, so it is checked
  here instead of being assumed from the desk's own dark tokens.
*/
const screenPageDark = customProps(block(':root[data-appearance="desk-dark"] .screen-page {'));
const SCREEN_PAGE_PAIRS = [
  { fg: "fg", label: 'ScreenPending heading and body copy ("Opening the desk")' },
  { fg: "fg2", label: "ScreenPending secondary copy" },
  { fg: "mut", label: 'ScreenPending hint ("Setting type...") and meta' },
  { fg: "adeep", label: "ScreenPending kicker (EDITOR DESK) and links" },
  { fg: "warn", label: "ScreenPending error copy (.warn-inline)" },
  { fg: "danger", label: "error copy on the pending/error screens (.screen-error, .notice-err)" },
  { fg: "color-danger", label: "error-component.tsx danger text (text-danger)" },
];

/*
  /desk/dark's captured-page panel (Unit CQ, 0.6.81) -- the other place on the
  desk where a palette is declared in a file instead of inherited.

  The screen's open-file text sits in a `.reader`, the public paper's reader
  class, whose stylesheet is imported globally (`src/routes/__root.tsx:14`) and
  whose block declares a light palette on the panel element itself
  (`src/reader-astra.css:24-40`: `--bg` #fffdf7, `--ink` #111111, `--line`
  #d8d3c4, ...). A declaration on the element outranks an inherited value, so
  those literals shadowed the desk's tokens for the panel's whole subtree while
  the panel's own classes went on painting from the desk's tokens
  (`src/styles.css:1615-1630`) -- bone `--adeep` and `--mut` text on a cream
  ground in dark mode, 1.23:1. `src/desk-astra.css` now re-points the reader's
  names at the desk's tokens on that page only.

  This section computes the panel's colors from whatever that rule actually
  says, per theme, and holds them against a table -- so deleting the rule puts
  the literal back, the panel computes a cream ground under the dark theme's
  bone text, and the tests below go red with the ratio the screen shipped with.
  The expected table is itself checked against the shell's own tokens, so it
  cannot drift away from the desk's palette while still passing.
*/
const astraCss = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8");
const readerCss = readFileSync(join(ROOT, "src", "reader-astra.css"), "utf8");

const astraLight = customProps(blockAfter(astraCss, ".desk-ltr.astra {"));
const astraDark = customProps(blockAfter(astraCss, ".desk-ltr.astra.night,"));
const readerOwn = customProps(blockAfter(readerCss, ".reader {"));
const panelGroundAlias = customProps(blockAfter(astraCss, '[data-desk-page="dark"] {'));
const panelRemap = customProps(blockAfter(astraCss, '[data-desk-page="dark"] .reader {'));

/** The reader's three non-color declarations: a length and two font stacks. */
const READER_NON_COLORS = new Set(["reading", "serif"]);

/**
 * The reader names the panel deliberately leaves alone: they are read only by
 * rules that need a descendant class this panel does not render
 * (`.reader .btn`, `.reader .tag`, `.reader .iconbtn`), so nothing inside the
 * panel reads them, and the desk has no alias to point them at.
 */
const PANEL_UNMAPPED = ["a", "sel", "ok", "warn"];

/** Resolve a value the way the browser would: at the element that declares it. */
function resolvePanelValue(value, shellVars, seen = new Set()) {
  const m = value.match(/^var\(--([\w-]+)\)$/);
  if (!m) return value;
  const name = m[1];
  if (seen.has(name)) throw new Error(`custom-property cycle on --${name}`);
  seen.add(name);
  const declared = panelGroundAlias.get(name) ?? shellVars.get(name);
  if (declared === undefined) throw new Error(`unresolved var: --${name} (via ${value})`);
  return resolvePanelValue(declared, shellVars, seen);
}

/**
 * The shell's tokens as the browser computes them, for one theme.
 *
 * `desk-astra.css` declares the `--color-*` aliases once, in the light block;
 * the night rule on the same element redefines only the short names those
 * aliases point at. A var() is substituted on the element where it is
 * declared -- the same element here -- so in dark mode `--color-paper` still
 * carries the text `var(--surface)` from the light rule and computes on an
 * element where the night rule has already replaced `--surface`. Merging the
 * two blocks in that order is that computation: the aliases first (they are
 * declared once and never re-declared), then the theme's own values over them.
 */
function shellTokens(themeVars) {
  return new Map([...astraLight, ...themeVars]);
}

/** What every token the reader declares computes to inside /desk/dark, per theme. */
function panelTokens(themeVars) {
  const shellVars = shellTokens(themeVars);
  const out = {};
  for (const [name, own] of readerOwn) {
    out[name] = resolvePanelValue(panelRemap.get(name) ?? own, shellVars);
  }
  return out;
}

/**
 * The panel's palette, name by name. Light is the reader's own block verbatim
 * (the re-point is chosen from aliases that hold the same value in light, so
 * the light build does not move); dark is the desk's dark tokens.
 */
const PANEL_EXPECTED = {
  light: {
    bg: "#fffdf7", surface: "#f6f2e7", ink: "#111111", muted: "#3a3a3a",
    line: "#d8d3c4", teal: "#111111", soft: "#f6f2e7", warm: "#f6f2e7",
    danger: "#b3261e",
  },
  dark: {
    bg: "#1b1916", surface: "#27231f", ink: "#e8e6e1", muted: "#bdbab3",
    line: "#3b3631", teal: "#e8e6e1", soft: "#27231f", warm: "#27231f",
    danger: "#f0998c",
  },
};

/**
 * Which desk token each re-pointed reader name lands on -- the mapping the
 * panel's dark column above is asserted against, so the table is a restatement
 * of the desk's palette and not a second opinion about it.
 */
const PANEL_DESK_SOURCE = {
  bg: "bg", surface: "surface", ink: "fg", muted: "mut", line: "line",
  teal: "adeep", soft: "bg2", warm: "bg2", danger: "danger",
};

/**
 * The text the panel paints, and the ground it paints on. Every one is 14-15px
 * at normal weight, so all three are held to 4.5:1. These are the rows the
 * browser survey of the screen measured at 1.23:1 and 1.9:1 in dark before the
 * re-point, and the ground is the one the panel actually computes.
 */
const PANEL_PAIRS = [
  { fg: "adeep", source: "desk", label: ".read-kind, .inline-link, .reader-row:hover .read-title" },
  { fg: "mut", source: "desk", label: ".read-url, .np-meta" },
  { fg: "ink", source: "panel", label: "the panel's base text and the .read-full body" },
];

/** The panel's rows, for both the printed table and the assertion below. */
function panelRows() {
  const out = [];
  for (const [themeName, themeVars] of [["light", astraLight], ["dark", astraDark]]) {
    const shellVars = shellTokens(themeVars);
    const panel = panelTokens(themeVars);
    for (const pair of PANEL_PAIRS) {
      const fgHex = pair.source === "panel" ? panel[pair.fg] : shellVars.get(pair.fg);
      out.push({
        theme: themeName,
        fgHex,
        bgHex: panel.bg,
        ratio: contrastRatio(fgHex, panel.bg),
        label: pair.label,
      });
    }
  }
  return out;
}

// ── node:test: fail the build under 4.5:1 for any "text" token pair ────────

test("every desk text-color token pairing meets WCAG AA in both themes", () => {
  const failures = rows().filter((r) => r.kind === "text" && !r.pass);
  assert.deepEqual(
    failures.map((f) => `${f.theme} ${f.fgHex} on ${f.bgHex} = ${f.ratio.toFixed(2)}:1 (${f.label})`),
    [],
    "these token pairings fail WCAG AA contrast for readable text",
  );
});

test("the pending/error screens meet WCAG AA on the desk's dark palette", () => {
  const bgHex = resolveHex(screenPageDark.get("bg"));
  const rows = SCREEN_PAGE_PAIRS.map((pair) => {
    const fgHex = resolveHex(screenPageDark.get(pair.fg));
    return { fgHex, ratio: contrastRatio(fgHex, bgHex), label: pair.label };
  });
  const failures = rows.filter((r) => r.ratio < 4.5);
  assert.deepEqual(
    failures.map((f) => `${f.fgHex} on ${bgHex} = ${f.ratio.toFixed(2)}:1 (${f.label})`),
    [],
    "these pending/error-screen pairings fail WCAG AA contrast for readable text",
  );
  // The palette really is the desk's dark one, not the letterpress black this
  // screen used to paint, and not the blue-black it painted between those two
  // -- and the parse found the rule at all. Since the redesign the desk's dark
  // and this screen's dark are the same warm black, which is the point.
  assert.equal(bgHex.toLowerCase(), "#1b1916");
  assert.equal(rows.length, SCREEN_PAGE_PAIRS.length);
});

test("desk tokens parsed from styles.css are the ones the CSS actually declares", () => {
  // A change to a hex value in styles.css should move this audit's numbers
  // without anyone touching this file -- sanity-check the parse itself.
  assert.equal(light.bg.toLowerCase(), "#fffdf7");
  assert.equal(dark.bg.toLowerCase(), "#1b1916");
  assert.equal(dark.mut.toLowerCase(), dark.fg2.toLowerCase());
});

// ── /desk/dark's captured-page panel ────────────────────────────────────────

test("the reader panel section parses the CSS it means to", () => {
  assert.equal(astraLight.get("bg").toLowerCase(), "#fffdf7", "desk-astra.css .desk-ltr.astra");
  assert.equal(astraDark.get("bg").toLowerCase(), "#1b1916", "desk-astra.css .desk-ltr.astra.night");
  assert.equal(readerOwn.get("bg").toLowerCase(), "#fffdf7", "reader-astra.css .reader");
  assert.equal(readerOwn.get("reading"), "21px", "reader-astra.css .reader");
  assert.equal(panelRemap.size, 10, "the re-point block in desk-astra.css");
});

test("the panel re-points every reader name the panel can read", () => {
  const colors = [...readerOwn.keys()].filter((n) => !READER_NON_COLORS.has(n));
  assert.deepEqual(
    colors.filter((n) => !panelRemap.has(n)),
    PANEL_UNMAPPED,
    "reader names still carrying their own literal inside /desk/dark",
  );
  // Every re-pointed value has to resolve through the shell, in both themes --
  // a name typed wrong here would silently paint nothing at all.
  for (const [name, value] of panelRemap) {
    for (const themeVars of [astraLight, astraDark]) {
      assert.doesNotThrow(
        () => resolvePanelValue(value, shellTokens(themeVars)),
        `--${name}: ${value}`,
      );
    }
  }
});

test("the panel paints the desk's dark palette when the desk is dark", () => {
  const panel = panelTokens(astraDark);
  const drift = [];
  for (const [name, hex] of Object.entries(PANEL_EXPECTED.dark)) {
    if (panel[name].toLowerCase() !== hex) {
      drift.push(`--${name}: computed ${panel[name]}, expected ${hex}`);
    }
    // …and the expected hex is the shell's own token, so the table is a
    // restatement of the desk's palette rather than a second opinion about it.
    const source = PANEL_DESK_SOURCE[name];
    if (astraDark.get(source).toLowerCase() !== hex) {
      drift.push(`desk --${source} is ${astraDark.get(source)}, the table says ${hex}`);
    }
  }
  assert.deepEqual(drift, []);
});

test("the panel paints the reader's own palette when the desk is light", () => {
  // The re-point reads aliases that hold the reader's own light values, so the
  // light build does not move -- which is why light mode was never the defect
  // and is not changed here.
  const panel = panelTokens(astraLight);
  const drift = [];
  for (const [name, hex] of Object.entries(PANEL_EXPECTED.light)) {
    if (panel[name].toLowerCase() !== hex) {
      drift.push(`--${name}: computed ${panel[name]}, expected ${hex}`);
    }
    if ((readerOwn.get(name) ?? "").toLowerCase() !== hex) {
      drift.push(`--${name}: reader-astra.css declares ${readerOwn.get(name)}, the table says ${hex}`);
    }
  }
  assert.deepEqual(drift, []);
});

test("the panel's text meets WCAG AA on the ground it paints, in both themes", () => {
  const failures = panelRows().filter((r) => r.ratio < 4.5);
  assert.deepEqual(
    failures.map((f) => `${f.theme} ${f.fgHex} on ${f.bgHex} = ${f.ratio.toFixed(2)}:1 (${f.label})`),
    [],
    "the panel's text fails WCAG AA on its own ground",
  );
  assert.equal(panelRows().length, 6);
});

test("no /desk/dark rule declares a literal color", () => {
  // The screen follows the desk's tokens. The rule that used to break this was
  // a `.nightpanel` sub-palette (--fg #e8e6e1, --line #3b3631, ...) scoped to
  // this page, which matched nothing on it -- a latent trap, not a live bug.
  const rules = [...astraCss.matchAll(/\[data-desk-page="dark"\][^{]*\{/g)];
  assert.ok(rules.length >= 4, `expected the screen's rules to parse, found ${rules.length}`);
  const literals = [];
  for (const m of astraCss.matchAll(/\[data-desk-page="dark"\][^{]*\{([^}]*)\}/g)) {
    for (const hex of m[1].matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      literals.push(`${m[0].split("{")[0].trim()} -> ${hex[0]}`);
    }
  }
  assert.deepEqual(literals, []);
});

/*
  The CLI print sits at the end of the file, after every top-level `const` it
  reads. It used to sit above the /desk/dark panel section, which made
  `panelRows()` reach for `astraLight` while it was still in its temporal dead
  zone -- `node scripts/contrast-audit.mjs` died with a ReferenceError instead
  of printing the panel table. Test runs never saw it: under `node --test` this
  guard is false, so the print block never executed on the path CI takes.
*/
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  printTable(rows());
  console.log("");
  console.log("-- /desk/dark's captured-page panel (the open file's text) --");
  for (const r of panelRows()) {
    console.log(
      [
        r.theme.padEnd(5),
        r.ratio.toFixed(2).padStart(5),
        "4.5:1",
        r.ratio >= 4.5 ? "PASS" : "FAIL",
        "text ",
        `${r.fgHex} on ${r.bgHex}`,
        r.label,
      ].join(" | "),
    );
  }
}
