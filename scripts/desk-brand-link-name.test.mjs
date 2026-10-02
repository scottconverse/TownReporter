/*
  UI1b-8: THE WORDMARK'S NAME NAMES WHERE THE LINK GOES.

  The bot's finding on PR 173: on the phone header the brand link navigates to
  `/` -- the public paper -- and its `title` has always said "Public news page".
  UI1b-5 gave it the accessible name "TownReporter Desk", so a screen-reader
  user heard that the control leads to the desk immediately before it took them
  out to the public paper, and the guard filed the failure under a name that
  said the wrong destination too.

  WHAT IS PINNED, on the source of `src/components/desk-chrome.tsx`:

    - every `<Link to="/">` that carries an `aria-label` names the DESTINATION
      (the public paper / public news page) and contains the visible word
      "TownReporter" -- WCAG 2.5.3, Label in Name, which wants the spoken name
      to contain the text written on the control;
    - no `<Link to="/">` has an `aria-label` that says "Desk": a link that
      leaves the desk must not be named after the desk;
    - the guard's allowlist entry still names what the guard reads, because the
      entry matches on the accessible name and a rename that forgets it turns
      the one written exception into a stale entry (the walk then fails).

  THE DESK'S OWN BRAND LINK `.astra-brand` in the nav rail is a DIFFERENT
  element and is NOT covered by the rule above: its drawn tag reads
  "TownReporter / Editor's desk", it carries no `aria-label` (so it keeps its
  visible name), and the walk skips `.astra-sidebar` entirely. It is left as
  the designer drew it.

  Mutation: change the phone link's `aria-label` back to "TownReporter Desk"
  and the first test fails naming the link; delete `min-height: 44px` from
  `.astra-brand-bar` and scripts/desk-menu-button.test.mjs fails instead.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = readFileSync(join(ROOT, "src", "components", "desk-chrome.tsx"), "utf8");
const ALLOWLIST = JSON.parse(
  readFileSync(join(ROOT, "scripts", "desk-clickable-allowlist.json"), "utf8"),
);

/** Every `<Link ...>...</Link>` block whose opening tag is asked for. */
function linksTo(path) {
  const blocks = [];
  const re = /<Link\b([^>]*)>([\s\S]*?)<\/Link>/g;
  let match;
  while ((match = re.exec(CHROME))) {
    const attrs = match[1];
    if (!new RegExp(`to=["']${path.replace(/[/$]/g, "\\$&")}["']`).test(attrs)) continue;
    blocks.push({ attrs, body: match[2], at: match.index });
  }
  return blocks;
}

const ariaLabel = (attrs) => (attrs.match(/aria-label="([^"]*)"/) ?? [])[1] ?? null;
const title = (attrs) => (attrs.match(/title="([^"]*)"/) ?? [])[1] ?? null;
const className = (attrs) => (attrs.match(/className="([^"]*)"/) ?? [])[1] ?? "";

test("a brand link that leaves for the paper is named for the paper", () => {
  const leaving = linksTo("/").filter((l) => className(l.attrs).includes("astra-brand"));
  assert.ok(leaving.length >= 1, "the wordmark link to / is gone from desk-chrome.tsx");

  const named = leaving.filter((l) => ariaLabel(l.attrs));
  assert.ok(named.length >= 1, "the phone wordmark has no accessible name of its own");

  for (const link of named) {
    const name = ariaLabel(link.attrs);
    assert.match(name, /TownReporter/, `"${name}" does not contain the visible word (WCAG 2.5.3)`);
    assert.match(
      name,
      /public (news page|paper)/i,
      `"${name}" does not name the destination, which is the public paper`,
    );
    assert.doesNotMatch(name, /\bDesk\b/i, `"${name}" names the desk on a link that leaves it`);

    /* The name and the `title` a sighted mouse user reads say the same thing. */
    const said = title(link.attrs);
    assert.ok(said, "the wordmark needs its title");
    assert.match(said, /public (news page|paper)/i, `title "${said}" does not name the destination`);
  }
});

test("no link to / is named after the desk", () => {
  for (const link of linksTo("/")) {
    const name = ariaLabel(link.attrs);
    if (!name) continue;
    assert.doesNotMatch(
      name,
      /\bDesk\b/i,
      `a link to / says "${name}" -- it goes to the public paper, not the desk`,
    );
  }
});

test("the guard's allowlist entry names the control the guard now reads", () => {
  const wordmark = linksTo("/").find((l) => className(l.attrs).includes("astra-brand-bar"));
  assert.ok(wordmark, "the phone wordmark link is gone");
  const name = ariaLabel(wordmark.attrs);
  const entry = ALLOWLIST.find((e) => e.name === name);
  assert.ok(
    entry,
    `no allowlist entry is named "${name}": the one written exception is now stale and the walk fails`,
  );
});
