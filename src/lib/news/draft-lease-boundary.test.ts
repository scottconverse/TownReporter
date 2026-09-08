import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { ReportedDraftResult } from "./desk-model-run.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performDraftWork: typeof import("./desk.ts").performDraftWork;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

const result: ReportedDraftResult = {
  headline: "Replacement worker's draft",
  dek: "A stale worker must not land this.",
  body: "The council voted Tuesday.",
  topic: "council",
  source_urls: ["https://example.test/agenda"],
  integrity_notes: "Check the recorded vote.",
  memory_entities: [],
  form: "news" as ReportedDraftResult extends { form: infer F } ? F : never,
  provenance: [],
  found_note: "The agenda lists the vote.",
  findings: [],
  unanswered: [],
  research_memo: {} as ReportedDraftResult extends { research_memo: infer R } ? R : never,
  claims: [],
} as ReportedDraftResult;

async function fixture(newsroomId: number) {
  const sql = await getSql();
  const userId = `draft-editor-${newsroomId}`;
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    userId,
    newsroomId,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Original lead','Why','council','new','[]','',1,$3) returning id",
    [userId, newsroomId, JSON.stringify({ scratch: "Original notes" })],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values($1,$2,'draft',$3,'claude-frontier','editor','default','running','Drafting','old-claim') returning id",
    [userId, newsroomId, lead.id],
  );
  const job: DeskJob = {
    id: jobRow.id,
    newsroom_id: newsroomId,
    user_id: userId,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "claude-frontier",
    model_choice_source: "editor",
    lane: "default",
    status: "running",
    stage: "Drafting",
    failover_note: "",
    error: null,
    created_at: "",
    updated_at: "",
    started_at: null,
    finished_at: null,
    claim_token: "old-claim",
  };
  return { sql, userId, leadId: lead.id, job };
}

it("a reclaimed draft worker cannot write a draft, lead notes, or audit event", async () => {
  const sql = await getSql();
  const newsroomId = 98201;
  const userId = "draft-lease-editor";
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    userId,
    newsroomId,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Original lead','Why','council','new','[]','',1,$3) returning id",
    [userId, newsroomId, JSON.stringify({ scratch: "Original notes" })],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values($1,$2,'draft',$3,'claude-frontier','editor','default','running','Drafting','old-claim') returning id",
    [userId, newsroomId, lead.id],
  );
  const job: DeskJob = {
    id: jobRow.id,
    newsroom_id: newsroomId,
    user_id: userId,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "claude-frontier",
    model_choice_source: "editor",
    lane: "default",
    status: "running",
    stage: "Drafting",
    failover_note: "",
    error: null,
    created_at: "",
    updated_at: "",
    started_at: null,
    finished_at: null,
    claim_token: "old-claim",
  };

  let workError: unknown;
  try {
    await performDraftWork(job, {
      reportAndDraft: async () => {
        await sql.query("update desk_jobs set claim_token='replacement-claim' where id=$1", [
          job.id,
        ]);
        return result;
      },
      setJobStage: async () => undefined,
    });
  } catch (error) {
    workError = error;
  }

  const [{ count: draftCount }] = await sql.query<{ count: number }>(
    "select count(*)::int as count from drafts where newsroom_id=$1 and lead_id=$2",
    [newsroomId, lead.id],
  );
  const [currentLead] = await sql.query<{ status: string; notes_json: string }>(
    "select status,notes_json from leads where id=$1",
    [lead.id],
  );
  const [{ count: auditCount }] = await sql.query<{ count: number }>(
    "select count(*)::int as count from audit_events where newsroom_id=$1 and action='draft'",
    [newsroomId],
  );
  assert.equal(Number(draftCount), 0);
  assert.equal(currentLead.status, "new");
  assert.equal(JSON.parse(currentLead.notes_json).scratch, "Original notes");
  assert.equal(Number(auditCount), 0);
  assert.match(String(workError), /lease|claim|reclaimed/i);
});

it("the current manual draft claim commits the draft, notes, and audit together", async () => {
  const { sql, leadId, job } = await fixture(98202);
  await performDraftWork(job, {
    reportAndDraft: async () => ({
      ...result,
      claims: [
        {
          fact: "The council voted Tuesday.",
          url: "https://example.test/agenda",
          kind: "record",
        },
      ],
    }),
    setJobStage: async () => undefined,
  });
  const [{ count: draftCount }] = await sql.query<{ count: number }>(
    "select count(*)::int as count from drafts where lead_id=$1",
    [leadId],
  );
  const [lead] = await sql.query<{ status: string; notes_json: string }>(
    "select status,notes_json from leads where id=$1",
    [leadId],
  );
  const [{ count: auditCount }] = await sql.query<{ count: number }>(
    "select count(*)::int as count from audit_events where newsroom_id=$1 and action='draft'",
    [job.newsroom_id],
  );
  assert.equal(Number(draftCount), 1);
  assert.equal(lead.status, "drafted");
  assert.notEqual(JSON.parse(lead.notes_json).scratch, undefined);
  assert.equal(Number(auditCount), 1);
  const [draft] = await sql.query<{ research_json: string }>(
    "select research_json from drafts where lead_id=$1",
    [leadId],
  );
  assert.deepEqual(JSON.parse(draft.research_json).reportedClaims, {
    version: 1,
    rows: [
      {
        fact: "The council voted Tuesday.",
        url: "https://example.test/agenda",
        kind: "record",
      },
    ],
  });
  const [completedJob] = await sql.query<{ status: string }>(
    "select status from desk_jobs where id=$1",
    [job.id],
  );
  assert.equal(completedJob.status, "completed");
});

it("rolls back the draft and lead update when the final audit insert fails", async () => {
  const { sql, leadId, job } = await fixture(98206);
  await sql.query(`
    alter table audit_events add constraint draft_boundary_reject_audit
    check (not (newsroom_id = 98206 and action = 'draft'))
  `);
  try {
    await assert.rejects(
      performDraftWork(job, {
        reportAndDraft: async () => result,
        setJobStage: async () => undefined,
      }),
      /draft_boundary_reject_audit|check constraint/i,
    );
    const [{ count: draftCount }] = await sql.query<{ count: number }>(
      "select count(*)::int as count from drafts where lead_id=$1",
      [leadId],
    );
    const [lead] = await sql.query<{ status: string; notes_json: string }>(
      "select status,notes_json from leads where id=$1",
      [leadId],
    );
    assert.equal(Number(draftCount), 0);
    assert.equal(lead.status, "new");
    assert.equal(JSON.parse(lead.notes_json).scratch, "Original notes");
    const [runningJob] = await sql.query<{ status: string; claim_token: string }>(
      "select status,claim_token from desk_jobs where id=$1",
      [job.id],
    );
    assert.deepEqual(runningJob, { status: "running", claim_token: "old-claim" });
  } finally {
    await sql.query(
      "alter table audit_events drop constraint if exists draft_boundary_reject_audit",
    );
  }
});

for (const boundary of ["permission", "killed", "published"] as const) {
  it(`refuses final draft writes when the ${boundary} boundary changes during generation`, async () => {
    const newsroomId = 98203 + ["permission", "killed", "published"].indexOf(boundary);
    const { sql, userId, leadId, job } = await fixture(newsroomId);
    let workError: unknown;
    try {
      await performDraftWork(job, {
        reportAndDraft: async () => {
          if (boundary === "permission")
            await sql.query("delete from newsroom_members where newsroom_id=$1 and user_id=$2", [
              newsroomId,
              userId,
            ]);
          else await sql.query("update leads set status=$1 where id=$2", [boundary, leadId]);
          return result;
        },
        setJobStage: async () => undefined,
      });
    } catch (error) {
      workError = error;
    }
    const [{ count: draftCount }] = await sql.query<{ count: number }>(
      "select count(*)::int as count from drafts where lead_id=$1",
      [leadId],
    );
    const [{ count: auditCount }] = await sql.query<{ count: number }>(
      "select count(*)::int as count from audit_events where newsroom_id=$1 and action='draft'",
      [newsroomId],
    );
    assert.equal(Number(draftCount), 0);
    assert.equal(Number(auditCount), 0);
    assert.match(
      String(workError),
      boundary === "permission"
        ? /permission.*withdrawn/i
        : boundary === "killed"
          ? /restore/i
          : /published/i,
    );
  });
}
