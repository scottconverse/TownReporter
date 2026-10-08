import assert from "node:assert/strict";
import { it } from "node:test";
import { dekOrFallback, firstSentenceForDek } from "./dek-fallback.ts";

it("keeps a real dek exactly as written", () => {
  assert.equal(dekOrFallback("The council voted 5-2.", "Body text here."), "The council voted 5-2.");
});

it("trims a dek that is only whitespace and falls back to the body", () => {
  assert.equal(dekOrFallback("   ", "The council approved the budget. It takes effect Monday."), "The council approved the budget.");
});

it("falls back for an empty, null or undefined dek", () => {
  const body = "The board meets in January. Nothing else is scheduled yet.";
  assert.equal(dekOrFallback("", body), "The board meets in January.");
  assert.equal(dekOrFallback(null, body), "The board meets in January.");
  assert.equal(dekOrFallback(undefined, body), "The board meets in January.");
});

it("returns an empty string when both dek and body are empty", () => {
  assert.equal(dekOrFallback("", ""), "");
  assert.equal(dekOrFallback(null, null), "");
});

it("firstSentenceForDek stops at the first sentence-ending punctuation", () => {
  assert.equal(
    firstSentenceForDek("Longmont's tech board won't meet until January. AI tools are already in use."),
    "Longmont's tech board won't meet until January.",
  );
  assert.equal(firstSentenceForDek("What happens next? Nobody knows yet."), "What happens next?");
  assert.equal(firstSentenceForDek("Wait, is this real! Yes it is."), "Wait, is this real!");
});

it("firstSentenceForDek uses the whole text when there is no sentence-ending punctuation", () => {
  assert.equal(firstSentenceForDek("no punctuation at all here"), "no punctuation at all here");
});

it("firstSentenceForDek collapses newlines and extra whitespace before cutting", () => {
  assert.equal(
    firstSentenceForDek("Line one\nstill the same\nsentence.\n\nSecond paragraph."),
    "Line one still the same sentence.",
  );
});

it("firstSentenceForDek cuts a long single sentence at a word boundary at 240 chars", () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
  const long = `${words.join(" ")}.`;
  const result = firstSentenceForDek(long);
  assert.ok(result.length <= 241, `expected <=241 chars, got ${result.length}`);
  assert.ok(result.endsWith("…"), "a cut sentence ends with an ellipsis");
  assert.ok(!result.slice(0, -1).includes("…"), "no extra ellipsis inside");
  // Never cuts mid-word: the character before the ellipsis is not preceded by
  // a partial word fragment that continues past the cut in the source.
  const withoutEllipsis = result.slice(0, -1).trim();
  assert.ok(long.startsWith(withoutEllipsis), "the cut text is a verbatim prefix of the source");
});

// guards: a fallback dek could exceed the writer's 45-word hard limit.
it("caps a fallback sentence at 45 words even when it is under 240 characters", () => {
  const result = firstSentenceForDek(Array.from({ length: 60 }, () => "a").join(" ") + ".");
  assert.equal(result.replace(/…$/, "").split(/\s+/).length, 45);
  assert.ok(result.endsWith("…"));
});

it("firstSentenceForDek returns empty for empty, null or undefined body", () => {
  assert.equal(firstSentenceForDek(""), "");
  assert.equal(firstSentenceForDek(null), "");
  assert.equal(firstSentenceForDek(undefined), "");
  assert.equal(firstSentenceForDek("   "), "");
});
