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
  const names = ["bg", "bg2", "fg", "fg2", "mut", "line", "a", "adeep", "warn"];
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
  { fg: "warn", bg: "bg", label: ".chip.st-killed / .warn-inline / .wire-warn, on page bg", kind: "text", size: "normal" },
  { fg: "adeep", bg: "bg", label: ".chip.st-drafted / .kick / .inline-link / .np-link, on page bg", kind: "text", size: "normal" },
  { fg: "a", bg: "bg", label: "a:hover / .nav-item.on underline color, on page bg", kind: "ui", size: "large" },
  { fg: "bg", bg: "fg", label: "inverted solid buttons/chips (.btn.solid, .nav-dark, .seg-opt.on, .chip.st-published, .filter.on)", kind: "text", size: "normal" },
  { fg: "line", bg: "bg", label: "hairline borders (.rule1, .chip border, .sechead) -- decorative dividers, not asserted", kind: "decorative", size: "large" },
  { fg: "warn", bg: "bg2", label: ".notice-err text on the notice's bg2 panel", kind: "text", size: "normal" },
  { fg: "adeep", bg: "bg2", label: ".notice-warn text on the notice's bg2 panel", kind: "text", size: "normal" },
  { fg: "fg", bg: "bg2", label: ".notice-ok text on the notice's bg2 panel", kind: "text", size: "normal" },
];

// score.hot is a special case: white text in light mode, but the dark desk's
// lighter accent (--n-a) forces a swap to dark ink (see the override next to
// `.score.hot` in styles.css) -- checked directly rather than through a
// named desk token pair.
const SCORE_HOT = {
  light: { fg: "#ffffff", bg: light.a },
  dark: { fg: dark.bg, bg: dark.a },
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

// ── node:test: fail the build under 4.5:1 for any "text" token pair ────────

test("every desk text-color token pairing meets WCAG AA in both themes", () => {
  const failures = rows().filter((r) => r.kind === "text" && !r.pass);
  assert.deepEqual(
    failures.map((f) => `${f.theme} ${f.fgHex} on ${f.bgHex} = ${f.ratio.toFixed(2)}:1 (${f.label})`),
    [],
    "these token pairings fail WCAG AA contrast for readable text",
  );
});

test("desk tokens parsed from styles.css are the ones the CSS actually declares", () => {
  // A change to a hex value in styles.css should move this audit's numbers
  // without anyone touching this file -- sanity-check the parse itself.
  assert.equal(light.bg.toLowerCase(), "#f6f1e7");
  assert.equal(dark.bg.toLowerCase(), "#000000");
  assert.equal(dark.mut.toLowerCase(), dark.fg2.toLowerCase());
});
