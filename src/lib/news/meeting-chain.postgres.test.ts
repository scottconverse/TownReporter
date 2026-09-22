import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import type { Sql } from "../db.ts";
import { integrationRequested, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";

/**
 * The meeting-to-draft chain, run against a REAL database.
 *
 * The units are covered by tests with fakes. This exercises the actual functions
 * against actually captured meetings, which is the only way to show the chain works
 * on real data rather than on a shape someone wrote to match it. Opt-in like the
 * other Postgres tests, because it needs a real server.
 *
 *   TEST_POSTGRES_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres node --experimental-strip-types --test src/lib/news/meeting-chain.postgres.test.ts
 */
const ADMIN = integrationRequested() ? resolveAdminUrl() : null;
const DEV_URL = ADMIN ? withDatabase(ADMIN, "townreporter_dev") : null;

function sqlFrom(client: Client): Sql {
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await client.query(text, params)).rows as T[];
  return sql;
}

describe("the meeting-to-draft chain on real captured data", { skip: ADMIN ? false : "TEST_POSTGRES_ADMIN_URL not set" }, () => {
  it("carries a real meeting to a linked draft, and guards publication", async () => {
    const client = new Client({ connectionString: DEV_URL! });
    await client.connect();
    const sql = sqlFrom(client);
    const q = String.fromCharCode(39);
    let leadId: number | null = null;
    let draftId: number | null = null;
    try {
      const meetings = await sql.query<{
        id: number; video_id: string; title: string; published: string | null; newsroom_id: number;
      }>(
        "select a.id, a.video_id, mcr.title, mcr.published, a.newsroom_id" +
        " from meeting_transcript_artifacts a" +
        " join meeting_capture_records mcr on mcr.video_id = a.video_id and mcr.newsroom_id = a.newsroom_id" +
        " where (select count(*) from meeting_agenda_chunks c where c.artifact_id = a.id) > 0" +
        " and (select count(*) from meeting_transcript_segments s where s.artifact_id = a.id) > 0" +
        " order by a.id limit 1");
      const meeting = meetings[0];
      assert.ok(meeting, "the dev database must contain an aligned captured meeting");
      const artifactId = Number(meeting!.id);
      const newsroomId = Number(meeting!.newsroom_id);

      const segments = await sql.query<{ segment_index: number; start_seconds: string; excerpt: string; caption_sha256: string }>(
        "select segment_index, start_seconds, excerpt, caption_sha256 from meeting_transcript_segments where artifact_id=$1 order by segment_index limit 6",
        [artifactId]);
      const chunks = await sql.query<{ item: string; title: string }>(
        "select item, title from meeting_agenda_chunks where artifact_id=$1 order by start_seconds limit 3",
        [artifactId]);
      const votes = await sql.query<{
        item: string; established: boolean; motion: string | null; mover: string | null;
        seconder: string | null; tally: string | null; result: string; source: string | null;
      }>("select item,established,motion,mover,seconder,tally,result,source from meeting_structured_votes where video_id=$1 order by item limit 3", [meeting!.video_id]);
      assert.ok(segments.length > 0 && chunks.length > 0, "a real aligned meeting has segments and chunks");

      const owners = await sql.query<{ user_id: string }>("select user_id from newsroom_members where newsroom_id=$1 limit 1", [newsroomId]);
      const userId = owners[0]!.user_id;

      const { fileMeetingLead } = await import("./meeting-lead.ts");
      const filed = await fileMeetingLead(sql, {
        newsroomId, userId, videoId: meeting!.video_id, title: meeting!.title,
        meetingDate: meeting!.published, topic: "council",
        sourceUrls: ["https://www.youtube.com/watch?v=" + meeting!.video_id],
        items: chunks.map((c) => ({ item: c.item, title: c.title })),
        establishedVotes: votes.filter((v) => v.established).length,
        citations: segments.map((s, i) => ({
          item: chunks[Math.min(i, chunks.length - 1)]!.item,
          segmentIndex: Number(s.segment_index),
          timestampSeconds: Number(s.start_seconds),
          excerpt: s.excerpt, captionSha256: s.caption_sha256,
        })),
        artifactId,
        votes: votes.map((v) => ({
          item: v.item, established: v.established, motion: v.motion, mover: v.mover,
          seconder: v.seconder, tally: v.tally, result: v.result, source: v.source,
        })),
      });
      leadId = filed.leadId;

      const stored = await sql.query<{ notes_json: string }>("select notes_json from leads where id=$1", [leadId]);
      const { parseNotes } = await import("./notes.ts");
      const notes = parseNotes(stored[0]!.notes_json);
      assert.equal(notes.meeting?.videoId, meeting!.video_id, "the meeting block must survive the round trip");
      assert.ok((notes.transcriptCitations ?? []).length > 0, "the citations must survive the round trip");
      assert.equal(notes.researchScope, "supplied", "supplied scope makes it draft from its own record");
      assert.match(notes.scratch ?? "", /MEETING:/, "the transcript evidence must reach the writer");

      const { deriveUsedCitations } = await import("./meeting-draft-citations.ts");
      const body = (notes.transcriptCitations ?? []).slice(0, 3).map((c) => c.excerpt).join(". ") + ".";
      const used = deriveUsedCitations({
        candidates: (notes.transcriptCitations ?? []).map((c) => ({
          item: c.item, segmentIndex: c.segmentIndex, captionSha256: c.captionSha256, excerpt: c.excerpt,
        })),
        headline: meeting!.title, dek: "", body,
      });
      assert.ok(used.length > 0, "a draft quoting the tape must derive citations from real data");

      const draftSql =
        "insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, research_json)" +
        " values ($1,$2,$3,$4," + q + q + ",$5," + q + "council" + q + "," + q + "[]" + q + "," + q + "{}" + q + ") returning id";
      const drafted = await sql.query<{ id: number }>(draftSql, [userId, newsroomId, leadId, meeting!.title, body]);
      draftId = Number(drafted[0]!.id);

      const { linkDraftToTranscript } = await import("./meeting-draft-transcript-link.ts");
      const linked = await linkDraftToTranscript(sql, { newsroomId, draftId, artifactId, citations: used });
      assert.equal(linked.linked, true, "the link must be written");
      const rows = await sql.query<{ n: number }>("select count(*)::int as n from meeting_draft_transcript_links where draft_id=$1", [draftId]);
      assert.equal(Number(rows[0]!.n), 1, "exactly one link row for the draft and artifact");

      const { staleMeetingCitations } = await import("./meeting-publish-guard.ts");
      const unchanged = await staleMeetingCitations(sql, { newsroomId, draftId, citations: used });
      assert.deepEqual(unchanged, [], "an unchanged tape must not block the editor");
      const moved = await staleMeetingCitations(sql, {
        newsroomId, draftId,
        citations: used.map((c) => ({ ...c, captionSha256: "a-different-hash" })),
      });
      assert.ok(moved.length > 0, "a draft against a moved tape must be blocked");
    } finally {
      if (leadId) await client.query("delete from leads where id=$1", [leadId]);
      if (draftId) await client.query("delete from drafts where id=$1", [draftId]);
      await client.end();
    }
  });
});
