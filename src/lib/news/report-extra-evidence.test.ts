import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boundedExtraEvidence } from "./report.ts";

describe("draft extra-evidence prompt budget", () => {
  it("keeps ordinary editor notes at the existing 4,000-character default", () => {
    const text = "x".repeat(8_000);
    assert.equal(boundedExtraEvidence(text).length, 4_000);
  });

  it("lets meeting drafts carry a much larger aligned transcript block", () => {
    const laterItemFact = "LATER-ITEM-FACT";
    const text = `${"x".repeat(30_000)}${laterItemFact}`;
    const bounded = boundedExtraEvidence(text, 200_000);
    assert.equal(bounded.length, text.length);
    assert.match(bounded, /LATER-ITEM-FACT/);
  });

  it("never allows an unbounded prompt even when a caller asks for one", () => {
    assert.equal(boundedExtraEvidence("x".repeat(250_000), Number.MAX_SAFE_INTEGER).length, 200_000);
    assert.equal(boundedExtraEvidence("evidence", -1), "");
  });
});
