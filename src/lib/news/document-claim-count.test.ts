import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordedDraftClaimCount } from "./finding-evidence-review.ts";
import { nameCheckText } from "./name-check.ts";
import type { DraftRow } from "./types.ts";

/*
  FC23 (Oct 11 walk): an OCR story's Checks said "No claims were recorded /
  nothing has been checked" while the draft listed five claims with verified
  passages from the uploaded PDF.
*/
describe("FC23: claims checked against uploaded documents count as recorded", () => {
  const text = { headline: "Records show the clear record", dek: "", body: "The record 7319 is clear." };
  const draft = (checkedText: string) => ({
    id: 1, lead_id: 1, ...text, found_note: null,
    research_json: JSON.stringify({ reportedDocumentClaims: { version: 1, checkedText, rows: [
      { fact: "Record 7319 is clear", kind: "record", filename: "a.pdf", locator: "page 1", excerpt: "CLEAR RECORD 7319" },
    ] } }),
  }) as unknown as DraftRow;
  it("counts them for the text they were checked on", () => {
    assert.equal(recordedDraftClaimCount(draft(nameCheckText(text))), 1);
  });
  it("does not count them after the text changed", () => {
    assert.equal(recordedDraftClaimCount(draft("older words")), 0);
  });
});
