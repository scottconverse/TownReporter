import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { staleCitationNotice, staleMeetingCitations } from "./meeting-publish-guard.ts";
import { draftEvidenceSha256 } from "./meeting-draft-revision-review.ts";

/**
 * The guard that stops a meeting draft being published against a tape that moved.
 *
 * This is the failure the feature exists to prevent: printing a claim about a
 * recording whose words are no longer there. The check compares the caption hash
 * each citation recorded against the artifact the transcript is now -- the same
 * fact the revision machinery uses, so the guard and the notice cannot disagree.
 */
function sqlReturning(
  rows: Record<string, unknown>[],
  segmentRows?: { segment_index: number; caption_sha256: string }[],
): Sql {
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string) => {
    if (/from meeting_transcript_segments/i.test(text)) {
      const derived = rows.flatMap((row) => {
        try {
          const parsed = JSON.parse(String(row.citation_snapshot ?? "[]")) as Array<{ segmentIndex: number; captionSha256: string }>;
          return Array.isArray(parsed) ? parsed.map((citation) => ({ segment_index: citation.segmentIndex, caption_sha256: citation.captionSha256 })) : [];
        } catch { return []; }
      });
      return (segmentRows ?? derived) as unknown as T[];
    }
    return rows.map((row) => ({
      linked_integrity_status: "valid", current_integrity_status: "valid", ...row,
    })) as unknown as T[];
  };
  return sql;
}

describe("meeting publish guard", () => {
  it("allows the exact reviewed B snapshot, but blocks an edited draft or a later C", async () => {
    const draft = {
      id: 41, headline: "Council approves plan", dek: "", topic: "council", body: "The council approves the plan.",
      source_urls: "[]", provenance_json: "[]", found_note: "", unanswered: "[]",
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
    };
    const aHash = "a".repeat(64);
    const bHash = "b".repeat(64);
    const bSegmentHash = "c".repeat(64);
    const acceptedSnapshot = JSON.stringify([{
      artifactId: 5, segmentIndex: 18, captionSha256: bSegmentHash,
      sourceArtifactId: 4, sourceSegmentIndex: 9, sourceTimestampSeconds: 300,
      sourceCaptionSha256: aHash, acceptedArtifactId: 5, acceptedArtifactSha256: bHash,
      acceptedSegmentIndex: 18, acceptedTimestampSeconds: 301, acceptedEndSeconds: 305,
      excerpt: "The council approves the plan.",
    }]);

    async function check(input: { currentId?: number; currentHash?: string; changedBody?: string } = {}) {
      const currentId = input.currentId ?? 5;
      const currentHash = input.currentHash ?? bHash;
      let segmentQueries = 0;
      const sql = (async () => [] as never[]) as unknown as Sql;
      sql.query = async <T = Record<string, unknown>>(text: string) => {
        if (/from meeting_transcript_segments/i.test(text)) {
          segmentQueries += 1;
          return (segmentQueries === 1
            ? [{ segment_index: 9, caption_sha256: aHash }]
            : [{ segment_index: 18, caption_sha256: bSegmentHash, start_seconds: 301, end_seconds: 305, excerpt: "The council approves the plan." }]) as unknown as T[];
        }
        if (/from meeting_draft_transcript_revision_reviews/i.test(text)) {
          return currentId === 5 && currentHash === bHash ? [{
            accepted_artifact_id: 5, accepted_artifact_sha256: bHash,
            accepted_citation_snapshot: acceptedSnapshot, reviewed_by: "editor-1",
            resolution_note: "Compared the cited passage with B.", draft_evidence_sha256: draftEvidenceSha256(draft),
          }] as T[] : [] as T[];
        }
        return [{
          draft_id: 41, ...draft, ...(input.changedBody ? { body: input.changedBody } : {}),
          link_id: 77, artifact_id: 4, citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 9, captionSha256: aHash }]),
          revision_notice: "Affected claims: segment 9.", video_id: "video-1", linked_sha256: aHash,
          linked_integrity_status: "valid", current_artifact_id: currentId, current_sha256: currentHash,
          current_integrity_status: "valid", is_current: true,
        }] as T[];
      };
      return staleMeetingCitations(sql, { newsroomId: 3, draftId: 41 });
    }

    assert.deepEqual(await check(), [], "the editor's exact A-to-B decision permits this unchanged draft");
    const edited = await check({ changedBody: "The council rejected the plan." });
    assert.equal(edited[0]?.reason, "revised-artifact", "editing the story invalidates the prior review");
    const laterC = await check({ currentId: 6, currentHash: "d".repeat(64) });
    assert.equal(laterC[0]?.reason, "revised-artifact", "a B review cannot approve a later C");
  });

  it("blocks when the recording changed since the draft was written", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4,
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 4612, captionSha256: "old-hash" }]),
      revision_notice: null,
      video_id: "meeting-1",
      linked_sha256: "old-hash",
      current_artifact_id: 5,
      current_sha256: "new-hash",
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1, draftId: 41,
      citations: [{ segmentIndex: 4612, captionSha256: "old-hash" }],
    });
    assert.equal(stale.length, 1, "a citation against the old tape must be caught");
    assert.equal(stale[0]!.segmentIndex, 4612);
    assert.equal(stale[0]!.current, "new-hash");
  });

  it("blocks a real revision that inserts artifact B while preserving linked artifact A", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      artifact_id: 4,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      linked_sha256: "old-hash",
      revision_notice: "The recording changed.",
      current_artifact_id: 5,
      current_sha256: "new-hash",
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 4612, captionSha256: "old-hash" }]),
      video_id: "meeting-1",
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1,
      draftId: 41,
      citations: [{ segmentIndex: 4612, captionSha256: "old-hash" }],
    });
    assert.equal(stale.length, 1, "artifact B must block a draft still linked to artifact A");
    assert.equal(stale[0]!.recorded, "old-hash");
    assert.equal(stale[0]!.current, "new-hash");
  });

  it("uses the persisted draft snapshot rather than lead candidate citations", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      artifact_id: 4,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      linked_sha256: "old-hash",
      revision_notice: "The recording changed.",
      current_artifact_id: 5,
      current_sha256: "new-hash",
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 9, captionSha256: "old-hash" }]),
      video_id: "meeting-1",
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1,
      draftId: 41,
      citations: [{ segmentIndex: 99, captionSha256: "new-hash" }],
    });
    assert.equal(stale.length, 1, "candidate citations must not override the draft's persisted snapshot");
    assert.equal(stale[0]!.segmentIndex, 9);
  });

  it("fails closed when a meeting draft claims tape evidence but its link is missing", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: null,
      linked_sha256: null,
      revision_notice: null,
      current_artifact_id: null,
      current_sha256: null,
      citation_snapshot: null,
      video_id: null,
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1,
      draftId: 41,
      citations: [{ segmentIndex: 9, captionSha256: "old-hash" }],
    });
    assert.equal(stale.length, 1, "missing meeting provenance must block publication");
    assert.equal(stale[0]!.reason, "missing-link");
  });

  it("does not treat malformed draft research as proof that a missing transcript link is safe", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: "{malformed",
      artifact_id: null,
      linked_sha256: null,
      revision_notice: null,
      current_artifact_id: null,
      current_sha256: null,
      citation_snapshot: null,
      video_id: null,
    }]);
    const stale = await staleMeetingCitations(sql, { newsroomId: 1, draftId: 41 });
    assert.equal(stale[0]?.reason, "missing-link");
  });

  it("fails closed on a malformed used-citation snapshot", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4,
      linked_sha256: "old-hash",
      revision_notice: null,
      current_artifact_id: 4,
      current_sha256: "old-hash",
      citation_snapshot: "not json",
      video_id: "meeting-1",
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1,
      draftId: 41,
      citations: [{ segmentIndex: 9, captionSha256: "old-hash" }],
    });
    assert.equal(stale.length, 1, "malformed meeting provenance must block publication");
    assert.equal(stale[0]!.reason, "malformed-snapshot");
  });

  it("fails closed when a well-formed snapshot names a segment absent from its linked artifact", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4,
      linked_sha256: "same-hash",
      current_artifact_id: 4,
      current_sha256: "same-hash",
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 999, captionSha256: "same-hash" }]),
      revision_notice: null,
      video_id: "meeting-1",
    }], []);
    const stale = await staleMeetingCitations(sql, { newsroomId: 1, draftId: 41 });
    assert.equal(stale[0]?.reason, "invalid-citation-segment");
    assert.equal(stale[0]?.current, "missing");
  });

  it("fails closed when the persisted segment hash disagrees with the used-citation snapshot", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4,
      linked_sha256: "same-hash",
      current_artifact_id: 4,
      current_sha256: "same-hash",
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 9, captionSha256: "same-hash" }]),
      revision_notice: null,
      video_id: "meeting-1",
    }], [{ segment_index: 9, caption_sha256: "different-segment-hash" }]);
    const stale = await staleMeetingCitations(sql, { newsroomId: 1, draftId: 41 });
    assert.equal(stale[0]?.reason, "invalid-citation-segment");
    assert.equal(stale[0]?.recorded, "same-hash");
    assert.equal(stale[0]?.current, "different-segment-hash");
  });

  it("blocks a current artifact whose bytes have not passed integrity review", async () => {
    const base = {
      draft_id: 41, research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4, linked_sha256: "same-hash", linked_integrity_status: "valid",
      current_artifact_id: 4, current_sha256: "same-hash", current_integrity_status: "hash-mismatch",
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 9, captionSha256: "same-hash" }]),
      revision_notice: null, video_id: "meeting-1",
    };
    const stale = await staleMeetingCitations(sqlReturning([base]), { newsroomId: 1, draftId: 41 });
    assert.equal(stale[0]?.reason, "invalid-current-artifact");
    const linkedStale = await staleMeetingCitations(sqlReturning([{
      ...base, linked_integrity_status: "missing", current_integrity_status: "valid",
    }]), { newsroomId: 1, draftId: 41 });
    assert.equal(linkedStale[0]?.reason, "invalid-linked-artifact");
  });

  it("allows publishing when the tape has not moved", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4,
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 4612, captionSha256: "same-hash" }]),
      revision_notice: null,
      video_id: "meeting-1",
      linked_sha256: "same-hash",
      current_artifact_id: 4,
      current_sha256: "same-hash",
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1, draftId: 41,
      citations: [{ segmentIndex: 4612, captionSha256: "same-hash" }],
    });
    assert.deepEqual(stale, [], "an unchanged tape must not block the editor");
  });

  it("uses artifact B after redraft while retaining artifact A as historical evidence", async () => {
    const research = JSON.stringify({ meetingEvidence: { used: true, artifactId: 5 } });
    const stale = await staleMeetingCitations(sqlReturning([
      {
        draft_id: 41, research_json: research, artifact_id: 4, is_current: false,
        citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7, captionSha256: "old-hash" }]),
        revision_notice: "The recording changed.", video_id: "meeting-1", linked_sha256: "old-hash",
        current_artifact_id: 5, current_sha256: "new-hash",
      },
      {
        draft_id: 41, research_json: research, artifact_id: 5, is_current: true,
        citation_snapshot: JSON.stringify([{ artifactId: 5, segmentIndex: 7, captionSha256: "new-hash" }]),
        revision_notice: null, video_id: "meeting-1", linked_sha256: "new-hash",
        current_artifact_id: 5, current_sha256: "new-hash",
      },
    ]), { newsroomId: 1, draftId: 41 });
    assert.deepEqual(stale, [], "historical A must remain stored without blocking the current B-linked draft");
  });

  it("stays out of the way for a draft with no transcript links", async () => {
    /*
      Every other story in the paper. A guard that fired here would block ordinary
      publishing, which is worse than the failure it prevents.
    */
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: "{}",
      artifact_id: null,
      citation_snapshot: null,
      revision_notice: null,
      video_id: null,
      linked_sha256: null,
      current_artifact_id: null,
      current_sha256: null,
    }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1, draftId: 41,
      citations: [{ segmentIndex: 4612, captionSha256: "old-hash" }],
    });
    assert.deepEqual(stale, []);
  });

  it("checks the persisted draft once and leaves an ordinary draft unaffected", async () => {
    let queried = false;
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>() => {
      queried = true;
      return [{
        draft_id: 41, research_json: "{}", artifact_id: null, citation_snapshot: null,
        revision_notice: null, video_id: null, linked_sha256: null,
        current_artifact_id: null, current_sha256: null,
      }] as T[];
    };
    const stale = await staleMeetingCitations(sql, { newsroomId: 1, draftId: 41, citations: [] });
    assert.deepEqual(stale, []);
    assert.equal(queried, true, "the persisted draft, not caller-supplied candidates, decides the guard");
  });

  it("names what moved and what to do about it", () => {
    const notice = staleCitationNotice([{ artifactId: 4, segmentIndex: 4612, recorded: "old", current: "new", reason: "revised-artifact" }]);
    assert.match(notice, /recording this draft quotes has changed/);
    assert.match(notice, /segment 4612/, "the editor must be told which moment moved");
    assert.match(notice, /Redraft it from the current recording/, "and what to do next");
    assert.doesNotMatch(notice, /publish anyway|override|confirm the draft still matches/i, "there is no blanket override");
  });

  it("says one citation, not one citations", () => {
    const notice = staleCitationNotice([{ artifactId: 4, segmentIndex: 1, recorded: "a", current: "b", reason: "revised-artifact" }]);
    assert.match(notice, /\(1 citation affected/);
    assert.doesNotMatch(notice, /1 citations/);
  });
});

