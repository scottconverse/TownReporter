import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runStatsLine } from "./meeting-ledger-stats.ts";
import type { RunStats } from "@/lib/news/meeting-whole";

/*
  The receipt's own line. A writer fallback records
  `{ writer: "standard", researchWriterError }` with no wall time, and the
  minutes formula used to print "took NaN min" on that row.
*/
describe("runStatsLine", () => {
  it("never prints NaN when the run recorded no wall time", () => {
    const line = runStatsLine({ writer: "standard" } as unknown as RunStats);
    assert.equal(line.includes("NaN"), false, line);
    assert.equal(line.includes("took"), false, "no time was recorded, so no time is claimed");
    assert.match(line, /^Written by standard$/);
  });

  it("still prints the wall time when the run recorded one", () => {
    const line = runStatsLine({
      wallMs: 12 * 60_000,
      modelCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      writer: "report-local-news",
      model: "deepseek-v4.1-flash:1017-cloud",
    });
    assert.match(line, /took 12 min/);
  });
});
