import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME = readFileSync(join(ROOT, "src", "components", "desk-chrome.tsx"), "utf8");

test("the phone wordmark link to the public paper is named for the paper, not the desk", () => {
  /* Bug caught: the link to / was named "TownReporter Desk", so a screen reader announced the
     desk just before the link took the reader out to the public paper (WCAG 2.5.3 label in name). */
  const names = [...CHROME.matchAll(/<Link\b([^>]*)>/g)]
    .filter((m) => /to=["']\/["']/.test(m[1]))
    .map((m) => (m[1].match(/aria-label="([^"]*)"/) ?? [])[1])
    .filter(Boolean);
  assert.ok(names.length >= 1, "the wordmark link to / has no accessible name of its own");
  for (const name of names) {
    assert.match(name, /TownReporter/, `"${name}" does not contain the visible word`);
    assert.match(name, /public (news page|paper)/i, `"${name}" does not name the destination`);
    assert.doesNotMatch(name, /\bDesk\b/i, `"${name}" names the desk on a link that leaves it`);
  }
});
