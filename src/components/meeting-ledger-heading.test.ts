import assert from "node:assert/strict";
import { test } from "node:test";
import { ledgerHeading } from "./meeting-ledger-heading.ts";

/*
  D234 point 5: THE ONE WORD ON SCREEN THAT CHANGES.

  The report-local-news skill now writes news leads too, and their editor file
  lands in the columns the Meeting ledger panel reads -- so the panel draws for
  a draft that is not a meeting's. The heading is the only thing that says so:
  a meeting draft keeps its words exactly, a news draft is the writer's notes
  and has no items to count.
*/

test("a meeting draft still says Meeting ledger", () => {
  assert.equal(ledgerHeading(true), "Meeting ledger");
});

test("a draft that is not a meeting says Writer's notes", () => {
  assert.equal(ledgerHeading(false), "Writer's notes");
});
