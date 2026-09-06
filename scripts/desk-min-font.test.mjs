import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * 14px floor guard (owner audit, 2026-09-05; widened 2026-09-06 after two
 * staging misses on 0.6.20).
 *
 * Every informational text on the desk must be at least 14px at Normal text
 * size. Two rounds of gaps so far:
 *
 *   Round 1: kickers, chips, field labels, nav items, segmented options and
 *   several others rendered at 13px (calc(0.8125rem * var(--ts))), and
 *   Server/Stats used raw Tailwind text-xs / text-[11px] / text-[12px] /
 *   text-[13px] utilities that resolve below the floor.
 *
 *   Round 2: `.leave-editor` / `.leave-ask` / `.leave-yes` / `.leave-no`
 *   ("Give up the desk", src/components/desk-chrome.tsx's
 *   LeaveEditorControl) rendered at a flat 12px -- missed by round 1's CSS
 *   parser because it only recognized a selector and its `font-size:`
 *   declaration when BOTH sat on the same source line. These three rules
 *   are written across multiple lines, so the line-oriented scan walked
 *   straight past them. The parser below is brace-depth-aware instead: it
 *   reads the whole file as a token stream, accumulates each rule's full
 *   declaration body (however many lines it spans) before checking it, and
 *   a fixture test pins that multi-line behavior directly so this gap
 *   cannot reopen silently.
 *
 * Three checks:
 *
 *   1. Parse every rule in styles.css whose selector contains ".desk-ltr"
 *      (including ones nested inside @media blocks) and fail on any
 *      font-size that resolves to less than 14px at --ts: 1 -- unless the
 *      declaration carries an explicit "decorative" comment marking it
 *      exempt (there should be none needed).
 *   2. The selectors this pass scaled for Text: Large all read --ts.
 *   3. Desk-rendered .tsx files (see FILE_GLOBS below) do not use the
 *      banned sub-14px Tailwind utilities, and do not hardcode a bare
 *      10-13px font-size or a text-[10..13px] utility as a string. Scoped
 *      to files that actually render inside .desk-ltr: every desk
 *      route/component (desk*.tsx anywhere under src/), plus
 *      src/lib/**\/*.tsx (desk-only view helpers can live under lib/).
 *      Shared components also rendered on the public paper (states.tsx,
 *      model-picker.tsx) are intentionally NOT swept -- editing them would
 *      also change the public paper's type scale, which is out of scope.
 *      Those get the floor through the .desk-ltr .text-xs / .text-[11px] /
 *      .text-[12px] selector overrides in styles.css instead (the same
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
 * Strip block comments, then walk the file character by character, tracking
 * brace nesting. At the point a "{" is hit, everything since the previous
 * rule's close is the selector text (however many lines it spanned); its
 * matching "}" is found by depth-counting from there, so the rule's full
 * body (however many lines IT spans) is captured as one string. An
 * @media prelude is recognized by its selector text starting with "@media"
 * and its body is recursed into for the rules nested inside it, with line
 * numbers adjusted to stay accurate against the original file.
 */
function parseRules(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules = [];
  let i = 0;
  const n = noComments.length;
  let pendingSelectorStart = 0;
  const lineOf = (idx) => noComments.slice(0, idx).split("\n").length;
  while (i < n) {
    const ch = noComments[i];
    if (ch === "{") {
      const selectorText = noComments.slice(pendingSelectorStart, i).trim();
      const bodyStart = i + 1;
      let d = 1;
      let j = bodyStart;
      while (j < n && d > 0) {
        if (noComments[j] === "{") d++;
        else if (noComments[j] === "}") d--;
        j++;
      }
      const bodyEnd = j - 1; // index of the matching "}"
      const body = noComments.slice(bodyStart, bodyEnd);
      if (/^@media/.test(selectorText)) {
        for (const inner of parseRules(body)) {
          rules.push({ ...inner, line: inner.line + lineOf(bodyStart) - 1 });
        }
      } else if (selectorText.length > 0) {
        rules.push({ selector: selectorText, body, line: lineOf(i) });
      }
      i = bodyEnd + 1;
      pendingSelectorStart = i;
      continue;
    }
    if (ch === "}") {
      // A stray close shouldn't happen given the matching walk above, but
      // stay defensive and resync rather than mis-attribute later text.
      pendingSelectorStart = i + 1;
    }
    i++;
  }
  return rules;
}

/** Every .desk-ltr rule (top-level or nested in @media) with a font-size. */
function deskFontSizeDeclarations(css) {
  const out = [];
  for (const rule of parseRules(css)) {
    if (!rule.selector.includes(".desk-ltr")) continue;
    const fsMatch = rule.body.match(/font-size:\s*([^;]+?)\s*(?:;|$)/);
    if (!fsMatch) continue;
    if (/decorative/.test(rule.body)) continue;
    out.push({ selector: rule.selector, line: rule.line, fontSize: fsMatch[1].trim() });
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

test("the brace-depth-aware CSS parser catches a font-size that spans multiple lines (the exact shape that let .leave-editor through round 1)", () => {
  const fixture = [
    "",
    ".desk-ltr .totally-fine { font-size: calc(0.875rem * var(--ts)); }",
    ".desk-ltr .multiline-offender {",
    "  display: inline-flex;",
    "  font-size:12px;",
    "  color: var(--mut);",
    "}",
    "@media (max-width: 720px) {",
    "  .desk-ltr .nested-multiline-offender {",
    "    padding: 0 12px;",
    "    font-size:11px;",
    "    cursor: pointer;",
    "  }",
    "}",
    "",
  ].join("\n");
  const decls = deskFontSizeDeclarations(fixture);
  const bySelector = Object.fromEntries(decls.map((d) => [d.selector, d.fontSize]));
  assert.equal(bySelector[".desk-ltr .totally-fine"], "calc(0.875rem * var(--ts))");
  assert.equal(bySelector[".desk-ltr .multiline-offender"], "12px");
  assert.equal(bySelector[".desk-ltr .nested-multiline-offender"], "11px");
  const failures = decls.map((d) => ({ ...d, px: pxOf(d.fontSize) })).filter((d) => d.px < FLOOR_PX);
  assert.equal(failures.length, 2, "both the top-level and @media-nested multiline offenders must be caught");
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

// Widened 2026-09-06: originally only src/routes/desk*.tsx and
// src/components/desk*.tsx. "Give up the desk" lives in
// src/components/desk-chrome.tsx's LeaveEditorControl -- a desk*.tsx file,
// so that specific miss wasn't a glob gap -- but the glob was still too
// narrow in general (a desk-only helper under src/lib/**, or a desk route
// file that doesn't happen to start with "desk", would have slipped past
// it the same way). Cover every desk*.tsx anywhere under src/, plus
// src/lib/**/*.tsx, which is where desk-only view helpers can live.
const FILE_GLOBS = ["src/**/desk*.tsx", "src/lib/**/*.tsx"];
/*
 * src/lib/error-component.tsx (AppErrorComponent / AppNotFound) matches the
 * src/lib glob but is NOT desk-scoped: it's wired as the router's
 * defaultErrorComponent / defaultNotFoundComponent in src/router.tsx, so it
 * replaces the whole page -- including on the public paper -- and never
 * renders inside .desk-ltr. Its text-[11px] is the paper's own type scale,
 * not the desk's; changing it would touch the public paper's styles, which
 * is out of scope for the desk audit this test guards. Excluded rather
 * than fixed.
 */
const NOT_DESK_SCOPED = new Set(["src/lib/error-component.tsx"]);
const BANNED_UTILITIES = [/\btext-xs\b/, /text-\[1[0-3]px\]/, /font-size:\s*1[0-3]px\b/];

test("desk-rendered files do not hardcode a sub-14px font-size or use a banned sub-14px Tailwind text utility", () => {
  const seen = new Set();
  const files = [];
  for (const pattern of FILE_GLOBS) {
    for (const rel of globSync(pattern, { cwd: ROOT })) {
      const normalized = rel.split("\\").join("/");
      if (NOT_DESK_SCOPED.has(normalized)) continue;
      if (!seen.has(rel)) {
        seen.add(rel);
        files.push(rel);
      }
    }
  }
  assert.ok(files.length > 5, "sanity check: expected to find several desk route/component/lib files");
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
  assert.deepEqual(
    offenders,
    [],
    "these desk files hardcode a sub-14px size or use a banned Tailwind size utility -- use text-sm/14px (or the desk CSS class) instead",
  );
});

// Staging finding, 0.6.20 -> 0.6.21: Kill (tone="quiet-danger" on InkButton,
// desk-leads.tsx) rendered as class="btn quiet danger small". `.btn.quiet`
// (border-color: transparent) and `.btn.danger` (border-color: var(--warn))
// are equal specificity, and the built stylesheet let `.btn.quiet` win --
// Kill showed no warn signal at all, a fully transparent border. The fix
// adds a combined `.btn.quiet.danger` selector, which has strictly higher
// specificity and wins the tie regardless of declaration order. This
// parses styles.css with the same brace-depth-aware rule parser used above
// and asserts that combined selector exists with a real warn border, so a
// future edit that drops or renames it fails loudly instead of quietly
// reintroducing the invisible-border bug.
test(".btn.quiet.danger (Kill) resolves a real, non-transparent warn border regardless of declaration order", () => {
  const css = readFileSync(CSS_PATH, "utf8");
  const rules = parseRules(css);
  const rule = rules.find(
    (r) => r.selector.split(",").map((s) => s.trim()).includes(".desk-ltr .btn.quiet.danger"),
  );
  assert.ok(rule, "expected a .desk-ltr .btn.quiet.danger rule (it may share a selector list with .btn.danger)");
  assert.match(
    rule.body.replace(/\s+/g, ""),
    /border-color:var\(--warn\)/,
    "the combined .btn.quiet.danger selector must set border-color: var(--warn) so it always wins the tie with .btn.quiet's transparent border",
  );
  assert.match(
    rule.body.replace(/\s+/g, ""),
    /color:var\(--warn\)/,
    "the combined .btn.quiet.danger selector must also set the warn text color",
  );
});
