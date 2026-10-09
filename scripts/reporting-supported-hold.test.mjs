// guards: the editor could be asked to recheck an item the same package already supports.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkedHeldCaveats } from "../src/lib/news/civic-reporting-run.server.ts";
import { record, story, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("drops a held motion answered by a Supported fact", async (t) => {
  const text = "Council approved the meeting extension motion.";
  const result = {
    stories: [story(text, [{ id: "H1", text, status: "VERIFIED", sourceIds: [], nextCheck: "" }])],
    held: [{ storyId: "story", headline: "Meeting extension motion", reason: "The meeting extension motion is unverified.", nextCheck: "Check the extension motion.", unverified: true }],
  };
  result.held = checkedHeldCaveats(result.held, result.stories, record([]));
  const page = await openReporting(t, result.stories, result.held);
  assert.equal(result.held.length, 0);
  assert.doesNotMatch(await page.locator("body").innerText(), /extension motion is unverified/);
});
