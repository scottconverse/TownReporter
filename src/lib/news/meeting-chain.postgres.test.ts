import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import type { Sql } from "../db.ts";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this against a disposable database" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_test_meeting_chain_${process.pid}_${Date.now()}`;
const dbUrl = probe.ok ? withDatabase(adminUrl, dbName) : "";
const newsroomId = 910001;
let created = false;
let client: Client;

function sqlFrom(connection: Client): Sql {
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await connection.query(text, params)).rows as T[];
  return sql;
}

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${dbName}`);
      created = true;
    } finally {
      await admin.end();
    }
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit",
    });
    client = new Client({ connectionString: dbUrl });
    await client.connect();
    await client.query("insert into newsrooms(id,name) values($1,'Meeting chain')", [newsroomId]);
    await client.query("insert into newsroom_members(newsroom_id,user_id,role) values($1,'editor','owner')", [newsroomId]);
    await client.query("insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,caption_sha256,capture_disposition) values($1,'meeting-1','https://youtube.com/@city','City Council','2026-09-22','captured','hash-a','provisional')", [newsroomId]);
    const artifact = await client.query<{ id: number }>("insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,captured_at) values($1,'meeting-1','C:/scratch/a.vtt','vtt','hash-a','captions','transcript-only',now()-interval '1 minute') returning id", [newsroomId]);
    const artifactId = artifact.rows[0]!.id;
    await client.query("insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,excerpt,caption_sha256) values($1,7,12,16,'Council approves the plan.','hash-a')", [artifactId]);
    await client.query("insert into meeting_agenda_chunks(newsroom_id,video_id,artifact_id,item,title,start_seconds,end_seconds,segment_indexes) values($1,'meeting-1',$2,'4','Housing plan',0,30,'[7]')", [newsroomId, artifactId]);
  });
  after(async () => {
    await client?.end();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [dbName]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

describe("meeting chain uses its own disposable PostgreSQL database", { skip }, () => {
  it("files, links, and blocks an A-based draft after a real B artifact appears", async () => {
    console.log(`meeting chain scratch database: ${dbName}`);
    const sql = sqlFrom(client);
    const [{ id: artifactA }] = await sql.query<{ id: number }>("select id from meeting_transcript_artifacts where video_id='meeting-1'");
    const { fileMeetingLead } = await import("./meeting-lead.ts");
    const filed = await fileMeetingLead(sql, {
      newsroomId, userId: "editor", videoId: "meeting-1", title: "City Council",
      meetingDate: "2026-09-22", topic: "council", sourceUrls: ["https://youtube.com/watch?v=meeting-1"],
      items: [{ item: "4", title: "Housing plan" }], establishedVotes: 0,
      citations: [{ item: "4", segmentIndex: 7, timestampSeconds: 12, excerpt: "Council approves the plan.", captionSha256: "hash-a" }],
      artifactId: artifactA, votes: [],
    });
    const [draft] = await sql.query<{ id: number }>(
      "insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic,source_urls,research_json) values('editor',$1,$2,'Council approves plan','Council approves the plan.','council','[]','{}') returning id",
      [newsroomId, filed.leadId],
    );
    const { linkDraftToTranscript } = await import("./meeting-draft-transcript-link.ts");
    await linkDraftToTranscript(sql, { newsroomId, draftId: draft.id, artifactId: artifactA, citations: [{ segmentIndex: 7, captionSha256: "hash-a" }] });
    const { staleMeetingCitations } = await import("./meeting-publish-guard.ts");
    assert.deepEqual(await staleMeetingCitations(sql, { newsroomId, draftId: draft.id }), []);

    const [{ id: artifactB }] = await sql.query<{ id: number }>(
      "insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,captured_at) values($1,'meeting-1','C:/scratch/b.vtt','vtt','hash-b','captions','transcript-only',now()) returning id",
      [newsroomId],
    );
    await sql.query("insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,excerpt,caption_sha256) values($1,7,12,16,'Council delays the plan.','hash-b')", [artifactB]);
    const { applyDraftRevision } = await import("./meeting-revision.ts");
    await applyDraftRevision(sql, { newsroomId, videoId: "meeting-1", previousSha256: "hash-a", nextSha256: "hash-b" });
    const stale = await staleMeetingCitations(sql, { newsroomId, draftId: draft.id });
    assert.equal(stale.length, 1);
    assert.equal(stale[0]!.current, "hash-b");
  });
});
