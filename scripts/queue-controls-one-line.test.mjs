import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/* The Queue's controls bar (tabs, search, two selects) must fit its column at 1280 in Large text.
   desk-uiux-walk catches the overlap too, but only in CI after a push; this is the fast local check. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "src", "desk-astra.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const RULES = [];
(function scan(text, media) {
  for (let i = 0; i < text.length; ) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
    }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith("@")) scan(body, head.startsWith("@media") ? head : media);
    else RULES.push({ media, head, body });
    i = j;
  }
})(SRC, null);

const Q = ".desk-ltr.astra";
/** The BAND is the @media that covers 1280 through 1339+ (where the bar is tightest). */
const BAND = RULES.map((r) => r.media).find((m) => {
  const min = Number((m?.match(/min-width:\s*(\d+)px/) ?? [])[1]);
  const max = Number((m?.match(/max-width:\s*(\d+)px/) ?? [])[1]);
  return min <= 1280 && max >= 1340;
});
const declared = (head, prop, media) =>
  RULES.filter((r) => r.head === head && r.media === (media ?? null))
    .map((r) => (r.body.match(new RegExp("(?:^|;)\\s*" + prop + "\\s*:([^;]+)")) ?? [])[1]?.trim())
    .filter(Boolean)
    .at(-1);

test("at 1280 in Large text the Queue's one-line controls bar fits its column with room to spare", () => {
  /* Bug caught: the bar needed more than its 970px column, so the search field overlapped the tab strip
     (an overlap, not a wrap: .queue-filters is justify-content: flex-end). CI failed on PR 173 with it. */
  assert.ok(BAND, "no @media band compacts the bar between 1280 and 1340");
  const px = (head, prop) => Number.parseFloat(declared(head, prop, BAND)) || 0;
  const tabPad = px(`${Q} .queue-controls .queue-tabs > button`, "padding-inline");
  const selectInset = Number.parseFloat((declared(`${Q} .queue-sel select`, "padding") ?? "0").split(/\s+/).pop()) || 0;
  /* Measured on the desk desk-uiux-walk seeds, 1280x1000, Large text: column 970; five tab labels 337.02 + 6 edges;
     the two select wrappers 184.58 and 230.03 with no inset (2.5px of width per 1px of inset); search floor 100. */
  const strip = 337.02 + 6 + 5 * 2 * tabPad;
  const wrappers = [184.58, 230.03].map((w) => w + selectInset * 2.5);
  const total = strip + px(`${Q} .queue-controls`, "gap") + 100 + px(`${Q} .queue-filters`, "gap") * 2 + wrappers[0] + wrappers[1];
  const slack = 970 - total;
  assert.ok(slack >= 15, `the bar needs ${total.toFixed(1)}px of a 970px column: ${slack.toFixed(1)}px spare`);
});
