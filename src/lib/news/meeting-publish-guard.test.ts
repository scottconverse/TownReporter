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
    const sql = sqlReturning([{ draft_id: 41, artifact_id: 4, sha256: "new-hash" }]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1, draftId: 41,
      citations: [{ segmentIndex: 4612, captionSha256: "old-hash" }],
    });
    assert.equal(stale.length, 1, "a citation against the old tape must be caught");
    assert.equal(stale[0]!.segmentIndex, 4612);
    assert.equal(stale[0]!.current, "new-hash");
  });

  it("allows publishing when the tape has not moved", async () => {
    const sql = sqlReturning([{ draft_id: 41, artifact_id: 4, sha256: "same-hash" }]);
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
    const sql = sqlReturning([]);
    const stale = await staleMeetingCitations(sql, {
      newsroomId: 1, draftId: 41,
      citations: [{ segmentIndex: 4612, captionSha256: "old-hash" }],
    });
    assert.deepEqual(stale, []);
  });

  it("does not query at all when the draft cites nothing", async () => {
    let queried = false;
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>() => { queried = true; return [] as T[]; };
    const stale = await staleMeetingCitations(sql, { newsroomId: 1, draftId: 41, citations: [] });
    assert.deepEqual(stale, []);
    assert.equal(queried, false, "an ordinary draft must not cost a query on publish");
  });

  it("names what moved and what to do about it", () => {
    const notice = staleCitationNotice([{ artifactId: 4, segmentIndex: 4612, recorded: "old", current: "new" }]);
    assert.match(notice, /recording this draft quotes has changed/);
    assert.match(notice, /segment 4612/, "the editor must be told which moment moved");
    assert.match(notice, /Redraft it from the current recording/, "and what to do next");
  });

  it("says one citation, not one citations", () => {
    const notice = staleCitationNotice([{ artifactId: 4, segmentIndex: 1, recorded: "a", current: "b" }]);
    assert.match(notice, /\(1 citation affected/);
    assert.doesNotMatch(notice, /1 citations/);
  });
});

