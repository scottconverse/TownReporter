import assert from "node:assert/strict";
import { it, before } from "node:test";
import { getSql } from "../db.ts";
import { enqueueJob, ensureJobsSchema } from "./jobs.ts";
import { commitStoryDraftForAuthenticatedEditor, commitScanForAuthenticatedEditor, writeStoryForAuthenticatedEditor } from "./model-request-commit.server.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";

const context = { userId: "model-override-editor", newsroomId: 1 };
const deps = {
  probeProvider: async () => ({ ok: true as const, choice: "claude-sonnet" as const, label: "Sonnet" }),
  enqueueJob: (input: Parameters<typeof enqueueJob>[0]) => enqueueJob({ ...input, kick: false }),
  kickJobs: () => {},
};
before(async () => {
  await ensurePaperSettingsSchema(); await ensureJobsSchema();
  const sql = await getSql();
  await sql`insert into paper_settings(newsroom_id,onboarded) values(1,true) on conflict(newsroom_id) do update set onboarded=true`;
});
async function lead(status = "new", room = 1) {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`insert into leads(user_id,newsroom_id,headline,why,status) values(${context.userId},${room},'A fixture lead for model overrides','A reason it is news',${status}) returning id`;
  return row.id;
}
async function expectAudit(key: string) {
  const sql = await getSql();
  const rows = await sql<{ detail: string; created_at: unknown }>`select detail,created_at from audit_events where user_id=${context.userId} and action='override'`;
  assert.ok(rows.some(row => JSON.parse(row.detail).key === key && JSON.parse(row.detail).target && row.created_at));
}
it("a killed lead warns, then queues the draft with a worker override receipt and audit", async () => {
  for (const reuseLedger of [false, true]) {
  const leadId = await lead("killed");
  const input = { context, leadId, modelChoice: "claude-sonnet" as const, reuseLedger };
  const warning = await commitStoryDraftForAuthenticatedEditor(input, deps);
  assert.equal("warning" in warning && warning.warning?.key, "lead-killed-draft");
  const result = await commitStoryDraftForAuthenticatedEditor({ ...input, override: ["lead-killed-draft"] }, deps);
  assert.equal(result.ok, true);
  const sql = await getSql();
  const [job] = await sql<{ result_json: string }>`select result_json from desk_jobs where subject_id=${leadId} and kind='draft' and status='queued'`;
  assert.equal(JSON.parse(job.result_json).allowKilledLead, true); await expectAudit("lead-killed-draft");
  assert.equal(JSON.parse(job.result_json).reuseLedger === true, reuseLedger);
  }
});
it("a draft-cap warning does not cancel the old job, and a failed enqueue does not consume a run", async () => {
  const sql=await getSql();const leadId=await lead();
  const actor={...context,userId:"draft-cap-editor"};
  await sql.query("insert into desk_rate(user_id,newsroom_id,action) select $1,1,'draft' from generate_series(1,20)",[actor.userId]);
  const old=await enqueueJob({userId:actor.userId,newsroomId:1,kind:"draft",subjectId:leadId,modelChoice:"codex-frontier",kick:false});
  const input={context:actor,leadId,modelChoice:"claude-sonnet" as const,override:["model-change-running"]};
  const warning=await commitStoryDraftForAuthenticatedEditor(input,deps);assert.equal("warning" in warning && warning.warning?.key,"rate-draft");
  const [unchanged]=await sql.query<{status:string}>("select status from desk_jobs where id=$1",[old.id]);assert.equal(unchanged.status,"queued");
  await assert.rejects(()=>commitStoryDraftForAuthenticatedEditor({...input,override:["model-change-running","rate-draft"]},{...deps,enqueueJob:async()=>{throw new Error("fixture enqueue failed");}}),/fixture enqueue failed/);
  const [count]=await sql.query<{c:number}>("select count(*)::int c from desk_rate where user_id=$1 and action='draft'",[actor.userId]);assert.equal(count.c,20);
});
it("a different transcript warns, then queues that exact artifact; changing a running transcript cancels its claim", async () => {
  const sql = await getSql(); const leadId = await lead();
  const artifacts = [];
  for (const videoId of ["different-a", "different-b"]) {
    const [artifact] = await sql.query<{id:number}>("insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode) values(1,$1,'fixture','txt',$1,'yt-dlp-captions','transcript-only') returning id", [videoId]); artifacts.push(artifact.id);
  }
  const input = {context,leadId,modelChoice:"claude-sonnet" as const,meetingArtifactId:artifacts[0]};
  const first = await commitStoryDraftForAuthenticatedEditor(input,deps);
  assert.equal("warning" in first && first.warning?.key,"transcript-selection-mismatch");
  const approved = await commitStoryDraftForAuthenticatedEditor({...input,override:["transcript-selection-mismatch"]},deps);assert.equal(approved.ok,true);
  const [old] = await sql.query<{id:number;result_json:string}>("select id,result_json from desk_jobs where kind='draft' and subject_id=$1 and status='queued'",[leadId]);
  assert.equal(JSON.parse(old.result_json).meetingArtifactId,artifacts[0]); assert.equal(JSON.parse(old.result_json).meetingVideoId,"different-a");
  await sql.query("update desk_jobs set claim_token='transcript-old' where id=$1",[old.id]);
  const second = {...input,meetingArtifactId:artifacts[1],override:["transcript-selection-mismatch"]};
  const conflict = await commitStoryDraftForAuthenticatedEditor(second,deps);assert.equal("warning" in conflict && conflict.warning?.key,"transcript-run-conflict");
  const restart = await commitStoryDraftForAuthenticatedEditor({...second,override:["transcript-selection-mismatch","transcript-run-conflict"]},deps);assert.equal(restart.ok,true);
  const [cancelled] = await sql.query<{status:string;claim_token:string|null}>("select status,claim_token from desk_jobs where id=$1",[old.id]); assert.equal(cancelled.status,"failed");assert.equal(cancelled.claim_token,null);
  await expectAudit("transcript-selection-mismatch"); await expectAudit("transcript-run-conflict");
  const missing = await commitStoryDraftForAuthenticatedEditor({...input,meetingArtifactId:2147483000,override:["transcript-selection-mismatch"]},deps); assert.equal(missing.ok,false);assert.match(missing.error,/not in this newsroom/i);
});
it("a model change warns then cancels the old draft, clears its claim and queues the selected model", async () => {
  const leadId = await lead();
  const old = await enqueueJob({ userId: context.userId, newsroomId: 1, kind: "draft", subjectId: leadId, modelChoice: "codex-frontier", kick: false });
  const sql = await getSql(); await sql`update desk_jobs set claim_token='old-claim' where id=${old.id}`;
  const input = { context, leadId, modelChoice: "claude-sonnet" as const };
  const warning = await commitStoryDraftForAuthenticatedEditor(input, deps);
  assert.equal("warning" in warning && warning.warning?.key, "model-change-running");
  const result = await commitStoryDraftForAuthenticatedEditor({ ...input, override: ["model-change-running"] }, deps);
  assert.equal(result.ok, true);
  const [cancelled] = await sql<{ status: string; claim_token: string | null; cancel_requested: boolean }>`select status,claim_token,cancel_requested from desk_jobs where id=${old.id}`;
  assert.equal(cancelled.status, "failed"); assert.equal(cancelled.claim_token, null); assert.equal(cancelled.cancel_requested, true);
  const [current] = await sql<{ model_choice: string }>`select model_choice from desk_jobs where subject_id=${leadId} and kind='draft' and status='queued'`;
  assert.equal(current.model_choice, "claude-sonnet"); await expectAudit("model-change-running");
});
it("a scan model change offers the same explicit restart and replaces the open scan", async () => {
  const sql = await getSql();
  const [run] = await sql<{ id: number }>`insert into scan_runs(user_id,newsroom_id) values(${context.userId},1) returning id`;
  const old = await enqueueJob({ userId: context.userId, newsroomId: 1, kind: "scan", subjectId: run.id, modelChoice: "codex-frontier", kick: false });
  const input = { context, modelChoice: "claude-sonnet" as const };
  const warning = await commitScanForAuthenticatedEditor(input, deps);
  assert.equal("warning" in warning && warning.warning?.key, "model-change-running");
  const result = await commitScanForAuthenticatedEditor({ ...input, override: ["model-change-running"] }, deps);
  assert.equal(result.ok, true);
  const [row] = await sql<{ status: string }>`select status from desk_jobs where id=${old.id}`; assert.equal(row.status, "failed");
});
it("an editor can override unfinished setup, while a missing lead still refuses", async () => {
  const sql = await getSql(); const room = 9891;
  await sql`insert into newsrooms(id,name) values(${room},'Unfinished paper')`;
  const leadId = await lead("new", room);
  const input = { context: { ...context, newsroomId: room }, leadId, modelChoice: "claude-sonnet" as const };
  const first = await commitStoryDraftForAuthenticatedEditor(input, deps);
  assert.equal("warning" in first && first.warning?.key, "paper-not-set-up");
  const result = await commitStoryDraftForAuthenticatedEditor({ ...input, override: ["paper-not-set-up"] }, deps);
  assert.equal(result.ok, true); await expectAudit("paper-not-set-up");
  const missing = await commitStoryDraftForAuthenticatedEditor({ ...input, leadId: 2147483000, override: ["paper-not-set-up", "lead-killed-draft"] }, deps);
  assert.equal(missing.ok, false); assert.match(missing.error, /not found/i);
});
it("filing into About and Opinion warns, then files that section with an audited override", async () => {
  for (const sectionKey of ["about", "opinion"]) {
    const input = { context, text: "A short report about an upcoming hearing.", sectionKey, modelChoice: "claude-sonnet" as const };
    const first = await writeStoryForAuthenticatedEditor(input, deps);
    assert.equal("warning" in first && first.warning?.key, "lead-publication-section");
    const result = await writeStoryForAuthenticatedEditor({ ...input, override: ["lead-publication-section"] }, deps);
    assert.equal(result.ok, true);
    const sql = await getSql(); const [row] = await sql<{ topic: string }>`select topic from leads where id=${result.leadId}`;
    assert.equal(row.topic, sectionKey); await expectAudit("lead-publication-section");
  }
});

// One consent retry must not file the warning attempt as an empty story.
for (const choice of ["claude-haiku", "custom:walk-g7"] as const)
  it(`${choice}: one confirmation files one story and one draft job`, async () => {
    const sql = await getSql();
    const actor = { userId: `walk-g7-${choice}`, newsroomId: 1 };
    const input = {
      context: actor,
      text: "Write a complete community notice from this supplied development test material.",
      modelChoice: choice,
      researchScope: "supplied" as const,
    };
    const services = {
      ...deps,
      probeProvider: async (pick: string | undefined) =>
        pick === choice
          ? {
              ok: false as const,
              error:
                choice === "claude-haiku"
                  ? "Claude Code is signed out. Sign in again."
                  : "The saved API key cannot be decrypted.",
            }
          : { ok: true as const, choice: "codex-frontier" as const, label: "Codex Sol 6.1" },
    };
    const counts = async () => {
      const [row] = await sql<{ leads: number; drafts: number; jobs: number }>`select
      (select count(*)::int from leads where user_id=${actor.userId}) as leads,
      (select count(*)::int from drafts where user_id=${actor.userId}) as drafts,
      (select count(*)::int from desk_jobs where user_id=${actor.userId}) as jobs`;
      return row;
    };
    const warning = await writeStoryForAuthenticatedEditor(input, services);
    assert.equal("warning" in warning && warning.warning?.key, "writer-not-ready");
    assert.deepEqual(
      await counts(),
      { leads: 0, drafts: 0, jobs: 0 },
      "waiting for consent must not file a story",
    );
    const result = await writeStoryForAuthenticatedEditor(
      { ...input, override: ["writer-not-ready"] },
      services,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(await counts(), { leads: 1, drafts: 1, jobs: 1 });
    const [job] = await sql<{
      subject_id: number;
      result_json: string;
    }>`select subject_id,result_json from desk_jobs where user_id=${actor.userId}`;
    assert.equal(job.subject_id, result.leadId);
    assert.equal(JSON.parse(job.result_json).requestedRuntime, choice);
    assert.equal(JSON.parse(job.result_json).actualRuntime, "codex-frontier");
  });
