import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import type { Sql } from "../db.ts";
import type { Editorial } from "./editorial.ts";
import {
  ensureEditorialRequestSchema,
  ensureEditorialSchema,
  fileEditorial,
  performEditorialWork,
} from "./editorial.server.ts";
import { enqueueJob, ensureJobsSchema } from "./jobs.ts";
import { persistEditorialSuccess } from "./editorial-result-persistence.ts";

const TEST_EDITORIAL: Editorial = {
  headline: "Keep local history public",
  body: Array.from({ length: 100 }, (_, index) => `word${index + 1}`).join(" "),
  appendix: "1. City archive — https://example.test/archive",
  factSheet: "The archive is publicly funded.",
  imagePrompt: "A public archive reading room.",
};

function uniqueUser(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()}`;
}

async function ensureCompletionSchema() {
  await ensureJobsSchema();
  await ensureEditorialRequestSchema();
  await ensureEditorialSchema();
  const sql = await getSql();
  await sql.query(`
    create table if not exists drafts (
      id serial primary key,
      user_id text not null,
      newsroom_id integer not null default 1,
      lead_id integer,
      headline text not null,
      dek text not null default '',
      body text not null,
      topic text not null,
      source_urls text not null default '[]',
      form text not null default 'reported',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

async function insertRequest(
  sql: Sql,
  input: { userId: string; modelChoice?: string; draftId?: number | null },
) {
  const [request] = await sql<{ id: number }>`
    insert into editorial_requests
      (user_id, newsroom_id, subject, source_kind, source_ref, model_choice, draft_id)
    values (${input.userId}, ${1}, ${"Keep local history public"}, ${"paste"}, ${"desk"},
            ${input.modelChoice ?? "auto"}, ${input.draftId ?? null})
    returning id
  `;
  assert.ok(request);
  return request;
}

async function cleanCompletionFixture(sql: Sql, userId: string) {
  await sql`delete from desk_jobs where user_id = ${userId}`;
  await sql`delete from editorial_requests where user_id = ${userId}`;
  await sql`
    delete from editorial_extras
    where draft_id in (select id from drafts where user_id = ${userId})
  `;
  await sql`delete from drafts where user_id = ${userId}`;
}

describe("Automatic Opinion provider persistence", () => {
  it("replaces auto with the provider that actually completed the full pair", async () => {
    const sql = await getSql();
    await ensureJobsSchema();
    await sql.query(`
      create table if not exists editorial_requests (
        id serial primary key,
        user_id text not null,
        newsroom_id integer not null default 1,
        subject text not null,
        source_kind text not null default 'paste',
        source_ref text not null default '',
        asked_for text not null default '',
        pointers_json text not null default '[]',
        our_story_json text,
        model_choice text not null default 'auto',
        draft_id integer,
        error text,
        created_at timestamptz not null default now(),
        finished_at timestamptz
      )
    `);
    const userId = `opinion-effective-${Date.now()}-${Math.random()}`;
    const [request] = await sql<{ id: number }>`
      insert into editorial_requests
        (user_id, newsroom_id, subject, source_kind, source_ref, model_choice)
      values (${userId}, ${1}, ${"Keep local history public"}, ${"paste"}, ${"desk"}, ${"auto"})
      returning id
    `;
    assert.ok(request);
    const job = await enqueueJob({
      userId,
      newsroomId: 1,
      kind: "editorial",
      subjectId: request.id,
      modelChoice: "auto",
      kick: false,
    });

    await persistEditorialSuccess(sql, {
      requestId: request.id,
      jobId: job.id,
      newsroomId: 1,
      result: {
        ok: true,
        draftId: 7788,
        headline: "OPINION: Keep local history public",
        words: 620,
        hadAppendix: true,
        modelChoice: "claude-frontier",
      },
    });

    const [storedRequest] = await sql<{
      draft_id: number;
      model_choice: string;
      finished: boolean;
    }>`
      select draft_id, model_choice, (finished_at is not null) as finished
      from editorial_requests where id = ${request.id}
    `;
    const [storedJob] = await sql<{ model_choice: string }>`
      select model_choice from desk_jobs where id = ${job.id}
    `;
    assert.deepEqual(storedRequest, {
      draft_id: 7788,
      model_choice: "claude-frontier",
      finished: true,
    });
    assert.deepEqual(storedJob, { model_choice: "claude-frontier" });

    await sql`delete from desk_jobs where id = ${job.id}`;
    await sql`delete from editorial_requests where id = ${request.id}`;
  });
});

describe("Opinion completion commit", () => {
  it("commits the draft, extras, request result, and actual provider on both records atomically", async () => {
    const sql = await getSql();
    await ensureCompletionSchema();
    const userId = uniqueUser("opinion-atomic");
    const request = await insertRequest(sql, { userId });
    const job = await enqueueJob({
      userId,
      newsroomId: 1,
      kind: "editorial",
      subjectId: request.id,
      modelChoice: "auto",
      kick: false,
    });

    try {
      const result = await fileEditorial(
        {
          userId,
          newsroomId: 1,
          subject: "Keep local history public",
          pointers: [],
          sourceKind: "paste",
          sourceRef: "desk",
          completion: { requestId: request.id, jobId: job.id },
        },
        TEST_EDITORIAL,
        "claude-frontier",
      );
      assert.equal(result.ok, true);
      if (!result.ok) assert.fail(result.error);

      const [stored] = await sql<{
        draft_id: number;
        request_model: string;
        job_model: string;
        finished: boolean;
        extras: number;
      }>`
        select r.draft_id, r.model_choice as request_model, j.model_choice as job_model,
               (r.finished_at is not null) as finished,
               (select count(*)::int from editorial_extras e where e.draft_id = r.draft_id) as extras
        from editorial_requests r
        join desk_jobs j on j.id = ${job.id}
        where r.id = ${request.id}
      `;
      assert.deepEqual(stored, {
        draft_id: result.draftId,
        request_model: "claude-frontier",
        job_model: "claude-frontier",
        finished: true,
        extras: 1,
      });
    } finally {
      await cleanCompletionFixture(sql, userId);
    }
  });

  it("rolls every write back when the job half of completion cannot be committed", async () => {
    const sql = await getSql();
    await ensureCompletionSchema();
    const userId = uniqueUser("opinion-rollback");
    const request = await insertRequest(sql, { userId });

    try {
      await assert.rejects(
        fileEditorial(
          {
            userId,
            newsroomId: 1,
            subject: "Keep local history public",
            pointers: [],
            sourceKind: "paste",
            sourceRef: "desk",
            completion: { requestId: request.id, jobId: -999_999 },
          },
          TEST_EDITORIAL,
          "codex-frontier",
        ),
        /editorial job .* not found/i,
      );

      const [stored] = await sql<{
        draft_id: number | null;
        model_choice: string;
        finished: boolean;
      }>`
        select draft_id, model_choice, (finished_at is not null) as finished
        from editorial_requests where id = ${request.id}
      `;
      const [drafts] = await sql<{ count: number }>`
        select count(*)::int as count from drafts where user_id = ${userId}
      `;
      assert.deepEqual(stored, { draft_id: null, model_choice: "auto", finished: false });
      assert.equal(drafts?.count, 0);
    } finally {
      await cleanCompletionFixture(sql, userId);
    }
  });

  it("repairs a partially persisted completed request without calling a model or filing again", async () => {
    const sql = await getSql();
    await ensureCompletionSchema();
    const userId = uniqueUser("opinion-retry");
    const filed = await fileEditorial(
      {
        userId,
        newsroomId: 1,
        subject: "Keep local history public",
        pointers: [],
        sourceKind: "paste",
        sourceRef: "desk",
      },
      TEST_EDITORIAL,
    );
    assert.equal(filed.ok, true);
    if (!filed.ok) assert.fail(filed.error);
    const request = await insertRequest(sql, {
      userId,
      modelChoice: "claude-frontier",
      draftId: filed.draftId,
    });
    const job = await enqueueJob({
      userId,
      newsroomId: 1,
      kind: "editorial",
      subjectId: request.id,
      modelChoice: "auto",
      kick: false,
    });
    let modelCalls = 0;

    try {
      await assert.doesNotReject(
        performEditorialWork(job, {
          writeEditorial: async () => {
            modelCalls += 1;
            return { ok: false as const, error: "the model must not run on a completed retry" };
          },
        }),
      );
      assert.equal(modelCalls, 0);

      const [stored] = await sql<{ request_model: string; job_model: string; finished: boolean }>`
        select r.model_choice as request_model, j.model_choice as job_model,
               (r.finished_at is not null) as finished
        from editorial_requests r
        join desk_jobs j on j.id = ${job.id}
        where r.id = ${request.id}
      `;
      const [drafts] = await sql<{ count: number }>`
        select count(*)::int as count from drafts where user_id = ${userId}
      `;
      assert.deepEqual(stored, {
        request_model: "claude-frontier",
        job_model: "claude-frontier",
        finished: true,
      });
      assert.equal(drafts?.count, 1);
    } finally {
      await cleanCompletionFixture(sql, userId);
    }
  });

  it("does not let a late failing worker overwrite a successfully filed request", async () => {
    const sql = await getSql();
    await ensureCompletionSchema();
    const userId = uniqueUser("opinion-late-failure");
    const request = await insertRequest(sql, { userId });
    const job = await enqueueJob({
      userId,
      newsroomId: 1,
      kind: "editorial",
      subjectId: request.id,
      modelChoice: "auto",
      kick: false,
    });
    let releaseFailure!: () => void;
    let signalStarted!: () => void;
    const failureMayFinish = new Promise<void>((resolve) => (releaseFailure = resolve));
    const workerStarted = new Promise<void>((resolve) => (signalStarted = resolve));
    const delayedWork = performEditorialWork(job, {
      writeEditorial: async () => {
        signalStarted();
        await failureMayFinish;
        return { ok: false as const, error: "the stale provider eventually failed" };
      },
    });
    const delayedFailure = assert.rejects(delayedWork, /stale provider eventually failed/);

    try {
      await workerStarted;
      const filed = await fileEditorial(
        {
          userId,
          newsroomId: 1,
          subject: "Keep local history public",
          pointers: [],
          sourceKind: "paste",
          sourceRef: "desk",
          completion: { requestId: request.id, jobId: job.id },
        },
        TEST_EDITORIAL,
        "codex-frontier",
      );
      assert.equal(filed.ok, true);
      if (!filed.ok) assert.fail(filed.error);
      releaseFailure();
      await delayedFailure;

      const [stored] = await sql<{
        draft_id: number;
        error: string | null;
        model_choice: string;
        finished: boolean;
      }>`
        select draft_id, error, model_choice, (finished_at is not null) as finished
        from editorial_requests where id = ${request.id}
      `;
      assert.deepEqual(stored, {
        draft_id: filed.draftId,
        error: null,
        model_choice: "codex-frontier",
        finished: true,
      });
    } finally {
      releaseFailure();
      await delayedFailure;
      await cleanCompletionFixture(sql, userId);
    }
  });
});
