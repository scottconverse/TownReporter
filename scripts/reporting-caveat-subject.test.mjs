// guards: an editor could be sent to another agenda item's evidence for an airport claim.
import assert from "node:assert/strict";
import { test } from "node:test";
import { writingPass } from "../src/lib/news/civic-reporting-run.server.ts";
import { record, story, write, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("airport caveat never points to the Dry Creek passage", async (t) => {
  const result = await write(
    writingPass,
    record([
      {
        index: 1,
        seconds: 6885,
        item: "9",
        text: "I move to approve Dry Creek ordinance 2026-62.",
      },
      {
        index: 2,
        seconds: 14313,
        item: "12A",
        text: "I move to approve the airport subsidy policy.",
      },
    ]),
    {
      stories: [
        story("The airport subsidy motion is missing from the transcript.", [
          {
            id: "B1",
            text: "Dry Creek ordinance 2026-62",
            status: "UNVERIFIED",
            sourceIds: [],
            nextCheck: "Check",
          },
        ]),
      ],
      held: [],
    },
  );
  const page = await openReporting(t, result.stories);
  assert.doesNotMatch(result.stories[0].draft, /Item 9|1:54:45|airport[^.]*missing/i);
  assert.doesNotMatch(await page.locator("body").innerText(), /Item 9; 1:54:45/);
});
