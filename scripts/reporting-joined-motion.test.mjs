// guards: the editor could be sent back to check an originating motion already present across captions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewOpenStoryClaims } from "../src/lib/news/civic-reporting-run.server.ts";
import { record, story, openReporting } from "./reporting-fix-browser.test-helper.mjs";

test("supports an originating motion split across adjacent captions", async (t) => {
  const text = "The subsequent approval motion identifies ordinance 2026-73.";
  const segments = [
    { index: 0, seconds: 100, item: "9", text: "Ordinance 2026-73 is on the consent agenda." },
    { index: 10, seconds: 13800, item: "11", text: "I move to deny the previous request." },
    { index: 11, seconds: 13810, item: "11", text: "Earlier discussion. ".repeat(100) },
    { index: 1, seconds: 13946.88, item: "11", text: "Okay. Ordinance. So there is a motion to" },
    { index: 2, seconds: 13949.44, item: "11", text: "approve ordinance 2026-73" },
    { index: 3, seconds: 13952.56, item: "11", text: "made and seconded." },
    { index: 4, seconds: 13960, item: "11", text: "Further discussion. ".repeat(100) },
    { index: 5, seconds: 14000, item: "11", text: "The motion carries 5 to 2." },
  ];
  const result = await reviewOpenStoryClaims({
    story: story(text, [
      {
        id: "motion",
        text,
        item: "11; ordinance 2026-73",
        status: "UNVERIFIED",
        sourceIds: [],
        nextCheck: "Find the originating motion",
      },
    ]),
    record: record(segments),
    documents: [],
    method: { text: "Use records only." },
    chatOpts: {},
    throwIfCancelled: async () => {},
    chat: async (_system, prompt) => {
      const passages = JSON.parse(
        prompt.split("CLOSEST FULL-TRANSCRIPT PASSAGES: ")[1].split("\n\n")[0],
      );
      const found = passages.find((p) => /motion to approve ordinance 2026-73/.test(p.quote));
      return {
        ok: true,
        text: JSON.stringify(
          found
            ? {
                verdict: "VERIFIED",
                quote: "motion to approve ordinance 2026-73",
                sourceKind: "transcript",
                sourceUrl: found.url,
              }
            : { verdict: "OPEN" },
        ),
      };
    },
  });
  const page = await openReporting(t, [result]);
  assert.match(
    await page.locator(".reporting-claim-list").innerText(),
    /Verified against a linked source/,
  );
  assert.match(result.claims[0].recordEvidence.quote, /motion to approve ordinance 2026-73/);
  assert.ok(result.claims[0].recordEvidence.startSeconds <= 13946.88);
  assert.match(result.claims[0].recordEvidence.locator, /3:5/);
});
