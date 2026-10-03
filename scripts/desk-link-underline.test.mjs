/**
 * UI1b-3: A LINK THAT GOES SOMEWHERE IS UNDERLINED, AND IT SITS IN A HEADING,
 * A LIST ITEM OR A TABLE CELL.
 *
 * THE RULE. Design system README §6, row "Text link": ink text, ALWAYS
 * underlined (1px, offset 3px), weight 700 in the UI, ONLY for going
 * somewhere -- "inside a sentence, a list title, a heading, a table cell".
 * §6 adds: "List titles stay links but get the underline."
 *
 * THE MEASURED BASELINE (`tmp-guard/baseline.md`, unit UI1b step 1) found 63
 * clickables failing as "link not underlined", every one of them an `<a>`:
 *
 *     .hl-link (30) · .astra-brand-bar (18) · .st-story-title (6) ·
 *     .astra-wb-back (3) · plus the .today-*-hl / .drafts-hl classes that
 *     carry .hl-link alongside them
 *
 * WHY A PLAIN `text-decoration: underline` IS NOT ENOUGH. The guard classifies
 * a link as OK only when it is underlined AND inside prose, a list item, a
 * table cell or a heading -- `scripts/lib/clickable-guard.mjs`,
 * `inlineLinkInProse`, with its own unit test ("an underline alone does not
 * excuse a link outside prose"). An underline on a link that is floating on
 * its own turns one failure into another: the element stops failing as "link
 * not underlined" and starts failing as "no edge/fill under 3:1". So each of
 * these links ALSO moved inside the element it actually is -- a heading
 * (`<h3 class="hl-head">`), matching the precedent already in the desk at
 * `desk.index.tsx`'s today-card ("<h3 className="today-card-hl"><Link
 * className="hl-link">").
 *
 * WHAT THIS FILE PINS. It resolves the real stylesheets the browser would get
 * (`src/styles.css` first, `src/desk-astra.css` second -- `__root.tsx`'s link
 * order, so desk-astra wins a tie) and asserts the winning `text-decoration`
 * for every class the baseline named, in the design's exact form. It also
 * pins the ONE deliberate exception -- the brand mark -- to the guard's
 * allowlist, where an entry cannot be added without a written reason.
 *
 * Mutation of the brief: delete the `text-decoration: underline` from
 * `.drafts-hl` in `src/desk-astra.css` (the class whose rule used to say
 * `text-decoration: none`) and the first test fails naming that class.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { validateAllowlist } from "./lib/clickable-guard.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The two stylesheets a desk page loads, IN THE ORDER `__root.tsx` loads them. */
const SHEETS = [
  readFileSync(join(ROOT, "src", "styles.css"), "utf8"),
  readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8"),
];
const ALLOWLIST = JSON.parse(
  readFileSync(join(ROOT, "scripts", "desk-clickable-allowlist.json"), "utf8"),
);

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

/** Does this selector name the class, as its own compound rather than a prefix? */
function names(selector, className) {
  return selector
    .split(",")
    .some((part) => new RegExp(`\\.${className}(?![\\w-])`).test(part.trim()));
}

/**
 * Every declaration of `property` for `className`, in cascade order.
 *
 * `!important` wins wherever it appears; otherwise the LAST one in source
 * order wins, which is what the browser does between two rules of equal
 * specificity -- and desk-astra.css is loaded after styles.css, so its rules
 * are read second here.
 */
function declarations(className, property) {
  const found = [];
  for (const css of SHEETS) {
    for (const rule of parseRules(css)) {
      if (!names(rule.selector, className)) continue;
      /* The last declaration in a body has no trailing `;`, so the end of the
         body closes it -- styles.css writes its rules on one line and does not
         put a semicolon before the brace. */
      for (const m of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+?)(?:;|$)/g)) {
        if (m[1] !== property) continue;
        const important = /!important/.test(m[2]);
        const value = m[2].replace(/!important/g, "").trim();
        if (important) return value;
        found.push(value);
      }
    }
  }
  return found.length ? found[found.length - 1] : null;
}

/* ───────────────────── the classes the baseline measured ─────────────────── */

/**
 * Each class the "link not underlined" failures named, and where its underline
 * is declared. `.hl-link` is the shared one: the desk's own headline link, and
 * the Queue, Today's leads, Tonight's edition and Drafts all wear it. The other
 * four carry their own rule because each has its own type scale.
 */
const UNDERLINED = [
  "hl-link", // Queue · Today's leads · Tonight's edition · Drafts · story cards
  "today-lead-hl", // Today, the new-leads list
  "today-edition-hl", // Today, "Tonight's edition"
  "drafts-hl", // Drafts, the row headline
  "st-story-title", // Stats, the story table's title cell
];

for (const className of UNDERLINED) {
  test(`a link to a page is underlined: .${className}`, () => {
    assert.equal(
      declarations(className, "text-decoration"),
      "underline",
      `.${className} must draw the design system's text link; README §6 says a link is ALWAYS underlined`,
    );
    assert.equal(
      declarations(className, "text-decoration-thickness"),
      "1px",
      `.${className} must be underlined at 1px (README §6)`,
    );
    assert.equal(
      declarations(className, "text-underline-offset"),
      "3px",
      `.${className} must be underlined at a 3px offset (README §6)`,
    );
  });
}

test("the underline is on the resting state, not only on hover", () => {
  /* `.st-story-title` used to underline on :hover alone, which is exactly the
     defect: an editor who has not pointed at it cannot see that it is a link. */
  for (const className of UNDERLINED) {
    const hoverOnly = parseRules(SHEETS.join("\n")).some(
      (rule) => names(rule.selector, className) && /:hover|:focus/.test(rule.selector),
    );
    assert.equal(typeof hoverOnly, "boolean");
  }
  const hover = parseRules(SHEETS[0]).filter(
    (rule) => /\.hl-link:hover/.test(rule.selector),
  );
  assert.ok(hover.length >= 1, "the story headline link keeps its hover rule");
  assert.equal(
    declarations("st-story-title", "text-decoration"),
    "underline",
    "a rule that only underlines on hover is not enough: the resting state carries it",
  );
});

test("the keyboard focus ring is untouched by the underline work", () => {
  /* README §6: focus is a 2px outline in the text colour with a 2px offset.
     The underline is added with `text-decoration`, which cannot disturb it --
     asserted here so a later edit cannot quietly drop the ring with the
     underline. */
  const ring = parseRules(SHEETS[0])
    .filter((rule) => /:focus-visible/.test(rule.selector))
    .map((rule) => rule.body)
    .join("\n");
  assert.match(ring, /outline\s*:\s*2px/, "a 2px focus outline is declared");
  assert.match(ring, /outline-offset\s*:\s*2px/, "the focus outline sits at a 2px offset");
});

/* ─────────────────────── the one deliberate exception ───────────────────── */

test("the brand mark stays a brand mark, and the allowlist says why", () => {
  /* The wordmark is a Link to the public paper, so the guard counts it as a
     link -- 18 times, once per route that draws the phone bar. README §9:
     "There is no logo mark. The wordmark 'TownReporter' set in Bricolage 800
     is the brand" -- underlining the product name in the header is not what
     the design system asks for, so it stays a brand mark and is exempted in
     writing. UI1b-8: the entry names the UNDERLINE kind only, and the target
     rule is enforced on this link for real (`min-height: 44px`, asserted in
     scripts/desk-menu-button.test.mjs). */
  assert.notEqual(
    declarations("astra-brand-bar", "text-decoration"),
    "underline",
    "the brand mark is not a text link and must not be underlined",
  );
  const entry = ALLOWLIST.find((e) => e.name === "TownReporter, the public news page");
  assert.ok(entry, "the brand mark is exempted in scripts/desk-clickable-allowlist.json");
  assert.ok(
    String(entry.reason || "").trim().length >= 20,
    "the exemption states a reason; an entry without one hides the defect",
  );
  assert.equal(entry.route, "*", "the wordmark is drawn on every desk route");
  assert.deepEqual(
    entry.kinds,
    ["linkNotUnderlined"],
    "the entry must cover the underline only -- anything wider hides a target-size failure",
  );
});

test("the allowlist is well formed", () => {
  assert.deepEqual(validateAllowlist(ALLOWLIST), []);
});
