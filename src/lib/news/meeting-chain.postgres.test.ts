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
import { persistSection5 } from "./meeting-story-section5-persist.ts";
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
let applyCapturedMeetingTranscript: typeof import("./meeting-capture.ts").applyCapturedMeetingTranscript;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;
let closePoolForTests: typeof import("../db.ts").closePoolForTests;

function capturedCaption(label: "a" | "b", captureVideoId = videoId) {
  const text = label === "a"
    ? "Council approves the housing plan."
    : "Council delayed the housing plan.";
  const sourcePath = join(storageRoot, `capture-${label}.vtt`);
  const infoPath = join(storageRoot, `capture-${label}.info.json`);
  writeFileSync(sourcePath, text, "utf8");
  writeFileSync(infoPath, JSON.stringify({ id: captureVideoId, revision: label }), "utf8");
  return { text, sourcePath, infoPath, sha256: createHash("sha256").update(text).digest("hex") };
}

function section5For(caption: ReturnType<typeof capturedCaption>) {
  return async (sectionSql: Sql, input: { newsroomId: number; videoId: string; artifactId: number }) => {
    const segments = await sectionSql.query<{ segment_index: number; start_seconds: number; end_seconds: number }>(
      "select segment_index,start_seconds,end_seconds from meeting_transcript_segments where artifact_id=$1 order by segment_index",
      [input.artifactId],
    );
    assert.ok(segments.length, "the real capture path must persist transcript segments before section 5");
    const chunk = {
      item: "4",
      title: "Housing plan",
      startSeconds: Number(segments[0]!.start_seconds),
      endSeconds: Number(segments.at(-1)!.end_seconds),
      segmentIndexes: segments.map((segment) => segment.segment_index),
    };
    const vote = {
      item: "4", established: true, motion: "Approve the housing plan", mover: "A", seconder: "B",
      tally: "6-1", result: "Passed", source: "longmontcitycouncil.org" as const,
      provenance: [], disagreements: [],
    };
    await persistSection5(sectionSql, {
      newsroomId: input.newsroomId,
      videoId: input.videoId,
      artifactId: input.artifactId,
      chunks: [chunk],
      alignment: { aligned: true, reason: null, chunks: [chunk] },
      votes: [vote],
    });
    return {
      aligned: true, alignmentReason: null, chunkCount: 1, voteCount: 1, unalignedLead: null,
      items: [{ item: "4", title: "Housing plan", startSeconds: chunk.startSeconds, excerpt: caption.text }],
      votes: [vote],
      citations: segments.map((segment) => ({
        item: "4", segmentIndex: segment.segment_index, timestampSeconds: Number(segment.start_seconds),
        endSeconds: Number(segment.end_seconds), excerpt: caption.text,
        captionSha256: caption.sha256, storagePath: caption.sourcePath,
      })),
    };
  };
}

/**
 * An editor confirming the section for the draft the desk is showing.
 *
 * Publication refuses while the section is unconfirmed (desk.ts), and the
 * desk's Publish button is disabled until a person reads the section and says
 * yes. A walkthrough that publishes has to do what the person does, so this
 * calls the real entrypoint behind the desk's "Confirm this section" control --
 * it reads the lead's current draft, takes the section that draft carries and
 * records the confirmation against that exact draft version. Confirming, then
 * rewriting the story, does not carry; see the publish gate's own tests.
 */
async function confirmSectionForCurrentDraft(leadId: number) {
  const confirmed = await performConfirmDraftTopic({ userId, newsroomId }, leadId);
  assert.equal(confirmed.ok, true, "the editor's section confirmation must be recorded");
  return confirmed.ok ? confirmed.topic : "";
}

const housingStoryFocus = {
  candidateId: "housing-plan",
  summary: "Council approves the housing plan.",
  why: "The recorded decision changes the plan's status.",
  segmentIndexes: [0],
  visibleSegmentIndexes: [0],
  anchorSegmentIndexes: [0],
  voteOutcome: "carried" as const,
};

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      console.log(`[meeting chain] creating disposable PostgreSQL database: ${dbName}`);
      await admin.query(`create database ${dbName}`);
      created = true;
    } finally { await admin.end(); }
    execFileSync(process.execPath, ["scripts/migrate.mjs"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "inherit" });
    process.env.DATABASE_URL = dbUrl;
    vite = await createServer({ configFile: false, cacheDir: join(tmpdir(), `townreporter-meeting-chain-vite-${process.pid}`), server: { middlewareMode: true, hmr: { port: 0 } }, resolve: { alias: { "@": join(process.cwd(), "src") } } });
    const db = await vite.ssrLoadModule("/src/lib/db.ts");
    sql = await db.getSql();
    closePoolForTests = db.closePoolForTests;
    ({ runMeetingAwareness, recheckProvisionalMeetings, applyCapturedMeetingTranscript } = await vite.ssrLoadModule("/src/lib/news/meeting-capture.ts"));
    ({ performDraftWork, performPublish, performConfirmDraftTopic } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
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
    const reported = { headline: "Council approves housing plan", dek: "The council voted Tuesday.", body: captionA.text, topic: "council", source_urls: [`https://www.youtube.com/watch?v=${videoId}`], integrity_notes: "", memory_entities: [], form: "news", provenance: [], found_note: "", findings: [], unanswered: [], claims: [], research_memo: { meetingFocus: housingStoryFocus } } as unknown as ReportedDraftResult;
    await performDraftWork(job, { readStoryDocuments: async () => "", reportAndDraft: async () => reported, setJobStage: async () => undefined });
    const [draftA] = await sql.query<{ id: number; research_json: string }>("select id,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1", [newsroomId, lead.id]);
    assert.equal(JSON.parse(draftA!.research_json).meetingEvidence?.used, true, "a missing transcript link must block publication for this draft");
    const [linkA] = await sql.query<{ artifact_id: number; citation_snapshot: string }>("select artifact_id,citation_snapshot from meeting_draft_transcript_links where newsroom_id=$1 and draft_id=$2", [newsroomId, draftA!.id]);
    assert.ok(linkA?.artifact_id, "the real draft worker must persist the used-citation snapshot");
    // Migration 0078 archives historical orphans but intentionally keeps their
    // original rows. Recreate that legacy state in this disposable database to
    // prove a revision never creates work for a draft that no longer exists.
    await sql.query("alter table meeting_draft_transcript_links drop constraint meeting_draft_transcript_links_draft_id_fkey");
    const [orphan] = await sql.query<{ id: number }>(
      "insert into meeting_draft_transcript_links(newsroom_id,draft_id,artifact_id,citation_snapshot,is_current) values($1,99999999,$2,$3,true) returning id",
      [newsroomId, linkA!.artifact_id, linkA!.citation_snapshot],
    );
    await sql.query("alter table meeting_draft_transcript_links add constraint meeting_draft_transcript_links_draft_id_fkey foreign key(draft_id) references drafts(id) on delete cascade not valid");
    const [receipt] = await sql.query<{ result_json: string }>("select result_json from desk_jobs where id=$1", [job.id]);
    assert.equal(JSON.parse(receipt!.result_json).quality?.citationStatus, "complete", "the saved transcript link must count as a real citation");
    // The desk will not print a section nobody read. The editor confirms the
    // section the workbench is showing for this draft, then prints it.
    await confirmSectionForCurrentDraft(lead.id);
    const published = await performPublish({ userId, newsroomId }, lead.id);
    assert.equal(published.ok, true);
    const [articleA] = await sql.query<{ id: number; body: string }>("select id,body from articles where newsroom_id=$1 and lead_id=$2", [newsroomId, lead.id]);
    assert.equal(articleA!.body, captionA.text);
    const [publicationA] = await sql.query<{ artifact_id: number; artifact_sha256: string; citation_snapshot: string }>("select artifact_id,artifact_sha256,citation_snapshot from meeting_article_transcript_links where newsroom_id=$1 and article_id=$2", [newsroomId, articleA!.id]);
    assert.equal(publicationA!.artifact_sha256, captionA.sha256);

    // Re-fetch the same real artifact through the actual PostgreSQL capture
    // path. The capture ledger may advance its check counters, but no editor
    // work item or published record may be duplicated or rewritten.
    const editorState = async () => {
      const names = new Set([
        "leads", "drafts", "desk_jobs", "articles", "meeting_transcript_revisions",
        "meeting_draft_transcript_links", "meeting_article_transcript_links", "meeting_article_revision_reviews",
      ]);
      const discovered = await sql.query<{ table_name: string }>(
        `select distinct table_name from information_schema.columns
          where table_schema=current_schema() and column_name='newsroom_id'
            and table_name ~* '(assignment|notification)' order by table_name`,
      );
      for (const row of discovered) names.add(row.table_name);
      const state: Record<string, unknown[]> = {};
      for (const name of [...names].sort()) {
        const [exists] = await sql.query<{ present: boolean }>(
          "select to_regclass($1) is not null as present", [`public.${name}`],
        );
        if (!exists?.present) continue;
        const quoted = `"${name.replaceAll('"', '""')}"`;
        const rows = await sql.query<{ row_json: unknown }>(
          `select to_jsonb(r) as row_json from ${quoted} r where r.newsroom_id=$1 order by to_jsonb(r)::text`,
          [newsroomId],
        );
        state[name] = rows.map((row) => row.row_json);
      }
      return state;
    };
    const editorStateBeforeUnchangedCheck = await editorState();
    const unchanged = await recheckProvisionalMeetings(sql, newsroomId, {
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: captionA.text, format: "vtt" as const, sha256: captionA.sha256, sourcePath: captionA.sourcePath },
        infoPath: captionA.infoPath,
        info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 1 },
        argv: [], stdout: "", stderr: "",
      }),
      runSection5: section5For(captionA),
      now: () => new Date("2026-09-22T15:20:00Z"),
    });
    assert.equal(unchanged.checked, 1);
    assert.equal(unchanged.revised, 0);
    assert.deepEqual(unchanged.failures, []);
    assert.deepEqual(await editorState(), editorStateBeforeUnchangedCheck,
      "an unchanged real DB recheck must leave leads/assignments, drafts/jobs, notifications, revisions and published records byte-for-byte equivalent as rows");

    const captionB = capturedCaption("b");
    const revised = await recheckProvisionalMeetings(sql, newsroomId, {
      captureMeeting: async () => ({ ok: true as const, parsed: { text: captionB.text, format: "vtt" as const, sha256: captionB.sha256, sourcePath: captionB.sourcePath }, infoPath: captionB.infoPath, info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 2 }, argv: [], stdout: "", stderr: "" }),
      runSection5: section5For(captionB),
      // The production cadence is three hours. The canonical first-capture
      // path now records last_checked_at, so prove B through a genuinely due
      // recheck instead of depending on the old missing-timestamp defect.
      now: () => new Date("2026-09-22T18:30:00Z"),
    });
    assert.equal(revised.revised, 1);
    assert.deepEqual(revised.failures, []);
    const [orphanAfterB] = await sql.query<{ revision_notice: string | null }>("select revision_notice from meeting_draft_transcript_links where id=$1", [orphan!.id]);
    assert.equal(orphanAfterB!.revision_notice, null, "a preserved historical orphan must not receive a draft revision notice");
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

  it("blocks an A-linked draft when capture B wins the fence, then redrafts and publishes against B", async () => {
    const secondVideoId = "meet0000002";
    const captionA = capturedCaption("a", secondVideoId);
    const video = {
      id: secondVideoId,
      channelUrl: "https://youtube.com/@city",
      title: "City Council",
      published: "2026-09-22",
    };
    const listed = [{ ...video, url: `https://www.youtube.com/watch?v=${secondVideoId}`, duration: 300, tab: "streams" as const }];
    const captured = await runMeetingAwareness(sql, newsroomId, {
      listChannelVideos: async () => listed,
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: captionA.text, format: "vtt" as const, sha256: captionA.sha256, sourcePath: captionA.sourcePath },
        infoPath: captionA.infoPath,
        info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 1 },
        argv: [], stdout: "", stderr: "",
      }),
      runSection5: section5For(captionA),
      now: () => new Date("2026-09-22T12:10:00Z"),
    });
    assert.equal(captured.failures.length, 0);
    const [lead] = await sql.query<{ id: number }>(
      "select id from leads where newsroom_id=$1 and meeting_video_id=$2",
      [newsroomId, secondVideoId],
    );
    assert.ok(lead?.id);

    const draftFrom = async (label: "a" | "b", caption: ReturnType<typeof capturedCaption>) => {
      const claimToken = `meeting-chain-${secondVideoId}-${label}`;
      const [jobRow] = await sql.query<{ id: number }>(
        "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'draft',$3,'local-model','editor','supplied','default','running','Drafting',$4) returning id",
        [userId, newsroomId, lead!.id, claimToken],
      );
      const job = {
        id: jobRow!.id, newsroom_id: newsroomId, user_id: userId, kind: "draft", subject_id: lead!.id,
        model_choice: "local-model", model_choice_source: "editor", research_scope: "supplied", lane: "default",
        status: "running", stage: "Drafting", claim_token: claimToken,
      } as DeskJob;
      const reported = {
        headline: label === "a" ? "Council approves housing plan" : "Council delays housing plan",
        dek: label === "a" ? "The council approved the plan Tuesday." : "The council delayed the plan Tuesday.",
        body: caption.text,
        topic: "council",
        source_urls: [`https://www.youtube.com/watch?v=${secondVideoId}`],
        integrity_notes: "", memory_entities: [], form: "news", provenance: [], found_note: "",
        findings: [], unanswered: [], claims: [], research_memo: { meetingFocus: housingStoryFocus },
      } as unknown as ReportedDraftResult;
      await performDraftWork(job, {
        readStoryDocuments: async () => "",
        reportAndDraft: async () => reported,
        setJobStage: async () => undefined,
      });
      const [draft] = await sql.query<{ id: number; research_json: string }>(
        "select id,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by updated_at desc,id desc limit 1",
        [newsroomId, lead!.id],
      );
      assert.equal(JSON.parse(draft!.research_json).meetingEvidence?.used, true);
      const [link] = await sql.query<{ artifact_id: number; citation_snapshot: string }>(
        "select artifact_id,citation_snapshot from meeting_draft_transcript_links where newsroom_id=$1 and draft_id=$2 and is_current=true",
        [newsroomId, draft!.id],
      );
      assert.ok(link?.artifact_id);
      assert.ok(JSON.parse(link!.citation_snapshot).length > 0, "the saved draft must carry its actually used transcript citation");
      return { draftId: draft!.id, artifactId: link!.artifact_id };
    };

    const draftA = await draftFrom("a", captionA);
    // Draft A is the draft on screen, so this is the section the editor reads
    // and confirms. The stale publish below must therefore reach the meeting
    // fence -- it is refused for quoting a superseded recording, not for an
    // unread section.
    await confirmSectionForCurrentDraft(lead!.id);
    let enterSection5!: () => void;
    let releaseSection5!: () => void;
    const section5Entered = new Promise<void>((resolve) => { enterSection5 = resolve; });
    const holdSection5 = new Promise<void>((resolve) => { releaseSection5 = resolve; });
    let section5WasEntered = false;
    const captionB = capturedCaption("b", secondVideoId);
    const resultB = {
      ok: true as const,
      parsed: { text: captionB.text, format: "vtt" as const, sha256: captionB.sha256, sourcePath: captionB.sourcePath },
      infoPath: captionB.infoPath,
      info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 2 },
      argv: [], stdout: "", stderr: "",
    };
    const captureB = applyCapturedMeetingTranscript(sql, {
      newsroomId,
      userId,
      video,
      result: resultB,
      now: new Date("2026-09-22T15:20:00Z"),
    }, {
      runSection5: async (captureSql, input) => {
        const result = await section5For(captionB)(captureSql, {
          newsroomId: input.newsroomId,
          videoId: input.videoId,
          artifactId: input.artifactId,
        });
        // Section 5 executes inside capture's transaction after the common
        // lead and meeting locks are held. Pause here to create a real race.
        section5WasEntered = true;
        enterSection5();
        await holdSection5;
        return result;
      },
    }).catch((error: unknown) => {
      if (!section5WasEntered) enterSection5();
      throw error;
    });
    await section5Entered;

    let stalePublishSettled = false;
    const stalePublish = performPublish({ userId, newsroomId }, lead!.id).then(
      (result) => { stalePublishSettled = true; return result; },
      (error: unknown) => { stalePublishSettled = true; return error; },
    );
    const monitor = new Client({ connectionString: dbUrl });
    await monitor.connect();
    try {
      let observedWaiter = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await monitor.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'",
        );
        if (Number(waiting.rows[0]?.n) > 0) { observedWaiter = true; break; }
        if (stalePublishSettled) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(observedWaiter, true, "the real publication entrypoint must be waiting on capture's PostgreSQL fence");
    } finally {
      // Always release the test barrier so a failing assertion cannot strand
      // the app transaction or the disposable database cleanup hook.
      releaseSection5();
      await monitor.end();
    }
    const appliedB = await captureB;
    assert.equal(appliedB.revised, true);
    const [leadAfterB] = await sql.query<{ meeting_artifact_id: number }>(
      "select meeting_artifact_id from leads where newsroom_id=$1 and id=$2",
      [newsroomId, lead!.id],
    );
    assert.equal(leadAfterB!.meeting_artifact_id, appliedB.artifactId, "the meeting lead must advance to the captured B artifact before redrafting");
    const staleResult = await stalePublish;
    assert.ok(
      staleResult instanceof Error || (typeof staleResult === "object" && staleResult !== null && "ok" in staleResult && staleResult.ok === false),
      "after B commits, the A-linked draft must be rejected",
    );
    /*
      B's revision did not only put a notice on the link: meeting-revision.ts
      rewrites the draft's research_json in the same breath, and a section
      confirmation is recorded against exactly that identity. So the
      confirmation taken before B does not cover the row that exists now, and
      the editor re-reads and re-confirms the version on screen before trying
      again -- otherwise this retry stops at the section gate and the
      current-artifact guard these assertions exist for is never reached.
    */
    await confirmSectionForCurrentDraft(lead!.id);
    const blockedAAfterB = await performPublish({ userId, newsroomId }, lead!.id);
    assert.equal(blockedAAfterB.ok, false, "a retry after B commits must reach and fail the current-artifact publication guard");
    if (!blockedAAfterB.ok) assert.match(blockedAAfterB.error, /recording this draft quotes has changed/i);
    const existingArticles = await sql.query<{ n: number }>(
      "select count(*)::int as n from articles where newsroom_id=$1 and lead_id=$2 and status='published'",
      [newsroomId, lead!.id],
    );
    assert.equal(existingArticles[0]!.n, 0, "a rejected A-linked draft must not create an article");

    const draftB = await draftFrom("b", captionB);
    assert.notEqual(draftB.draftId, draftA.draftId);
    assert.notEqual(draftB.artifactId, draftA.artifactId);
    // The redraft is a different version, so A's confirmation does not cover
    // it: the editor reads B's section and confirms that one before printing.
    await confirmSectionForCurrentDraft(lead!.id);
    const publishedB = await performPublish({ userId, newsroomId }, lead!.id);
    assert.equal(publishedB.ok, true);
    const [article] = await sql.query<{ id: number; body: string }>(
      "select id,body from articles where newsroom_id=$1 and lead_id=$2 and status='published'",
      [newsroomId, lead!.id],
    );
    assert.equal(article!.body, captionB.text);
    const [publishedEvidence] = await sql.query<{ artifact_id: number; artifact_sha256: string }>(
      "select artifact_id,artifact_sha256 from meeting_article_transcript_links where newsroom_id=$1 and article_id=$2",
      [newsroomId, article!.id],
    );
    assert.equal(publishedEvidence!.artifact_id, draftB.artifactId);
    assert.equal(publishedEvidence!.artifact_sha256, captionB.sha256);
  });

  it("publishes A through the real desk entrypoint before a waiting real B capture flags review", async () => {
    const publicationFirstVideoId = "meet0000003";
    const captionA = capturedCaption("a", publicationFirstVideoId);
    const video = {
      id: publicationFirstVideoId,
      channelUrl: "https://youtube.com/@city",
      title: "City Council",
      published: "2026-09-22",
    };
    const listed = [{ ...video, url: `https://www.youtube.com/watch?v=${publicationFirstVideoId}`, duration: 300, tab: "streams" as const }];
    const captured = await runMeetingAwareness(sql, newsroomId, {
      listChannelVideos: async () => listed,
      captureMeeting: async () => ({
        ok: true as const,
        parsed: { text: captionA.text, format: "vtt" as const, sha256: captionA.sha256, sourcePath: captionA.sourcePath },
        infoPath: captionA.infoPath,
        info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 1 },
        argv: [], stdout: "", stderr: "",
      }),
      runSection5: section5For(captionA),
      now: () => new Date("2026-09-22T12:10:00Z"),
    });
    assert.deepEqual(captured.failures, []);
    const [lead] = await sql.query<{ id: number }>(
      "select id from leads where newsroom_id=$1 and meeting_video_id=$2",
      [newsroomId, publicationFirstVideoId],
    );
    assert.ok(lead?.id);

    const claimToken = `meeting-chain-${publicationFirstVideoId}-a`;
    const [jobRow] = await sql.query<{ id: number }>(
      "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'draft',$3,'local-model','editor','supplied','default','running','Drafting',$4) returning id",
      [userId, newsroomId, lead!.id, claimToken],
    );
    const job = {
      id: jobRow!.id, newsroom_id: newsroomId, user_id: userId, kind: "draft", subject_id: lead!.id,
      model_choice: "local-model", model_choice_source: "editor", research_scope: "supplied", lane: "default",
      status: "running", stage: "Drafting", claim_token: claimToken,
    } as DeskJob;
    const reported = {
      headline: "Council approves housing plan",
      dek: "The council approved the plan Tuesday.",
      body: captionA.text,
      topic: "council",
      source_urls: [`https://www.youtube.com/watch?v=${publicationFirstVideoId}`],
      integrity_notes: "", memory_entities: [], form: "news", provenance: [], found_note: "",
      findings: [], unanswered: [], claims: [], research_memo: { meetingFocus: housingStoryFocus },
    } as unknown as ReportedDraftResult;
    await performDraftWork(job, { readStoryDocuments: async () => "", reportAndDraft: async () => reported, setJobStage: async () => undefined });
    const [draft] = await sql.query<{ id: number; research_json: string }>(
      "select id,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by updated_at desc,id desc limit 1",
      [newsroomId, lead!.id],
    );
    assert.equal(JSON.parse(draft!.research_json).meetingEvidence?.used, true);
    const [draftEvidence] = await sql.query<{ artifact_id: number; citation_snapshot: string }>(
      "select artifact_id,citation_snapshot from meeting_draft_transcript_links where newsroom_id=$1 and draft_id=$2 and is_current=true",
      [newsroomId, draft!.id],
    );
    assert.ok(draftEvidence?.artifact_id);
    assert.ok(JSON.parse(draftEvidence!.citation_snapshot).length > 0);
    // The editor confirms this draft's section before printing. Without it the
    // publish returns at the section gate instead of holding the meeting lock,
    // and the fence this test exists to prove would never be reached.
    await confirmSectionForCurrentDraft(lead!.id);

    const triggerSuffix = `${process.pid}_${Date.now()}`;
    const triggerName = `tr_pause_publish_${triggerSuffix}`;
    const functionName = `fn_pause_publish_${triggerSuffix}`;
    await sql.query(`create function ${functionName}() returns trigger language plpgsql as $$ begin perform pg_sleep(3); return new; end $$`);
    await sql.query(`create trigger ${triggerName} before insert on articles for each row execute function ${functionName}()`);

    const monitor = new Client({ connectionString: dbUrl });
    await monitor.connect();
    let publishPromise: Promise<{ ok: true; slug: string } | { ok: false; error: string }> | null = null;
    let capturePromise: Promise<{ revised: boolean; settled: boolean; artifactId: number; warnings: string[] }> | null = null;
    try {
      publishPromise = performPublish({ userId, newsroomId }, lead!.id);
      let publishInsideTrigger = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const active = await monitor.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where datname=current_database() and query ilike '%insert into articles%' and wait_event='PgSleep'",
        );
        if (Number(active.rows[0]?.n) > 0) { publishInsideTrigger = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(publishInsideTrigger, true, "performPublish must hold its transaction and meeting lock while inserting the article");

      const captionB = capturedCaption("b", publicationFirstVideoId);
      capturePromise = applyCapturedMeetingTranscript(sql, {
        newsroomId,
        userId,
        video,
        result: {
          ok: true,
          parsed: { text: captionB.text, format: "vtt", sha256: captionB.sha256, sourcePath: captionB.sourcePath },
          infoPath: captionB.infoPath,
          info: { durationSeconds: 300, videoTimestamp: Date.parse("2026-09-22T12:00:00Z") / 1000, captionRevisionTimestamp: 2 },
          argv: [], stdout: "", stderr: "",
        },
        now: new Date("2026-09-22T15:20:00Z"),
      }, { runSection5: section5For(captionB) });

      let captureWaited = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await monitor.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock'",
        );
        if (Number(waiting.rows[0]?.n) > 0) { captureWaited = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(captureWaited, true, "the real B capture entrypoint must wait behind performPublish's meeting/lead fence");

      const published = await publishPromise;
      assert.equal(published.ok, true, "the publication-first ordering must publish valid A before B can commit");
      const appliedB = await capturePromise;
      assert.equal(appliedB.revised, true);

      const [article] = await sql.query<{ id: number; body: string }>(
        "select id,body from articles where newsroom_id=$1 and lead_id=$2 and status='published'",
        [newsroomId, lead!.id],
      );
      assert.equal(article!.body, captionA.text, "the later B capture must not rewrite the already-published A article");
      const [publishedEvidence] = await sql.query<{ artifact_id: number; artifact_sha256: string; citation_snapshot: string }>(
        "select artifact_id,artifact_sha256,citation_snapshot from meeting_article_transcript_links where newsroom_id=$1 and article_id=$2",
        [newsroomId, article!.id],
      );
      assert.equal(publishedEvidence!.artifact_id, draftEvidence!.artifact_id);
      assert.equal(publishedEvidence!.artifact_sha256, captionA.sha256);
      assert.deepEqual(JSON.parse(publishedEvidence!.citation_snapshot), JSON.parse(draftEvidence!.citation_snapshot));
      const reviews = await sql.query<{ prior_artifact_id: number; current_artifact_id: number; status: string }>(
        "select prior_artifact_id,current_artifact_id,status from meeting_article_revision_reviews where newsroom_id=$1 and article_id=$2",
        [newsroomId, article!.id],
      );
      assert.equal(reviews.length, 1, "the B capture committed after A and must create exactly one review");
      assert.equal(reviews[0]!.prior_artifact_id, draftEvidence!.artifact_id);
      assert.equal(reviews[0]!.current_artifact_id, appliedB.artifactId);
      assert.equal(reviews[0]!.status, "pending");
    } finally {
      await publishPromise?.catch(() => undefined);
      await capturePromise?.catch(() => undefined);
      await monitor.end();
      await sql.query(`drop trigger if exists ${triggerName} on articles`);
      await sql.query(`drop function if exists ${functionName}()`);
    }
  });
});
