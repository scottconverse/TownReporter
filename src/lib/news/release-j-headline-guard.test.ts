/*
  RELEASE J, item PR298-2 (Scott, Oct 14 2026).

  The headline cleanup in `cleanMissingFactNotes` drops a sentence that reports
  a missing fact -- "The notice does not state the year." On a headline made of
  nothing else, the whole headline went with it and the story printed with no
  headline at all. Measured Oct 13 2026 against all 157 live stories: 0 would
  be emptied, so this is a guard rather than a repair. A headline is not
  optional on a page, and an editor check the reader cannot see is a better
  trade than a missing title.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMissingFactNotes } from "./strip-draft.ts";

const MISSING_FACT_HEADLINE = "The notice does not state the year";

test("a headline that is only a missing-fact note prints as written", () => {
  const cleaned = cleanMissingFactNotes(MISSING_FACT_HEADLINE, "A roundup of the week.");
  assert.equal(cleaned.headline, MISSING_FACT_HEADLINE);
});

test("a headline left as punctuation prints as written", () => {
  const cleaned = cleanMissingFactNotes(
    "The schedule is unstated. The location is unstated.",
    "",
  );
  assert.equal(cleaned.headline, "The schedule is unstated. The location is unstated.");
});

/* The guard must not change the ordinary case it was built around. */
test("a real headline with a missing-fact sentence at its end is still cleaned", () => {
  const cleaned = cleanMissingFactNotes(
    "Council sets the levy. The notice does not state the year.",
    "",
  );
  assert.equal(cleaned.headline, "Council sets the levy");
  assert.equal(cleaned.notes.length, 1);
});

test("a headline with no missing-fact note is returned unchanged", () => {
  const headline = "Council approves the budget";
  assert.equal(cleanMissingFactNotes(headline, "").headline, headline);
});
