import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * 14px floor guard (owner audit, 2026-09-05).
 *
 * Every informational text on the desk must be at least 14px at Normal text
 * size. Before this pass, kickers, chips, field labels, nav items,
 * segmented options and several others rendered at 13px
 * (calc(0.8125rem * var(--ts))), and Server/Stats used raw Tailwind
 * text-xs / text-[11px] / text-[12px] / text-[13px] utilities that resolve
 * below the floor. Two checks:
 *
 *   1. Parse every declaration inside the `.desk-ltr` scope (including
 *      nested @media blocks) and fail on any font-size that resolves to
 *      less than 14px at --ts: 1 -- unless the line carries an explicit
 *      `/* decorative *\/` comment marking it as exempt (there should be
 *      none needed; see the punch list this test was written against).
 *   2. Grep the desk's own routes/components (files named desk*.tsx) for
 *      the banned Tailwind size utilities. Shared components rendered on
 *      both the desk and the public paper (states.tsx, model-picker.tsx)
 *      are intentionally NOT swept here -- editing them would also change
 *      the public paper's type scale, which is out of scope. Those get the
 *      same floor through the `.desk-ltr .text-xs` / `.text-\[11px\]` /
 *      `.text-\[12px\]` selector overrides in styles.css instead (same
 *      pattern already used there for color utilities).
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS_PATH = join(ROOT, "src", "styles.css");
const FLOOR_PX = 14;

function pxOf(value) {
  const rem = value.match(/^calc\(\s*([\d.]+)rem\s*\*\s*var\(--ts\)\s*\)$/);
  if (rem) return parseFloat(rem[1]) * 16;
  const remPlain = value.match(/^([\d.]+)rem$/);
  if (remPlain) return parseFloat(remPlain[1]) * 16;
  const px = value.match(/^([\d.]+)px$/);
  if (px) return parseFloat(px[1]);
  return null; // inherit / unresolved -- not this test's concern
}

/**
 * Extract every `selector { ...declarations... }` block whose selector text
 * contains ".desk-ltr", including ones nested one level inside an
 * `@media (...) { ... }` block (this file's mobile breakpoints). Returns
 * `{ selector, line, fontSize, raw }` for every block that declares a
 * font-size.
 */
function deskFontSizeDeclarations(css) {
  const lines = css.split("\n");
  const out = [];
  let braceDepth = 0; // 0 = top level, 1 = inside an @media block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^@media/.test(trimmed)) {
      braceDepth = 1;
      continue;
    }
    if (trimmed === "}" && braceDepth === 1) {
      // Could be closing a rule inside the media block or the media block
      // itself; a rule line always contains "{" earlier on its own line in
      // this file's formatting, so a bare "}" line closes the @media block.
      braceDepth = 0;
      continue;
    }
    if (!trimmed.includes(".desk-ltr")) continue;
    if (!trimmed.includes("{")) continue;
    const selector = trimmed.slice(0, trimmed.indexOf("{")).trim();
    if (!selector.includes(".desk-ltr")) continue;
    const fsMatch = trimmed.match(/font-size:\s*([^;}]+)[;}]/);
    if (!fsMatch) continue;
    if (/\/\*\s*decorative\s*\*\//.test(line)) continue;
    out.push({ selector, line: i + 1, fontSize: fsMatch[1].trim(), raw: trimmed });
  }
  return out;
}

test("no .desk-ltr rule resolves a font-size below the 14px informational floor", () => {
  const css = readFileSync(CSS_PATH, "utf8");
  const decls = deskFontSizeDeclarations(css);
  assert.ok(decls.length > 20, "sanity check: expected many .desk-ltr font-size declarations to be found");
  const failures = decls
    .map((d) => ({ ...d, px: pxOf(d.fontSize) }))
    .filter((d) => d.px !== null && d.px < FLOOR_PX);
  assert.deepEqual(
    failures.map((f) => `styles.css:${f.line} ${f.selector} -> ${f.fontSize} (${f.px}px)`),
    [],
    "these .desk-ltr rules resolve below the 14px floor at Normal text size",
  );
});

const SCALED_SELECTORS = [
  ".h1",
  ".sec-title",
  ".hl-link",
  ".np-title",
  ".pipe-v",
  ".of-title",
  ".worth-t",
  ".read-doc-title",
  ".read-full",
  ".art-body",
  ".feat-body",
];

test("Large text reaches headline and reading-pane type: the listed selectors scale with --ts", () => {
  const css = readFileSync(CSS_PATH, "utf8");
  const decls = deskFontSizeDeclarations(css);
  for (const sel of SCALED_SELECTORS) {
    const rule = decls.find((d) => d.selector === `.desk-ltr ${sel}`);
    assert.ok(rule, `expected a .desk-ltr ${sel} font-size declaration`);
    assert.match(
      rule.fontSize,
      /var\(--ts\)/,
      `.desk-ltr ${sel} font-size (${rule.fontSize}) should read the --ts scale so Text: Large actually enlarges it`,
    );
  }
});

const BANNED_UTILITIES = [/\btext-xs\b/, /text-\[11px\]/, /text-\[12px\]/, /text-\[13px\]/];

test("desk-owned routes/components (desk*.tsx) do not use sub-14px Tailwind text utilities", () => {
  const files = [
    ...globSync("src/routes/desk*.tsx", { cwd: ROOT }),
    ...globSync("src/components/desk*.tsx", { cwd: ROOT }),
  ];
  assert.ok(files.length > 5, "sanity check: expected to find several desk route/component files");
  const offenders = [];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      for (const re of BANNED_UTILITIES) {
        if (re.test(line)) offenders.push(`${rel}:${idx + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "these desk files use a banned sub-14px Tailwind size utility -- use text-sm or a desk CSS class instead");
});
