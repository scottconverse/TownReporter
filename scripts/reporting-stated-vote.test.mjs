// guards: a printed vote could be falsely presented to the editor as an omitted result.
import assert from "node:assert/strict";
import { test } from "node:test";
import { writingPass } from "../src/lib/news/civic-reporting-run.server.ts";
import { record, story, write, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("recognizes an amended ordinance's unanimous result among other votes", async (t) => {
  const result = await write(writingPass, record([
    { index: 1, seconds: 8370, item: "9", text: "I move ordinance 2026-62 as amended." },
    { index: 2, seconds: 8394, item: "9", text: "That carries unanimously." },
  ]), { stories: [story("Dry Creek ordinance 2026-62 as amended passed unanimously. A separate denial motion failed.")], held: [] });
  const page = await openReporting(t, result.stories, result.held);
  assert.ok(!result.gaps.some((gap) => /2026.?62/.test(gap)));
  assert.ok(!result.held.some((row) => /2026.?62/.test(row.reason)));
  assert.doesNotMatch(await page.locator("body").innerText(), /2026.?62[^.]*not stated/);
});
