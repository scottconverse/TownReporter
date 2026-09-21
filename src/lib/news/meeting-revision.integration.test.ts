import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";

describe("meeting capture Slice 4 re-check and draft revision path", () => {
  it("re-checks only provisional captures whose last check is at least the cadence gap old", async () => {
    const { dueForRecheck } = await import("./meeting-revision.ts");
    const now = new Date("2026-01-01T06:00:00Z");
    assert.equal(dueForRecheck({ status: "provisional", lastCheckedAt: "2026-01-01T00:00:00Z", now }), true);
    assert.equal(dueForRecheck({ status: "provisional", lastCheckedAt: "2026-01-01T05:30:00Z", now }), false);
    assert.equal(dueForRecheck({ status: "final", lastCheckedAt: "2026-01-01T00:00:00Z", now }), false);
  });

  it("updates a linked draft and records which claims were affected, with no auto-publish", async () => {
    const { applyDraftRevision } = await import("./meeting-revision.ts");
    const writes: { text: string; params: unknown[] }[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      writes.push({ text, params });
      if (/from meeting_draft_transcript_links/i.test(text)) {
        return [{
          draft_id: 9, artifact_id: 1, citation_snapshot: JSON.stringify([
            { artifactId: 1, segmentIndex: 2, captionSha256: "old", item: "Item 4", excerpt: "The vote passed." },
          ]),
        }] as T[];
      }
      return [] as T[];
    };
    const result = await applyDraftRevision(sql, {
      newsroomId: 1,
      videoId: "L1AnMLsLwtk",
      previousSha256: "old",
      nextSha256: "new",
    });
    assert.equal(result.draftsUpdated, 1);
    assert.equal(result.affected[0]?.segmentIndex, 2);
    const draftWrite = writes.find((w) => /update drafts/i.test(w.text));
    assert.ok(draftWrite, "linked draft updated");
    /*
      Pin the citations themselves, not the presence of a key name.

      This asserted only that the written JSON contains the string
      "transcriptCitations", which an empty array satisfies -- and an empty
      array is what the code wrote, discarding the citation it had just parsed
      and used to decide the revision affected segment 2. The assertion would
      also have passed if the code had written nothing at all.
    */
    const written = JSON.parse(String(draftWrite!.params[0])) as {
      transcriptCitations?: Array<{ segmentIndex: number; captionSha256: string }>;
    };
    assert.ok(
      Array.isArray(written.transcriptCitations) && written.transcriptCitations.length > 0,
      "the revision notice must not discard the draft's citations",
    );
    assert.equal(written.transcriptCitations[0]!.segmentIndex, 2, "the cited segment must survive");
    assert.equal(written.transcriptCitations[0]!.captionSha256, "old");
    assert.equal(writes.some((w) => /insert into articles/i.test(w.text)), false, "no auto-publish");
  });
});
