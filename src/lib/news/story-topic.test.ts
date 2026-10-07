// guards: a new story could open under the wrong section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialStoryTopic } from "./desk-copy.ts";

test("opens a lead without a draft under its saved section", () => {
  assert.equal(initialStoryTopic("infrastructure"), "infrastructure");
});
