import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const story = await readFile(new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url), "utf8");

test("the redundant draft-review banner is absent on every story", () => {
  assert.doesNotMatch(story, /<strong>Draft saved \u2014 review required\.<\/strong>/);
});

test("the publish bar retains the review target", () => {
  assert.match(story, /<BeforeYouCanPublish/);
  assert.match(story, /getElementById\("publish-blockers"\)/);
});
