import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";

describe("meeting section 5 persistence and unalignable behavior", () => {
  it("persists chunks, alignment, and structured votes additively", async () => {
    const { persistSection5 } = await import("./meeting-story-section5-persist.ts");
    const writes: { text: string; params: unknown[] }[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      writes.push({ text, params });
      return [] as T[];
    };
    await persistSection5(sql, {
      newsroomId: 1,
      videoId: "L1AnMLsLwtk",
      artifactId: 5,
      chunks: [{ item: "1", title: "Approval of the Minutes", segmentIndexes: [1], startSeconds: 60, endSeconds: 600 }],
      alignment: { aligned: true, reason: null, chunks: [] },
      votes: [{
        item: "1", established: true, motion: "Approve", mover: "A", seconder: "B",
        tally: "7-0", result: "Passed", source: "minutes",
        provenance: [{ source: "minutes", locator: null }], disagreements: [],
      }],
    });
    assert.ok(writes.some((w) => /meeting_agenda_chunks/.test(w.text)));
    assert.ok(writes.some((w) => /artifact_id=excluded\.artifact_id/.test(w.text)), "a revised meeting must move its chunks to the new immutable artifact");
    assert.ok(writes.some((w) => /meeting_alignments/.test(w.text)));
    assert.ok(writes.some((w) => /meeting_structured_votes/.test(w.text)));
    assert.ok(writes.some((w) => /provenance/.test(w.text)));
  });

  it("files a single untimed lead and no item-level draft when alignment fails", async () => {
    const { unalignedMeetingLead } = await import("./meeting-story-section5-persist.ts");
    const result = unalignedMeetingLead({ videoId: "L1AnMLsLwtk", title: "City Council Regular Session", reason: "no packet item could be aligned to a transcript span" });
    assert.equal(result.itemLevelDraft, false);
    assert.match(result.leadHeadline, /City Council Regular Session/);
    assert.match(result.leadWhy, /align/i);
    assert.equal(result.untimed, true);
  });
});
