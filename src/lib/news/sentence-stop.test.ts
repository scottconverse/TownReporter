import { test } from "node:test";
import assert from "node:assert/strict";
import { cutAtSentenceEnd, lastSentenceStop } from "./sentence-stop.ts";

test("FC18: a cut never stops on an AP month abbreviation", () => {
  const text = "Road work starts Monday. Casey Cooley's Oct. 18 fundraiser is at the library on Main St. downtown and more";
  const out = cutAtSentenceEnd(text, 60);
  assert.equal(out, "Road work starts Monday.");
});

test("FC18: a real sentence end still counts", () => {
  assert.equal(lastSentenceStop("One. Two? Three"), 8);
  assert.equal(cutAtSentenceEnd("Short.", 100), "Short.");
});
