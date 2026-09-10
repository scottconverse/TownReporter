import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { ensureJobsSchema } from "./jobs.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import { cleanDraftBatchInput } from "./draft-batch.ts";
import {
  commitDraftBatchForAuthenticatedEditor,
  ensureDraftBatchSchema,
  parseDraftBatchCompletion,
  readDraftBatchForAuthenticatedEditor,
} from "./draft-batch.server.ts";

const newsroomId = 99101;
const context = { userId: "batch-editor", newsroomId };
const runtimeSnapshot = {
  runtime: "claude-cli" as const,
  modelChoice: "claude-frontier",
  model: "selected-claude",
  transport: "claude-code" as const,
};

before(async () => {
  await ensureNewsroomSchema();
  await ensureJobsSchema();
  const sql = await getSql();
  await ensureDraftBatchSchema(sql);
  await sql.query(
    "insert into newsrooms(id,name) values($1,'Batch test') on conflict(id) do nothing",
    [newsroomId],
  );
  await sql.query(
    "create table if not exists leads(id serial primary key,user_id text not null,newsroom_id integer not null,headline text not null,why text not null,topic text not null,status text not null,source_urls text not null,evidence text not null,newsworthiness integer not null,notes_json text)",
  );
});

async function reset() {
  const sql = await getSql();
  await sql.query("delete from desk_jobs where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from draft_batches where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1 or newsroom_id=$2", [
    newsroomId,
    newsroomId + 1,
  ]);
  await sql.query("delete from newsroom_members where newsroom_id=$1 or newsroom_id=$2", [
    newsroomId,
    newsroomId + 1,
  ]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    context.userId,
    newsroomId,
  ]);
}

async function addLead(
  status: "new" | "drafted" | "held" | "killed" | "published" = "new",
  scope: "public" | "supplied" = "public",
  room = newsroomId,
) {
  const sql = await getSql();
  const [row] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Batch lead','Why','council',$3,'[]','',1,$4) returning id",
    [context.userId, room, status, JSON.stringify({ researchScope: scope })],
  );
  return row.id;
}

beforeEach(reset);

describe("draft batch validation", () => {
  const invalid = [
    null,
    {},
    { items: [], runtime: "local" },
    { items: Array.from({ length: 6 }, (_, index) => ({ leadId: index + 1 })), runtime: "local" },
    { items: [{ leadId: 0 }], runtime: "local" },
    { items: [{ leadId: 1 }, { leadId: 1 }], runtime: "local" },
    { items: [{ leadId: 1, researchScope: "everything" }], runtime: "local" },
    { items: [{ leadId: 1 }], runtime: "auto" },
    { items: [{ leadId: 1 }], runtime: "claude-api" },
  ];
  for (const value of invalid) {
    it("rejects malformed input " + JSON.stringify(value), () => {
      assert.equal(cleanDraftBatchInput(value).ok, false);
    });
  }
});

describe("draft batch transaction and read", () => {
  it("server commit helper refuses empty and duplicate selections", async () => {
    const leadId = await addLead();
    for (const items of [[], [{ leadId }, { leadId }]]) {
      const result = await commitDraftBatchForAuthenticatedEditor(
        { context, items, runtimeSnapshot },
        { accountRate: false, kick: false },
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "invalid-input");
    }
    const [{ count }] = await (
      await getSql()
    ).query<{ count: number }>(
      "select count(*)::int count from draft_batches where newsroom_id=$1",
      [newsroomId],
    );
    assert.equal(Number(count), 0);
  });

  it("schema refuses a job linked to a missing batch", async () => {
    const sql = await getSql();
    await assert.rejects(
      sql.query(
        "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,draft_batch_id) values($1,$2,'draft',999999,'local-model','editor','public','default','queued','Queued',999999)",
        [context.userId, newsroomId],
      ),
      /foreign key|desk_jobs_draft_batch_fk/i,
    );
  });

  it("stores one runtime header and preserves or explicitly overrides per-lead scope", async () => {
    const first = await addLead("new", "public");
    const second = await addLead("drafted", "supplied");
    const result = await commitDraftBatchForAuthenticatedEditor(
      {
        context,
        items: [{ leadId: first }, { leadId: second, researchScope: "public" }],
        runtimeSnapshot,
      },
      { accountRate: false, kick: false },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const sql = await getSql();
    const headers = await sql.query<{ runtime_snapshot: typeof runtimeSnapshot }>(
      "select runtime_snapshot from draft_batches where id=$1",
      [result.batch.id],
    );
    assert.deepEqual(headers, [{ runtime_snapshot: runtimeSnapshot }]);
    const jobs = await sql.query<{ research_scope: string; draft_batch_id: number }>(
      "select research_scope,draft_batch_id from desk_jobs where draft_batch_id=$1 order by subject_id",
      [result.batch.id],
    );
    assert.deepEqual(
      jobs.map((row) => row.research_scope),
      ["public", "public"],
    );
    assert.ok(jobs.every((row) => row.draft_batch_id === result.batch.id));
  });

  for (const status of ["held", "killed", "published"] as const) {
    it("rejects " + status + " and leaves no partial job", async () => {
      await addLead();
      const refused = await addLead(status);
      const sql = await getSql();
      const ids = (
        await sql.query<{ id: number }>("select id from leads where newsroom_id=$1 order by id", [
          newsroomId,
        ])
      ).map((row) => row.id);
      const result = await commitDraftBatchForAuthenticatedEditor(
        { context, items: ids.map((leadId) => ({ leadId })), runtimeSnapshot },
        { accountRate: false, kick: false },
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "ineligible");
        assert.equal(result.leadId, refused);
      }
      const [{ count }] = await sql.query<{ count: number }>(
        "select count(*)::int count from desk_jobs where newsroom_id=$1",
        [newsroomId],
      );
      assert.equal(Number(count), 0);
    });
  }

  it("hides a foreign lead and leaves no partial job", async () => {
    const accepted = await addLead();
    const foreign = await addLead("new", "public", newsroomId + 1);
    const result = await commitDraftBatchForAuthenticatedEditor(
      { context, items: [{ leadId: accepted }, { leadId: foreign }], runtimeSnapshot },
      { accountRate: false, kick: false },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "not-found");
    const [{ count }] = await (
      await getSql()
    ).query<{ count: number }>("select count(*)::int count from desk_jobs where newsroom_id=$1", [
      newsroomId,
    ]);
    assert.equal(Number(count), 0);
  });

  it("does not spend a rate attempt for a known foreign selection", async () => {
    const foreign = await addLead("new", "public", newsroomId + 1);
    let attempts = 0;
    const result = await commitDraftBatchForAuthenticatedEditor(
      { context, items: [{ leadId: foreign }], runtimeSnapshot },
      {
        assertRate: async () => {
          attempts += 1;
        },
        kick: false,
      },
    );
    assert.equal(result.ok, false);
    assert.equal(attempts, 0);
  });

  it("refuses a later stored supplied scope for Codex before inserting anything", async () => {
    const first = await addLead("new", "public");
    const second = await addLead("new", "supplied");
    const result = await commitDraftBatchForAuthenticatedEditor(
      {
        context,
        items: [{ leadId: first }, { leadId: second }],
        runtimeSnapshot: {
          runtime: "codex-terra",
          modelChoice: "codex-balanced",
          transport: "codex",
          model: "selected-terra",
        },
      },
      { accountRate: false, kick: false },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "ineligible");
      assert.equal(result.leadId, second);
    }
    const sql = await getSql();
    assert.equal(
      Number(
        (await sql.query<{ count: number }>("select count(*)::int count from draft_batches"))[0]
          .count,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await sql.query<{ count: number }>(
            "select count(*)::int count from desk_jobs where newsroom_id=$1",
            [newsroomId],
          )
        )[0].count,
      ),
      0,
    );
  });

  it("an open job on a later lead rolls back the whole selection", async () => {
    const first = await addLead();
    const busy = await addLead();
    const sql = await getSql();
    const [open] = await sql.query<{ id: number }>(
      "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage) values($1,$2,'draft',$3,'local-model','editor','public','default','queued','Queued') returning id",
      [context.userId, newsroomId, busy],
    );
    const result = await commitDraftBatchForAuthenticatedEditor(
      { context, items: [{ leadId: first }, { leadId: busy }], runtimeSnapshot },
      { accountRate: false, kick: false },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "already-running");
      assert.equal(result.leadId, busy);
      assert.equal(result.jobId, open.id);
    }
    const jobs = await sql.query<{ subject_id: number }>(
      "select subject_id from desk_jobs where newsroom_id=$1 order by id",
      [newsroomId],
    );
    assert.deepEqual(jobs, [{ subject_id: busy }]);
  });

  it("rolls back the header and earlier job when a later job insert fails", async () => {
    const first = await addLead();
    const second = await addLead();
    const sql = await getSql();
    await sql.query(
      "alter table desk_jobs add constraint draft_batch_reject_second check(subject_id<>" +
        second +
        ")",
    );
    try {
      await assert.rejects(
        commitDraftBatchForAuthenticatedEditor(
          { context, items: [{ leadId: first }, { leadId: second }], runtimeSnapshot },
          { accountRate: false, kick: false },
        ),
        /draft_batch_reject_second|check constraint/i,
      );
      assert.equal(
        Number(
          (
            await sql.query<{ count: number }>(
              "select count(*)::int count from draft_batches where newsroom_id=$1",
              [newsroomId],
            )
          )[0].count,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await sql.query<{ count: number }>(
              "select count(*)::int count from desk_jobs where newsroom_id=$1",
              [newsroomId],
            )
          )[0].count,
        ),
        0,
      );
    } finally {
      await sql.query("alter table desk_jobs drop constraint if exists draft_batch_reject_second");
    }
  });

  it("returns the latest batch after reload and denies a foreign explicit id", async () => {
    const leadId = await addLead();
    const created = await commitDraftBatchForAuthenticatedEditor(
      { context, items: [{ leadId }], runtimeSnapshot },
      { accountRate: false, kick: false },
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const latest = await readDraftBatchForAuthenticatedEditor(context);
    assert.equal(latest.ok, true);
    if (latest.ok) {
      assert.equal(latest.batch?.id, created.batch.id);
      assert.equal(latest.batch?.items[0]?.workbenchHref, "/desk/story/" + leadId);
    }
    const sql = await getSql();
    await sql.query("create table if not exists drafts(id serial primary key,user_id text,newsroom_id integer,lead_id integer,headline text,body text,topic text,integrity_notes text,created_at timestamptz default now())");
    const [batchDraft] = await sql.query<{ id: number }>(
      "insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic,integrity_notes) values($1,$2,$3,'Batch draft','Original','council','incomplete') returning id",
      [context.userId, newsroomId, leadId],
    );
    await sql.query(
      "update desk_jobs set result_json=$1 where newsroom_id=$2 and draft_batch_id=$3",
      [JSON.stringify({ untouched: "retained", version: 1, draftId: batchDraft.id, evidenceCheckIncomplete: true }), newsroomId, created.batch.id],
    );
    await sql.query(
      "insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic,integrity_notes) values($1,$2,$3,'Newer manual draft','Edited later','council','')",
      [context.userId, newsroomId, leadId],
    );
    const bound = await readDraftBatchForAuthenticatedEditor(context, created.batch.id);
    assert.equal(bound.ok && bound.batch?.items[0]?.evidenceCheckIncomplete, true);
    assert.equal(bound.ok && bound.batch?.items[0]?.draftId, batchDraft.id);
    assert.deepEqual(
      parseDraftBatchCompletion(JSON.stringify({ version: 1, draftId: 12345, evidenceCheckIncomplete: true, untouched: "retained" })),
      { draftId: 12345, evidenceCheckIncomplete: true },
    );
    const foreign = await readDraftBatchForAuthenticatedEditor(
      { userId: "foreign", newsroomId: newsroomId + 1 },
      created.batch.id,
    );
    assert.deepEqual(foreign, {
      ok: false,
      code: "not-found",
      error: "Draft batch not found.",
    });
  });
});
