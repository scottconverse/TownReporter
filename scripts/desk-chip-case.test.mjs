import assert from "node:assert/strict";
import { test } from "node:test";

test("a stored lower-case status is capitalised where the chip is drawn", async () => {
  /* Bug caught: with the uppercase rule gone, stored words like "new" and "held" rendered lower case. */
  const { chipLabel, sentenceCase } = await import("../src/lib/news/desk-copy.ts");
  assert.equal(chipLabel("held"), "Held");
  assert.equal(sentenceCase("could not check"), "Could not check");
  assert.equal(sentenceCase("Ready to check"), "Ready to check");
});
