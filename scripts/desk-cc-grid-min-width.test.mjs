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

test(".model-picker and its select collapse to 0 rather than winning on intrinsic content width", () => {
  const picker = css.match(/\.desk-ltr \.model-picker \{([^}]*)\}/);
  assert.ok(picker, "expected a base .desk-ltr .model-picker rule");
  assert.match(picker[1], /min-width:\s*0\b/, ".model-picker must declare min-width:0");
  assert.match(picker[1], /max-width:\s*100%/, ".model-picker must not cap itself with a fixed max-width");
  const select = css.match(/\.desk-ltr \.model-picker select \{([^}]*)\}/);
  assert.ok(select, "expected a .desk-ltr .model-picker select rule");
  assert.match(select[1], /min-width:\s*0\b/, ".model-picker select must declare min-width:0");
  assert.match(select[1], /width:\s*100%/, ".model-picker select must declare width:100%");
  const narrow = [...css.matchAll(/@media \(max-width:\s*720px\)\s*\{([^}]*model-picker[^}]*\{[^}]*\}[^}]*)\}/g)];
  assert.ok(narrow.length > 0, "expected a max-width:720px rule collapsing .model-picker to one column");
  assert.match(narrow[0][1], /grid-template-columns:\s*1fr/, "narrow .model-picker must collapse to a single column");
});

test(".model-picker-help spans the full row so it never renders as a cramped narrow column", () => {
  const help = css.match(/\.desk-ltr \.model-picker-help \{([^}]*)\}/);
  assert.ok(help, "expected a base .desk-ltr .model-picker-help rule");
  assert.match(help[1], /grid-column:\s*1\s*\/\s*-1/, ".model-picker-help must span grid-column:1 / -1");
});

test(".wire-proposed lays out as a column so Accept/Drop always sit together on their own line under the title", () => {
  const wp = css.match(/\.desk-ltr \.wire-proposed \{([^}]*)\}/);
  assert.ok(wp, "expected a base .desk-ltr .wire-proposed rule");
  assert.match(wp[1], /display:\s*flex/, ".wire-proposed must be a flex container");
  assert.match(wp[1], /flex-direction:\s*column/, ".wire-proposed must stack its title and actions rows");
});

test(".nav-toggle (the mobile Menu button) is at least 40px tall", () => {
  const toggle = css.match(/\.desk-ltr \.nav-toggle \{([^}]*)\}/);
  assert.ok(toggle, "expected a base .desk-ltr .nav-toggle rule");
  assert.match(toggle[1], /min-height:\s*40px/, ".nav-toggle must declare min-height:40px");
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
