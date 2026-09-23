import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { createServer, type ViteDevServer } from "vite";
import type { Sql } from "../db.ts";
import type { DeskJob } from "./jobs.ts";
import type { ReportedDraftResult } from "./desk-model-run.ts";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this against a disposable database" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_test_meeting_chain_${process.pid}_${Date.now()}`;
const dbUrl = probe.ok ? withDatabase(adminUrl, dbName) : "";
const newsroomId = 910001;
const userId = "meeting-chain-editor";
const videoId = "meet0000001";
const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-meeting-chain-"));
const originalDatabaseUrl = process.env.DATABASE_URL;
let created = false;
let vite: ViteDevServer;
let sql: Sql;
let runMeetingAwareness: typeof import("./meeting-capture.ts").runMeetingAwareness;
let recheckProvisionalMeetings: typeof import("./meeting-capture.ts").recheckProvisionalMeetings;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let performPublish: typeof import("./desk.ts").performPublish;
let closePoolForTests: typeof import("../db.ts").closePoolForTests;

function capturedCaption(label: "a" | "b") {
  const text = label === "a"
    ? "Council approves the housing plan."
    : "Council delays the housing plan for another hearing.";
  const sourcePath = join(storageRoot, `capture-${label}.vtt`);
  const infoPath = join(storageRoot, `capture-${label}.info.json`);
  writeFileSync(sourcePath, text, "utf8");
  writeFileSync(infoPath, JSON.stringify({ id: videoId, revision: label }), "utf8");
  return { text, sourcePath, infoPath, sha256: createHash("sha256").update(text).digest("hex") };
}

function section5For(caption: ReturnType<typeof capturedCaption>) {
  return async () => ({
    aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 1, unalignedLead: null,
    items: [{ item: "4", title: "Housing plan", startSeconds: 0 }],
    votes: [{ item: "4", established: true, motion: "Approve the housing plan", mover: "A", seconder: "B", tally: "6-1", result: "Passed", source: "structured-vote-record", provenance: [], disagreements: [] }],
    citations: [{ item: "4", segmentIndex: 0, timestampSeconds: 0, endSeconds: 4, excerpt: caption.text, captionSha256: caption.sha256, storagePath: caption.sourcePath }],
  });
}

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try { await admin.query(`create database ${dbName}`); created = true; } finally { await admin.end(); }
    execFileSync(process.execPath, ["scripts/migrate.mjs"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit" });
    process.env.DATABASE_URL = dbUrl;
    vite = await createServer({ configFile: false, cacheDir: join(tmpdir(), `townreporter-meeting-chain-vite-${process.pid}`), server: { middlewareMode: true, hmr: { port: 0 } }, resolve: { alias: { "@": join(process.cwd(), "src") } } });
    const db = await vite.ssrLoadModule("/src/lib/db.ts");
    sql = await db.getSql();
    closePoolForTests = db.closePoolForTests;
    ({ runMeetingAwareness, recheckProvisionalMeetings } = await vite.ssrLoadModule("/src/lib/news/meeting-capture.ts"));
    ({ performDraftWork, performPublish } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
    await sql.query("insert into newsrooms(id,name) values($1,'Meeting chain')", [newsroomId]);
    await sql.query("insert into newsroom_members(newsroom_id,user_id,role) values($1,$2,'owner')", [newsroomId, userId]);
    await sql.query("insert into meeting_capture_settings(newsroom_id,storage_root,retention_mode,enabled) values($1,$2,'transcript-only',true)", [newsroomId, storageRoot]);
    await sql.query("insert into meeting_channel_priority(newsroom_id,channel_url,position) values($1,'https://youtube.com/@city',0)", [newsroomId]);
  });

  after(async () => {
    await closePoolForTests?.();
    await vite?.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (created) {
      const admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [dbName]);
        await admin.query(`drop database ${dbName}`);
      } finally { await admin.end(); }
    }
    rmSync(storageRoot, { recursive: true, force: true });
  });
}

describe("meeting chain uses real application entrypoints in its own disposable PostgreSQL database", { skip }, () => {
  it("captures A, files the lead, drafts and publishes it, then preserves A and flags B", async () => {
    console.log(`meeting chain scratch database: ${dbName}`);
    const captionA = capturedCaption("a");
    const listed = [{ id: videoId, title: "City Council", published: "2026-09-22", url: `https://www.youtube.com/watch?v=${videoId}`, duration: 300, tab: "streams" as const }];
    const capturedA = await runMeetingAwareness(sql, newsroomId, {
      listChannelVideos: async () => listed,
      captureMeeting: async () => ({ ok: true as const, parsed: { text: captionA.text, format: "vtt" as const, sha256: captionA.sha256, sourcePath: captionA.sourcePath }, infoPath: captionA.infoPath, info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 1 }, argv: [], stdout: "", stderr: "" }),
      runSection5: section5For(captionA),
      now: () => new Date("2026-09-22T12:10:00Z"),
    });
    assert.equal(capturedA.failures.length, 0);
    const [lead] = await sql.query<{ id: number }>("select id from leads where newsroom_id=$1 and meeting_video_id=$2", [newsroomId, videoId]);
    assert.ok(lead?.id, "the real capture path must file the meeting lead");
    const [jobRow] = await sql.query<{ id: number }>("insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'draft',$3,'local-model','editor','supplied','default','running','Drafting','meeting-chain-claim') returning id", [userId, newsroomId, lead.id]);
    const job = { id: jobRow!.id, newsroom_id: newsroomId, user_id: userId, kind: "draft", subject_id: lead.id, model_choice: "local-model", model_choice_source: "editor", research_scope: "supplied", lane: "default", status: "running", stage: "Drafting", claim_token: "meeting-chain-claim" } as DeskJob;
    const reported = { headline: "Council approves housing plan", dek: "The council voted Tuesday.", body: captionA.text, topic: "council", source_urls: [`https://www.youtube.com/watch?v=${videoId}`], integrity_notes: "", memory_entities: [], form: "news", provenance: [], found_note: "", findings: [], unanswered: [], claims: [], research_memo: {} } as ReportedDraftResult;
    await performDraftWork(job, { readStoryDocuments: async () => "", reportAndDraft: async () => reported, setJobStage: async () => undefined });
    const [draftA] = await sql.query<{ id: number }>("select id from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1", [newsroomId, lead.id]);
    const [linkA] = await sql.query<{ artifact_id: number; citation_snapshot: string }>("select artifact_id,citation_snapshot from meeting_draft_transcript_links where newsroom_id=$1 and draft_id=$2", [newsroomId, draftA!.id]);
    assert.ok(linkA?.artifact_id, "the real draft worker must persist the used-citation snapshot");
    const published = await performPublish({ userId, newsroomId }, lead.id);
    assert.equal(published.ok, true);
    const [articleA] = await sql.query<{ id: number; body: string }>("select id,body from articles where newsroom_id=$1 and lead_id=$2", [newsroomId, lead.id]);
    assert.equal(articleA!.body, captionA.text);
    const [publicationA] = await sql.query<{ artifact_id: number; artifact_sha256: string; citation_snapshot: string }>("select artifact_id,artifact_sha256,citation_snapshot from meeting_article_transcript_links where newsroom_id=$1 and article_id=$2", [newsroomId, articleA!.id]);
    assert.equal(publicationA!.artifact_sha256, captionA.sha256);

    const captionB = capturedCaption("b");
    const revised = await recheckProvisionalMeetings(sql, newsroomId, {
      captureMeeting: async () => ({ ok: true as const, parsed: { text: captionB.text, format: "vtt" as const, sha256: captionB.sha256, sourcePath: captionB.sourcePath }, infoPath: captionB.infoPath, info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 2 }, argv: [], stdout: "", stderr: "" }),
      runSection5: section5For(captionB),
      now: () => new Date("2026-09-22T12:20:00Z"),
    });
    assert.equal(revised.revised, 1);
    assert.deepEqual(revised.failures, []);
    const artifacts = await sql.query<{ id: number; sha256: string; storage_path: string }>("select id,sha256,storage_path from meeting_transcript_artifacts where newsroom_id=$1 and video_id=$2 order by id", [newsroomId, videoId]);
    assert.equal(artifacts.length, 2);
    assert.notEqual(artifacts[0]!.storage_path, artifacts[1]!.storage_path);
    const [articleAfterB] = await sql.query<{ body: string }>("select body from articles where id=$1", [articleA!.id]);
    assert.equal(articleAfterB!.body, captionA.text, "B must never rewrite the published A article");
    const [publicationAfterB] = await sql.query<{ artifact_id: number; artifact_sha256: string; citation_snapshot: string }>("select artifact_id,artifact_sha256,citation_snapshot from meeting_article_transcript_links where article_id=$1", [articleA!.id]);
    assert.deepEqual(publicationAfterB, publicationA, "B must preserve the exact A publication provenance");
    const reviews = await sql.query<{ prior_artifact_id: number; current_artifact_id: number; status: string }>("select prior_artifact_id,current_artifact_id,status from meeting_article_revision_reviews where newsroom_id=$1 and article_id=$2", [newsroomId, articleA!.id]);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]!.prior_artifact_id, publicationA!.artifact_id);
    assert.equal(reviews[0]!.current_artifact_id, artifacts[1]!.id);
    assert.equal(reviews[0]!.status, "pending");
  });
});
