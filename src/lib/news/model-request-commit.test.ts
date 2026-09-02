import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureJobsSchema, enqueueJob } from "./jobs.ts";
import { ensureNewsroomSchema, requireEditor } from "./membership.ts";
import { checkOpinionReadiness } from "./opinion-readiness.ts";
import {
  commitOpinionForAuthenticatedEditor,
  commitStoryDraftForAuthenticatedEditor,
} from "./model-request-commit.server.ts";

const EXPIRED =
  "Codex authentication has expired or Codex is signed out. Open Codex, sign in again, then try again.";

type Counts = {
  jobs: number;
  requests: number;
  drafts: number;
  rate: number;
  audit: number;
};

async function countsFor(userId: string): Promise<Counts> {
  const sql = await getSql();
  const [jobs] = await sql<{
    count: number;
  }>`select count(*) as count from desk_jobs where user_id = ${userId}`;
  const [requests] = await sql<{
    count: number;
  }>`select count(*) as count from editorial_requests where user_id = ${userId}`;
  const [drafts] = await sql<{
    count: number;
  }>`select count(*) as count from drafts where user_id = ${userId}`;
  const [rate] = await sql<{
    count: number;
  }>`select count(*) as count from desk_rate where user_id = ${userId}`;
  const [audit] = await sql<{
    count: number;
  }>`select count(*) as count from audit_events where user_id = ${userId}`;
  return {
    jobs: Number(jobs?.count ?? 0),
    requests: Number(requests?.count ?? 0),
    drafts: Number(drafts?.count ?? 0),
    rate: Number(rate?.count ?? 0),
    audit: Number(audit?.count ?? 0),
  };
}

async function ensureCommitBoundarySchema() {
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
  await sql.query(`
    create table if not exists leads (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      headline text not null,
      why text not null,
      topic text not null default 'council',
      status text not null default 'new',
      source_urls text not null default '[]',
      evidence text not null default '',
      newsworthiness integer not null default 0,
      created_at timestamptz not null default now()
    )
  `);
  return sql;
}

describe("authenticated Codex commit boundary", () => {
  it("refuses expired OAuth before Story or Opinion writes, then enqueues exactly once after refresh", async () => {
    const sql = await getSql();
    await ensureNewsroomSchema();
    await sql`delete from newsroom_members`;
    await ensureJobsSchema();
    await sql.query(`
      create table if not exists leads (
        id serial primary key,
        newsroom_id integer not null default 1,
        user_id text not null,
        headline text not null,
        why text not null,
        topic text not null default 'council',
        status text not null default 'new',
        source_urls text not null default '[]',
        evidence text not null default '',
        newsworthiness integer not null default 0,
        created_at timestamptz not null default now()
      )
    `);
    await sql.query(`
      create table if not exists drafts (
        id serial primary key,
        newsroom_id integer not null default 1,
        user_id text not null,
        lead_id integer,
        headline text not null,
        body text not null default '',
        created_at timestamptz not null default now()
      )
    `);
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
    await sql.query(`
      create table if not exists desk_rate (
        id serial primary key,
        user_id text not null,
        action text not null,
        created_at timestamptz not null default now()
      )
    `);
    await sql.query(`
      create table if not exists audit_events (
        id serial primary key,
        user_id text not null,
        action text not null,
        detail text not null default '',
        created_at timestamptz not null default now()
      )
    `);

    const userId = `oauth-boundary-${Date.now()}-${Math.random()}`;
    const editor = await requireEditor(userId);
    assert.deepEqual(editor, { role: "owner", newsroomId: 1 });
    const [lead] = await sql<{ id: number }>`
      insert into leads (newsroom_id, user_id, headline, why)
      values (${editor.newsroomId}, ${userId}, ${"Council schedules a public water hearing"},
              ${"The date affects every utility customer."})
      returning id
    `;
    assert.ok(lead);

    const before = await countsFor(userId);
    assert.deepEqual(before, { jobs: 0, requests: 0, drafts: 0, rate: 0, audit: 0 });

    let storyProbeCalls = 0;
    let storyEnqueueCalls = 0;
    const storyExpired = await commitStoryDraftForAuthenticatedEditor(
      {
        context: { userId, newsroomId: editor.newsroomId },
        leadId: lead.id,
        modelChoice: "codex-frontier",
      },
      {
        probeProvider: async (choice) => {
          storyProbeCalls += 1;
          assert.equal(choice, "codex-frontier");
          return { ok: false as const, error: EXPIRED };
        },
        enqueueJob: async (opts) => {
          storyEnqueueCalls += 1;
          return enqueueJob({ ...opts, kick: false });
        },
      },
    );
    assert.equal(storyExpired.ok, false);
    if (storyExpired.ok) assert.fail("expired Story OAuth must refuse");
    assert.equal(storyExpired.kind, "provider-auth");
    assert.match(storyExpired.error, /Codex needs you to sign in again/i);
    assert.equal(storyExpired.detail, EXPIRED);
    assert.equal(storyProbeCalls, 1);
    assert.equal(storyEnqueueCalls, 0);
    assert.deepEqual(await countsFor(userId), before);

    const storyReady = await commitStoryDraftForAuthenticatedEditor(
      {
        context: { userId, newsroomId: editor.newsroomId },
        leadId: lead.id,
        modelChoice: "codex-frontier",
      },
      {
        probeProvider: async () => ({
          ok: true as const,
          label: "Codex Sol",
          choice: "codex-frontier" as const,
        }),
        enqueueJob: async (opts) => {
          storyEnqueueCalls += 1;
          return enqueueJob({ ...opts, kick: false });
        },
      },
    );
    assert.equal(storyReady.ok, true);
    assert.equal(storyReady.modelChoice, "codex-frontier");
    assert.equal(storyEnqueueCalls, 1);
    assert.deepEqual(await countsFor(userId), {
      jobs: 1,
      requests: 0,
      drafts: 0,
      rate: 1,
      audit: 0,
    });

    const afterStory = await countsFor(userId);
    const opinionCandidates: string[] = [];
    let opinionEnqueueCalls = 0;
    let opinionSchemaCalls = 0;
    let opinionSqlCalls = 0;
    // Opinion is Claude-only, so its expiry is Claude's, and its explicit
    // choice is the one choice the picker still offers.
    const opinionExpired = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: editor.newsroomId },
        subject: "The city should publish water-hearing exhibits before the meeting.",
        modelChoice: "claude-frontier",
      },
      {
        ensureEditorialRequestSchema: async () => {
          opinionSchemaCalls += 1;
        },
        getSql: async () => {
          opinionSqlCalls += 1;
          return sql;
        },
        checkReadiness: (choice) =>
          checkOpinionReadiness(choice, {
            findVoice: async () => ({ ok: true as const, voice: { path: "C:/voice.md" } }),
            probeCandidate: async (candidate) => {
              opinionCandidates.push(candidate);
              return { ok: false as const, error: 'Claude Code needs you to sign in again. Open Claude Code on this machine and sign in, then start this action again. Nothing was queued or spent.' };
            },
          }),
        enqueueJob: async (opts) => {
          opinionEnqueueCalls += 1;
          return enqueueJob({ ...opts, kick: false });
        },
      },
    );
    assert.equal(opinionExpired.ok, false);
    if (opinionExpired.ok) assert.fail("expired Opinion OAuth must refuse");
    assert.match(opinionExpired.error, /Claude Code needs you to sign in again/i);
    assert.deepEqual(opinionCandidates, ["claude-frontier"]);
    assert.equal(opinionSchemaCalls, 0);
    assert.equal(opinionSqlCalls, 0);
    assert.equal(opinionEnqueueCalls, 0);
    assert.deepEqual(await countsFor(userId), afterStory);

    const opinionReady = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: editor.newsroomId },
        subject: "The city should publish water-hearing exhibits before the meeting.",
        askedFor: "Explain the public-records stakes.",
        modelChoice: "claude-frontier",
      },
      {
        ensureEditorialRequestSchema: async () => undefined,
        checkReadiness: (choice) =>
          checkOpinionReadiness(choice, {
            findVoice: async () => ({ ok: true as const, voice: { path: "C:/voice.md" } }),
            probeCandidate: async (candidate) => {
              opinionCandidates.push(candidate);
              return { ok: true as const, label: "Claude Opus", choice: candidate };
            },
          }),
        enqueueJob: async (opts) => {
          opinionEnqueueCalls += 1;
          return enqueueJob({ ...opts, kick: false });
        },
      },
    );
    assert.equal(opinionReady.ok, true);
    assert.equal(opinionReady.modelChoice, "claude-frontier");
    assert.equal(opinionEnqueueCalls, 1);

    const final = await countsFor(userId);
    assert.deepEqual(final, { jobs: 2, requests: 1, drafts: 0, rate: 2, audit: 1 });
    const persistedJobs = await sql<{ kind: string; model_choice: string }>`
      select kind, model_choice from desk_jobs where user_id = ${userId} order by id
    `;
    assert.deepEqual(persistedJobs, [
      { kind: "draft", model_choice: "codex-frontier" },
      { kind: "editorial", model_choice: "claude-frontier" },
    ]);
    const [request] = await sql<{ model_choice: string; subject: string }>`
      select model_choice, subject from editorial_requests where user_id = ${userId}
    `;
    assert.deepEqual(request, {
      model_choice: "claude-frontier",
      subject: "The city should publish water-hearing exhibits before the meeting.",
    });
  });

  it("marks an Opinion request terminal when enqueue fails and never audits phantom work", async () => {
    const sql = await ensureCommitBoundarySchema();
    const userId = `opinion-enqueue-failure-${Date.now()}-${Math.random()}`;
    let auditCalls = 0;
    const result = await commitOpinionForAuthenticatedEditor(
      {
        context: { userId, newsroomId: 1 },
        subject: "Longmont should keep its public museum open on Sundays.",
        modelChoice: "auto",
      },
      {
        checkReadiness: async () => ({
          ready: true,
          why: "",
          problems: [],
          effectiveChoice: "auto" as const,
        }),
        ensureEditorialRequestSchema: async () => undefined,
        assertRate: async () => undefined,
        enqueueJob: async () => {
          throw new Error("injected queue outage");
        },
        findOpenJob: async () => null,
        audit: async () => {
          auditCalls += 1;
        },
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("an enqueue failure must not report success");
    assert.match(result.error, /nothing is writing/i);
    assert.equal(auditCalls, 0);
    const rows = await sql<{ id: number; error: string | null; finished_at: string | null }>`
      select id, error, finished_at from editorial_requests where user_id = ${userId}
    `;
    assert.equal(rows.length, 1);
    assert.match(rows[0]?.error ?? "", /injected queue outage/i);
    assert.ok(rows[0]?.finished_at, "the failed request must be terminal, never look in-progress");
    const jobs = await sql<{ count: number }>`
      select count(*) as count from desk_jobs
      where kind = 'editorial' and subject_id = ${rows[0]!.id}
    `;
    assert.equal(Number(jobs[0]?.count ?? 0), 0);
    await sql`delete from editorial_requests where user_id = ${userId}`;
  });

  it("returns a durable queued Opinion as success when only the audit write fails", async () => {
    const sql = await ensureCommitBoundarySchema();
    const userId = `opinion-audit-failure-${Date.now()}-${Math.random()}`;
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const result = await commitOpinionForAuthenticatedEditor(
        {
          context: { userId, newsroomId: 1 },
          subject: "Longmont should preserve free access to its local history collection.",
          modelChoice: "auto",
        },
        {
          checkReadiness: async () => ({
            ready: true,
            why: "",
            problems: [],
            effectiveChoice: "auto" as const,
          }),
          ensureEditorialRequestSchema: async () => undefined,
          assertRate: async () => undefined,
          enqueueJob: (opts) => enqueueJob({ ...opts, kick: false }),
          audit: async () => {
            throw new Error("injected audit outage");
          },
        },
      );

      assert.equal(result.ok, true);
      if (!result.ok) assert.fail(result.error);
      const requests = await sql<{ id: number; model_choice: string; finished_at: string | null }>`
        select id, model_choice, finished_at from editorial_requests where user_id = ${userId}
      `;
      assert.deepEqual(requests, [
        { id: result.requestId, model_choice: "auto", finished_at: null },
      ]);
      const jobs = await sql<{ id: number; model_choice: string; status: string }>`
        select id, model_choice, status from desk_jobs where id = ${result.jobId}
      `;
      assert.deepEqual(jobs, [{ id: result.jobId, model_choice: "auto", status: "queued" }]);
      await sql`delete from desk_jobs where id = ${result.jobId}`;
      await sql`delete from editorial_requests where id = ${result.requestId}`;
    } finally {
      console.error = originalError;
    }
  });

  it("reports an existing Story model conflict before spending another rate unit", async () => {
    const sql = await ensureCommitBoundarySchema();
    const userId = `story-model-conflict-${Date.now()}-${Math.random()}`;
    const [lead] = await sql<{ id: number }>`
      insert into leads (newsroom_id, user_id, headline, why)
      values (${1}, ${userId}, ${"Library board schedules a budget hearing"},
              ${"The hearing is open to residents."})
      returning id
    `;
    assert.ok(lead);
    const open = await enqueueJob({
      userId,
      newsroomId: 1,
      kind: "draft",
      subjectId: lead.id,
      modelChoice: "local",
      kick: false,
    });
    let rateCalls = 0;
    const result = await commitStoryDraftForAuthenticatedEditor(
      {
        context: { userId, newsroomId: 1 },
        leadId: lead.id,
        modelChoice: "codex-frontier",
      },
      {
        probeProvider: async () => ({
          ok: true as const,
          label: "Codex Sol",
          choice: "codex-frontier" as const,
        }),
        assertRate: async () => {
          rateCalls += 1;
        },
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("a different open model must conflict");
    assert.equal(result.kind, "model-conflict");
    assert.equal(result.jobId, open.id);
    assert.equal(rateCalls, 0);
    await sql`delete from desk_jobs where id = ${open.id}`;
    await sql`delete from leads where id = ${lead.id}`;
  });
});
