import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  FB7, item 4 -- the U30 note.

  Opinion rendered its own running editorial with `DeskJobCard compact`, and
  the compact card is defined by the one thing it drops: the stage chip row
  (`JobCard.tsx`: `!compact && job.stages`). So the screen that had the most
  to say about a long job said the least about it -- no chips, no percent, no
  bar. Drafts had already been fixed the same way (FB6 item 6); this pins
  Opinion to the same shape so the two cannot drift apart again.

  A source pin, for the reason `scan-card-placement.test.ts` gives: the route
  is a component needing a router and a session, and what broke is a property
  of the tree.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

describe("Opinion draws the full job card, like Drafts", () => {
  it("does not pass `compact` to the card for a running editorial", () => {
    const source = read("../../routes/desk.opinion.tsx");
    assert.match(
      source,
      /<DeskJobCard job=\{r\.job\} \/>/,
      "the running row's card is drawn at full size, so the stage chips are visible",
    );
    assert.doesNotMatch(
      source,
      /<DeskJobCard job=\{r\.job\} compact \/>/,
      "the compact card hides the chips this item exists to show",
    );
  });

  it("matches what Drafts does with the same card", () => {
    const drafts = read("../../routes/desk.drafts.tsx");
    assert.match(drafts, /<DeskJobCard\b[\s\S]{0,120}?job=\{liveJob\}/, "Drafts draws the drawn card");
    assert.doesNotMatch(
      drafts,
      /<DeskJobCard[\s\S]{0,80}?job=\{liveJob\}[\s\S]{0,40}?compact/,
      "and it does not pass `compact` either -- the two screens agree",
    );
  });

  it("still keeps its non-card fallback for a row the job query has not answered", () => {
    // The fix is about the card, not about removing the honest stand-in for
    // the first poll: `Busy` says what the run row already knows.
    const source = read("../../routes/desk.opinion.tsx");
    assert.match(source, /<Busy label=\{r\.stage \|\| "Working…"\} \/>/);
  });
});
