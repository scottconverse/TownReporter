import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { recordPublishedMeetingEvidence } from "./meeting-article-revision.ts";
import { linkDraftToTranscript } from "./meeting-draft-transcript-link.ts";
import { staleMeetingCitations } from "./meeting-publish-guard.ts";

test("redraft keeps A as history while B becomes the only publishable evidence", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table drafts (id integer primary key, newsroom_id integer not null, research_json text, updated_at timestamptz default now());
      create table meeting_transcript_artifacts (
        id integer primary key, newsroom_id integer not null, video_id text not null,
        artifact_type text not null default 'transcript', sha256 text not null, captured_at timestamptz not null
      );
      create table meeting_draft_transcript_links (
        id serial primary key, newsroom_id integer not null, draft_id integer not null,
        artifact_id integer not null, citation_snapshot text not null default '[]', revision_notice text,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique(newsroom_id,draft_id,artifact_id)
      );
      create table meeting_article_transcript_links (
        id serial primary key, newsroom_id integer not null, article_id integer not null,
        origin_draft_id integer, artifact_id integer not null, artifact_sha256 text not null,
        video_id text not null, citation_snapshot text not null, published_at timestamptz default now(),
        created_at timestamptz default now(), unique(newsroom_id,article_id,artifact_id)
      );
      insert into drafts(id,newsroom_id,research_json) values(41,3,'{}');
      insert into meeting_transcript_artifacts(id,newsroom_id,video_id,sha256,captured_at) values
        (4,3,'meeting-1','old-hash',now()-interval '1 minute'),
        (5,3,'meeting-1','new-hash',now());
    `);
    const migration = await readFile(new URL("../../../migrations/0082_current_draft_transcript_link.sql", import.meta.url), "utf8");
    await db.exec(migration);
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
    await linkDraftToTranscript(sql, {
      newsroomId: 3, draftId: 41, artifactId: 4,
      citations: [{ segmentIndex: 7, captionSha256: "old-hash" }],
    });
    await db.query("update meeting_draft_transcript_links set revision_notice='The recording changed.' where artifact_id=4");
    await linkDraftToTranscript(sql, {
      newsroomId: 3, draftId: 41, artifactId: 5,
      citations: [{ segmentIndex: 7, captionSha256: "new-hash" }],
    });
    const links = (await db.query<{ artifact_id: number; is_current: boolean; revision_notice: string | null }>(
      "select artifact_id,is_current,revision_notice from meeting_draft_transcript_links order by artifact_id",
    )).rows;
    assert.deepEqual(links, [
      { artifact_id: 4, is_current: false, revision_notice: "The recording changed." },
      { artifact_id: 5, is_current: true, revision_notice: null },
    ]);
    assert.deepEqual(await staleMeetingCitations(sql, { newsroomId: 3, draftId: 41 }), []);
    const recorded = await recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 72, draftId: 41 });
    assert.equal(recorded.recorded, 1);
    const published = (await db.query<{ artifact_id: number; artifact_sha256: string }>(
      "select artifact_id,artifact_sha256 from meeting_article_transcript_links",
    )).rows;
    assert.deepEqual(published, [{ artifact_id: 5, artifact_sha256: "new-hash" }]);
  } finally {
    await db.close();
  }
});
