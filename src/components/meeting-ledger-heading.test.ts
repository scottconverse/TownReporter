import assert from "node:assert/strict";
import { test } from "node:test";
import { editorNotesSentence, ledgerHeading } from "./meeting-ledger-heading.ts";

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

/*
  UX-5: the sentence above the editor file. A news draft has no ledger rows, so
  naming one there promises the editor something that is not in the file.
*/
test("a meeting draft's notes sentence names the ledger, exactly as before", () => {
  assert.equal(
    editorNotesSentence(true),
    "The writer's own file: the claim checks, the fact sheet, the ledger and the legal notes. None of this is part of the story.",
  );
});

test("a news draft's notes sentence does not name a ledger", () => {
  const sentence = editorNotesSentence(false);
  assert.equal(sentence.includes("ledger"), false);
  assert.equal(
    sentence,
    "The writer's own file: the claim checks, the fact sheet and the legal notes. None of this is part of the story.",
  );
});
