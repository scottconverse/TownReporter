// guards: a whole-meeting draft could silently drop a detected vote and leave the editor unaware.
import assert from "node:assert/strict";
import { test } from "node:test";
import { writingPass } from "../src/lib/news/civic-reporting-run.server.ts";
import { record, story, write, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("names an omitted required vote as a filing gap even when its subject is absent", async (t) => {
  const segments = [
    { index: 1, seconds: 8370.639, item: "9", text: "I move ordinance" },
    { index: 2, seconds: 8381.28, item: "9", text: "ordinance 2026-62" },
    { index: 3, seconds: 8383.2, item: "9", text: "as amended." },
    { index: 4, seconds: 8394, item: "9", text: "That carries unanimously." },
    { index: 5, seconds: 9000, item: "9", text: "I move to approve ordinance 2026-64." },
    { index: 6, seconds: 9010, item: "9", text: "That carries 5 to 2." },
  ];
  const packet = {
    stories: [story("Council considered the energy budget proposal for neighborhood residents.")],
    held: [],
  };
  const result = await write(writingPass, record(segments), packet);
  const page = await openReporting(t, result.stories, result.held);
  assert.match(await page.locator("body").innerText(), /2026.?62[^.]*unanimously/);
  assert.ok(result.gaps.some((gap) => /2026.?62.*unanimously/.test(gap)));
  assert.ok(result.held.some((row) => row.unverified && /2026.?62/.test(row.reason)));
});
