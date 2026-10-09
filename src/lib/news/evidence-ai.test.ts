// guards: an unsupported or invented quotation could silently clear a draft's evidence gate.
import assert from "node:assert/strict";
import { it } from "node:test";
import { judgeEvidenceClaims } from "./evidence-ai.ts";

it("checks retained passages in bounded batches and leaves ungrounded claims for a human", async () => {
  const sources = [
    { url: "https://example.org/record", text: "The plan was submitted on Tuesday." },
  ];
  const claims = [
    "The plan was submitted on Tuesday.",
    "The plan was approved on Tuesday.",
    "The mayor resigned.",
  ].map((text) => ({ text, urls: [sources[0].url] }));
  let calls = 0;
  const result = await judgeEvidenceClaims(claims, sources, async (prompt) => {
    calls++;
    assert.ok(prompt.includes(sources[0].text));
    return {
      ok: true,
      text: JSON.stringify({
        rows: claims.map((_, index) => ({
          index,
          verdict: "Supported",
          sourceUrl: sources[0].url,
          quote: index === 2 ? "The mayor resigned." : sources[0].text,
        })),
      }),
    };
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    result.map((row) => row.verdict),
    ["Supported", "Needs a human", "Needs a human"],
  );
  assert.ok(result[0].checkedAt && result[0].quote);
  const failed = await judgeEvidenceClaims(
    Array.from({ length: 41 }, () => claims[0]),
    sources,
    async () => {
      calls++;
      throw new Error("offline");
    },
  );
  assert.equal(calls, 5);
  assert.ok(failed.every((row) => row.verdict === "Needs a human" && row.reason));
});
