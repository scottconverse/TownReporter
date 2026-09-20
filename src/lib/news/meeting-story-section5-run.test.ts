import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";

/**
 * Real integration test: exercises runSection5ForArtifact against a fake that
 * models the stored artifact + segments, and counts the section-5 calls. This
 * fails if the pipeline stops calling chunking, alignment, vote extraction,
 * persistence, or the unaligned path.
 */
function harness(input: { aligned: boolean }) {
  const writes: { text: string; params: unknown[] }[] = [];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    writes.push({ text, params });
    if (/from meeting_transcript_artifacts/i.test(text)) {
      return [{ id: 5, storage_path: "C:\\data\\meet.srv3", sha256: "abc123" }] as T[];
    }
    if (/from meeting_transcript_segments/i.test(text)) {
      return [
        { segment_index: 0, start_seconds: 0, end_seconds: 60, excerpt: "Roll call and pledge.", caption_sha256: "abc123" },
        { segment_index: 1, start_seconds: 60, end_seconds: 600, excerpt: "Item 1, approval of the minutes. Motion to approve by Mayor Prom, seconded by Council Member Coloffer.", caption_sha256: "abc123" },
        { segment_index: 2, start_seconds: 600, end_seconds: 2400, excerpt: "Item 2, the airport rates and charges study.", caption_sha256: "abc123" },
      ] as T[];
    }
    return [] as T[];
  };
  return { sql, writes };
}

describe("meeting section 5 real pipeline integration", () => {
  it("runs chunking, alignment, vote extraction, persistence, and citation resolution from the stored artifact", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    const { sql, writes } = harness({ aligned: true });
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5 },
      {
        packetForTitle: async () => ({
          meeting: {
            id: 1, title: "City Council Regular Session", date: "2026-07-28", dateTime: "2026-07-28T18:00:00",
            time: "18:00", location: "Council Chambers",
            documentList: [
              { id: 1, templateId: 1, compileOutputType: 1, templateName: "Approval of the Minutes", link: null },
              { id: 2, templateId: 2, compileOutputType: 1, templateName: "Airport Rates and Charges Study", link: null },
            ],
          },
          urls: [],
        }),
      },
    );
    assert.equal(result.aligned, true);
    assert.ok(result.chunkCount >= 1, "chunks were produced");
    assert.ok(writes.some((w) => /meeting_agenda_chunks/.test(w.text)), "chunks persisted");
    assert.ok(writes.some((w) => /meeting_alignments/.test(w.text)), "alignment persisted");
    assert.ok(writes.some((w) => /meeting_structured_votes/.test(w.text)), "votes persisted");
    assert.ok(result.citations.length >= 1, "citations resolved from stored segments");
    assert.equal(result.citations[0]?.captionSha256, "abc123");
    assert.ok(result.citations[0]!.excerpt.length < 1000, "citation excerpt is bounded, not the whole file");
  });

  it("takes the honest unaligned path when packet items do not align", async () => {
    const { runSection5ForArtifact } = await import("./meeting-story-section5-run.ts");
    const { sql, writes } = harness({ aligned: false });
    const result = await runSection5ForArtifact(
      sql,
      { newsroomId: 1, videoId: "L1AnMLsLwtk", title: "City Council Regular Session", artifactId: 5 },
      { packetForTitle: async () => null },
    );
    assert.equal(result.aligned, false);
    assert.ok(result.unalignedLead, "unaligned lead produced");
    assert.equal(result.unalignedLead!.itemLevelDraft, false);
    assert.equal(result.unalignedLead!.untimed, true);
    assert.match(result.unalignedLead!.leadWhy, /align/i);
    assert.ok(writes.some((w) => /meeting_alignments/.test(w.text)), "failed alignment still persisted");
  });
});
