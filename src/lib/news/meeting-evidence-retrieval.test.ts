import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retrieveMeetingEvidence } from "./meeting-evidence-retrieval.ts";

function longEvidence(count = 320): string {
  return [
    "MEETING: Test council",
    "This recording has ended and the transcript below was captured successfully.",
    ...Array.from({ length: count }, (_, index) =>
      `[00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}; segment ${index}] ${index === 170 ? "Council approved the housing contract after a public hearing." : `Discussion line ${index} with enough ordinary words for batching.`}`,
    ),
    "--- VOTES, FROM THE STRUCTURED RECORD ---",
    "No vote was established from the structured record.",
  ].join("\n");
}

describe("meeting evidence retrieval", () => {
  it("examines every sequential batch and returns raw windows around cited findings", async () => {
    const calls: string[] = [];
    const result = await retrieveMeetingEvidence(
      longEvidence(),
      async (_system, user) => {
        calls.push(user);
        const indexes = [...user.matchAll(/segment (\d+)/g)].map((match) => Number(match[1]));
        const chosen = indexes[Math.floor(indexes.length / 2)]!;
        return { ok: true as const, text: JSON.stringify({ findings: [{ summary: `Finding in segment ${chosen}`, why_newsworthy: "local decision", segment_indexes: [chosen] }] }) };
      },
      { batchChars: 8_000 },
    );
    assert.ok(calls.length > 1, "a long record must be read in more than one pass");
    assert.equal(result.batchesExamined, calls.length);
    assert.equal(calls.flatMap((call) => [...call.matchAll(/segment (\d+)/g)].map((match) => Number(match[1]))).length, 320);
    assert.match(result.evidence, /MEETING-WIDE REPORTER INDEX/);
    assert.match(result.evidence, /RAW TRANSCRIPT WINDOWS/);
    assert.match(result.evidence, /Council approved the housing contract/);
    assert.match(result.evidence, /No vote was established/);
  });

  it("keeps distributed and signal windows when a reporter pass fails", async () => {
    const result = await retrieveMeetingEvidence(longEvidence(180), async () => ({ ok: false as const, error: "offline" }), { batchChars: 8_000 });
    assert.equal(result.findings, 0);
    assert.match(result.evidence, /segment 0/);
    assert.match(result.evidence, /segment 179/);
    assert.match(result.evidence, /segment 170/);
  });
});
