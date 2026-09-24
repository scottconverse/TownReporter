import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { loadMeetingDraftMaterial } from "./meeting-draft-material.server.ts";

describe("meeting draft material", () => {
  it("rebuilds full aligned spans and citation candidates from canonical meeting tables", async () => {
    const calls: string[] = [];
    const sql = {
      async query<T>(text: string): Promise<T[]> {
        calls.push(text.replace(/\s+/g, " ").trim());
        if (/from meeting_transcript_artifacts/.test(text))
          return [{ id: 7, video_id: "video-1", sha256: "sha-a" }] as T[];
        if (/from meeting_capture_records/.test(text))
          return [{ title: "Finished council meeting", published: "2026-09-22T03:00:00Z" }] as T[];
        if (/from meeting_agenda_chunks/.test(text))
          return [
            { item: "4", title: "Housing", start_seconds: 10, segment_indexes: "[0,1]" },
            { item: "8", title: "Budget", start_seconds: 40, segment_indexes: "[2]" },
          ] as T[];
        if (/from meeting_transcript_segments/.test(text))
          return [
            { segment_index: 0, start_seconds: 10, excerpt: "The hearing opened.", caption_sha256: "sha-a" },
            { segment_index: 1, start_seconds: 20, excerpt: "Residents discussed housing.", caption_sha256: "sha-a" },
            { segment_index: 2, start_seconds: 40, excerpt: "The budget discussion began.", caption_sha256: "sha-a" },
          ] as T[];
        if (/from meeting_structured_votes/.test(text))
          return [{ item: "8", established: true, motion: "Adopt the budget", mover: "Lee", seconder: "Diaz", tally: "6-1", result: "Passed", source: "official vote record" }] as T[];
        return [] as T[];
      },
    } as unknown as Sql;

    const result = await loadMeetingDraftMaterial(sql, {
      newsroomId: 1,
      artifactId: 7,
      videoId: "video-1",
      fallbackTitle: "Fallback",
    });

    assert.match(result.evidence, /recording has ended/i);
    assert.match(result.evidence, /The hearing opened/);
    assert.match(result.evidence, /Residents discussed housing/);
    assert.match(result.evidence, /The budget discussion began/);
    assert.match(result.evidence, /tally 6-1/);
    assert.equal(result.citations.length, 3);
    assert.deepEqual(result.citations.map((row) => row.item), ["4", "4", "8"]);
    assert.equal(result.meeting.artifactId, 7);
    assert.ok(calls.some((query) => /meeting_transcript_segments/.test(query)));
  });

  it("fails closed when the canonical artifact or aligned spans are missing", async () => {
    const noArtifact = { query: async () => [] } as unknown as Sql;
    await assert.rejects(
      () => loadMeetingDraftMaterial(noArtifact, { newsroomId: 1, artifactId: 99, videoId: "missing", fallbackTitle: "Missing" }),
      /artifact.*missing/i,
    );
  });
});
