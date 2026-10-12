import assert from "node:assert/strict";
import { test } from "node:test";
import { publishPrimaryLabel } from "./publish-section-words.ts";

// DHF-9: with no section chosen, the primary label must not contradict the
// "Publish anyway in <section> (no section was chosen)" press beside it.
test("no section chosen: the primary label asks for a section and offers the anyway path", () => {
  assert.equal(
    publishPrimaryLabel({ sectionReady: false, sectionName: "Transportation" }),
    "No section chosen. Pick one, or publish in Transportation anyway.",
  );
});

test("section chosen: the primary label publishes in that section", () => {
  assert.equal(
    publishPrimaryLabel({ sectionReady: true, sectionName: "Transportation" }),
    "Publish in Transportation",
  );
});
