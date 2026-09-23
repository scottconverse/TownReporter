import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { staleCitationNotice, staleMeetingCitations } from "./meeting-publish-guard.ts";

/**
 * The guard that stops a meeting draft being published against a tape that moved.
 *
 * This is the failure the feature exists to prevent: printing a claim about a
 * recording whose words are no longer there. The check compares the caption hash
 * each citation recorded against the artifact the transcript is now -- the same
 * fact the revision machinery uses, so the guard and the notice cannot disagree.
 */
function sqlReturning(rows: Record<string, unknown>[]): Sql {
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>() => rows as unknown as T[];
  return sql;
}

describe("meeting publish guard", () => {
  it("blocks when the recording changed since the draft was written", async () => {
    const sql = sqlReturning([{
      draft_id: 41,
      research_json: JSON.stringify({ meetingEvidence: { used: true } }),
      artifact_id: 4,
      citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 4612, captionSha256: "old-hash" }]),
      revision_notice: "The recording changed.",
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
  });

  it("says one citation, not one citations", () => {
    const notice = staleCitationNotice([{ artifactId: 4, segmentIndex: 1, recorded: "a", current: "b", reason: "revised-artifact" }]);
    assert.match(notice, /\(1 citation affected/);
    assert.doesNotMatch(notice, /1 citations/);
  });
});

