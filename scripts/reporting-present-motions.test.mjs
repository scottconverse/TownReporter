// guards: false missing-motion warnings could make the editor redo checks already answered by the tape.
import assert from "node:assert/strict";
import { test } from "node:test";
import { writingPass } from "../src/lib/news/civic-reporting-run.server.ts";
import { record, story, write, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("shows present motions in copy and open items instead of absence warnings", async (t) => {
  const motion = "I move to pass and adopt financing ordinance 2026-63.";
  const draft =
    "The originating motion for financing ordinance 2026-63 is missing from the transcript. Governing repayment protections remain unverified.";
  const packet = {
    stories: [story(draft)],
    held: [
      {
        storyId: "story",
        headline: "Financing ordinance 2026-63",
        reason: draft,
        nextCheck: "Find the missing motion.",
      },
      {
        storyId: "other",
        headline: "Financing ordinance 2026-63",
        reason: draft,
        nextCheck: "Find the missing motion.",
      },
    ],
  };
  const result = await write(
    writingPass,
    record([{ index: 1, seconds: 3976, item: "10A", text: motion }]),
    packet,
  );
  const page = await openReporting(t, result.stories, result.held);
  assert.doesNotMatch(await page.locator("body").innerText(), /motion[^.]*\bmissing\b/i);
  assert.doesNotMatch(result.stories[0].draft, /motion[^.]*\bmissing\b/i);
  assert.ok(result.held.every((row) => !/missing/i.test(row.reason + row.nextCheck)));
  assert.match(result.stories[0].draft, /Governing repayment protections remain unverified/);
});
