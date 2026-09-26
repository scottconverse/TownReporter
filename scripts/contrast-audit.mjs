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
function block(selector) {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`selector not found in styles.css: ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
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
  // check -- the shape is not contrast, but the colour still has to be legible.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  printTable(rows());
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
