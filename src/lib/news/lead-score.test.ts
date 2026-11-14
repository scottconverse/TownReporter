import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseScanResult } from "./schema.ts";
import { parseStoredScoreParts, readScoreParts, scoreTooltip, scoreTotal } from "./lead-score.ts";

const parts = { immediacy: 4, immediacy_why: " Vote is\nTuesday. ", impact: 3, conflict: 1, novelty: 2, novelty_why: "Annual." };

describe("the four-part lead score", () => {
  it("reads four 1-5 integers and adds them", () => {
    const p = readScoreParts(parts);
    assert.ok(p);
    assert.equal(scoreTotal(p), 10);
    assert.equal(p.reasons.immediacy, "Vote is Tuesday.");
    assert.equal(p.reasons.impact, "");
  });

  it("refuses half a score", () => {
    for (const bad of [{ ...parts, conflict: 0 }, { ...parts, impact: 6 }, { ...parts, novelty: 2.5 }, { ...parts, immediacy: null }, null, [], "12"]) {
      assert.equal(readScoreParts(bad), null, JSON.stringify(bad));
    }
  });

  it("round-trips through the stored column, as text or as an object", () => {
    const p = readScoreParts(parts)!;
    assert.deepEqual(parseStoredScoreParts(JSON.stringify(p)), p);
    assert.deepEqual(parseStoredScoreParts(p), p);
    assert.equal(parseStoredScoreParts(null), null);
    assert.equal(parseStoredScoreParts("not json"), null);
  });

  it("says the parts and the reasons in the Queue tooltip", () => {
    assert.equal(scoreTooltip(12, null), "Newsworthiness 12/20");
    assert.equal(
      scoreTooltip(10, readScoreParts(parts)),
      "Newsworthiness 10/20\nImmediacy 4 · Impact 3 · Conflict 1 · Novelty 2\nImmediacy: Vote is Tuesday.\nNovelty: Annual.",
    );
  });
});

describe("the scan reply", () => {
  const lead = { headline: "Council votes on rents", why: "A vote.", topic: "council", source_urls: [], evidence: "x" };
  const run = (l: Record<string, unknown>) => parseScanResult({ leads: [{ ...lead, ...l }] }, ["council"]).leads[0]!;

  it("files the sum of the parts as the newsworthiness and keeps the parts", () => {
    const got = run({ score: parts, newsworthiness: 3 });
    assert.equal(got.newsworthiness, 10);
    assert.equal(got.scoreParts?.conflict, 1);
  });

  it("still reads a plain 0-20 newsworthiness when no valid parts came", () => {
    const got = run({ score: { immediacy: 4 }, newsworthiness: 12 });
    assert.equal(got.newsworthiness, 12);
    assert.equal(got.scoreParts, null);
    assert.equal(run({}).newsworthiness, 0);
  });
});
