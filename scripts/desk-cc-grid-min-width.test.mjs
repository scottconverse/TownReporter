import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Direction A stage-1 fix: horizontal scroll at 762/390 traced to the desk
 * nav overflowing (see the CSS docstring on .deskname/.nav-dark), not the
 * Command Center grid itself -- but every direct child of `.desk-cc-grid`
 * (the queue, Dark Desk, Follow-ups, the wire) still needs `min-width: 0`
 * so a long unbroken run of text inside one of them can never force the
 * grid track wider than its column, which is the classic CSS grid overflow
 * trap (a grid item's default `min-width` is `auto`, i.e. its content's
 * intrinsic width, not 0). This is a static assertion rather than a real
 * browser measurement -- it catches the "someone deleted the rule" case,
 * not every possible new overflow source.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");

test("every .desk-cc-grid child area (.gc-*) declares min-width:0", () => {
  const areas = ["gc-queue", "gc-darkdesk", "gc-followups", "gc-wire"];
  for (const area of areas) {
    const re = new RegExp(`\\.desk-ltr \\.${area} \\{([^}]*)\\}`);
    const m = css.match(re);
    assert.ok(m, `expected a .desk-ltr .${area} rule in styles.css`);
    assert.match(m[1], /min-width:\s*0\b/, `.${area} must declare min-width:0`);
  }
});

test(".composer (the Write-a-story section) also declares min-width:0", () => {
  const m = css.match(/\.desk-ltr \.composer \{([^}]*)\}/);
  assert.ok(m, "expected a .desk-ltr .composer rule in styles.css");
  assert.match(m[1], /min-width:\s*0\b/);
});

test("the desk nav row (.deskname) wraps instead of forcing horizontal overflow, and .nav-dark never breaks across two lines", () => {
  const deskname = css.match(/\.desk-ltr \.deskname \{([^}]*)\}/);
  assert.ok(deskname, "expected a base .desk-ltr .deskname rule");
  assert.match(
    deskname[1],
    /flex-wrap:\s*wrap\b/,
    ".deskname must wrap onto a second row rather than overflow the viewport width",
  );
  const navDark = css.match(/\.desk-ltr \.nav-dark \{([^}]*)\}/);
  assert.ok(navDark, "expected a base .desk-ltr .nav-dark rule");
  assert.match(navDark[1], /white-space:\s*nowrap\b/, ".nav-dark ('Dark Desk') must never wrap across two lines");
});
