import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { __setJobWorkForTest, drainQueuedJobs, ensureJobsSchema, laneForKind } from "./jobs.ts";
import { startBriefJob, startDarkRound } from "./dark.ts";

/**
 * Dark Desk's commit boundary (0.6.2).
 *
 * Until this release Dark Desk was the one surface where an AI did something
 * and the editor could not say which model did it: `synthesizeSignals`,
 * `grokPlanner` and `buildBrief` all called `grokChat` with no `choice`, so a
 * round ran on whatever `resolveProvider()` happened to prefer on the machine
 * -- while the desk's own picker documentation said the editor decides.
 *
 * These tests drive `startDarkRound` and `startBriefJob` against a real
 * (PGLite) database and then read the database back, rather than trusting the
 * return value: the whole point of a commit boundary is what it does and does
 * not write.
 */

const ENV_KEYS = [
  "XAI_API_KEY",
  "GROK_API_KEY",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "TOWNREPORTER_CLAUDE_CODE",
  "TOWNREPORTER_CODEX",
  "CLAUDE_CLI_PATH",
] as const;

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/*
  Claude reachable, everything else off.

  The stubbed fetch is what makes `probeProvider("claude-frontier")` succeed
  without a real key or a real request; Codex is switched off so a probe can
  never reach the CLI that is genuinely installed on a developer machine and
  make this test depend on whether that login happens to be live.
*/
const CLAUDE_ONLY = {
  ANTHROPIC_API_KEY: "test-key-validated-by-stub",
  TOWNREPORTER_CODEX: "0",
};

/** Neither CLI, no keys: the genuinely unconfigured desk. */
const NOTHING = { TOWNREPORTER_CLAUDE_CODE: "0", TOWNREPORTER_CODEX: "0" };

let originalFetch: typeof globalThis.fetch;

before(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof globalThis.fetch;
  // No job may actually run: the work behind a dark job is a real, paid,
  // multi-minute dig. The queue machinery is exercised; the dig is not.
  __setJobWorkForTest(async () => {});
});

after(async () => {
  /*
    `enqueueJob` (called by every `startDarkRound`/`startBriefJob` above)
    kicks a drain via `setTimeout(fn, 0)` (jobs.ts `kickJobs`), fire-and-
    forget -- it is not awaited by the function that queued it. Left alone,
    that scheduled drain can fire AFTER this hook has already restored the
    real `fetch` and the real per-test env (see `withEnv`'s `finally`), so it
    runs against `runWork` still pointed at the stub -- usually -- but a
    slow enough tick lets it fire once `__setJobWorkForTest()` below has
    already put `runWork` back to the real dispatcher, which spawns a REAL
    Claude Code CLI process using whatever is actually configured on the
    machine. Draining explicitly, while the stub is still installed and
    `fetch` is still stubbed, closes that race deterministically instead of
    hoping every kicked timer loses it.
  */
  await drainQueuedJobs();
  globalThis.fetch = originalFetch;
  __setJobWorkForTest();
});

async function makeInvestigation(userId: string): Promise<number> {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title, status, budget, summary)
    values (${userId}, ${"Model choice test"}, ${"open"}, ${5}, ${""})
    returning id
  `;
  return rows[0]!.id;
}

async function darkJobs(investigationId: number) {
  await ensureJobsSchema();
  const sql = await getSql();
  return sql<{ id: number; model_choice: string; model_choice_source: string; lane: string }>`
    select id, model_choice, model_choice_source, lane from desk_jobs
    where kind = 'dark' and subject_id = ${investigationId} order by id
  `;
}

describe("Dark Desk carries the editor's model choice onto the job", { timeout: 60000 }, () => {
  it("pins an explicit choice and records that the EDITOR made it", async () => {
    await withEnv(CLAUDE_ONLY, async () => {
      const userId = `dark-choice-editor-${Date.now()}`;
      const id = await makeInvestigation(userId);

      const result = await startDarkRound({ userId }, id, "claude-frontier");
      assert.equal(result.ok, true);

      const jobs = await darkJobs(id);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.model_choice, "claude-frontier");
      /*
        "editor" is what stops the mid-round failover. Choosing one model IS
        choosing not to run the others -- the same rule Story and Scan follow
        (see automatic-failover.ts).
      */
      assert.equal(jobs[0]!.model_choice_source, "editor");
    });
  });

  it("resolves Automatic to a concrete provider and records that AUTOMATIC chose", async () => {
    await withEnv(CLAUDE_ONLY, async () => {
      const userId = `dark-choice-auto-${Date.now()}`;
      const id = await makeInvestigation(userId);

      const result = await startDarkRound({ userId }, id, "auto");
      assert.equal(result.ok, true);

      const jobs = await darkJobs(id);
      assert.equal(jobs.length, 1);
      /*
        Not "auto": the probe already picked, and the row records WHO will run
        so the round cannot change author between the press and the queue
        reaching it. That is the defect migrations/0026 fixed for Story.
      */
      assert.equal(jobs[0]!.model_choice, "claude-frontier");
      assert.equal(jobs[0]!.model_choice_source, "auto");
    });
  });

  it("refuses before writing anything when no model is reachable", async () => {
    await withEnv(NOTHING, async () => {
      const userId = `dark-choice-none-${Date.now()}`;
      const id = await makeInvestigation(userId);

      const round = await startDarkRound({ userId }, id, "claude-frontier");
      assert.equal(round.ok, false);
      const brief = await startBriefJob({ userId }, id, "claude-frontier");
      assert.equal(brief.ok, false);

      await ensureJobsSchema();
      const sql = await getSql();
      const jobs = await sql<{ id: number }>`
        select id from desk_jobs where subject_id = ${id} and kind in ('dark', 'brief')
      `;
      assert.equal(jobs.length, 0, "a refusal must not leave a job row behind");
    });
  });

  it("reports a model conflict instead of queueing a second round on another model", async () => {
    await withEnv(CLAUDE_ONLY, async () => {
      const userId = `dark-choice-conflict-${Date.now()}`;
      const id = await makeInvestigation(userId);

      /*
        The open job is inserted directly rather than started with a second
        provider, so this test never depends on whether the Codex CLI on the
        developer's machine happens to be signed in. What is under test is the
        conflict answer, not the other provider's readiness.
      */
      await ensureJobsSchema();
      const sql = await getSql();
      await sql`
        insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice,
                               model_choice_source, lane, status, stage)
        values (1, ${userId}, 'dark', ${id}, 'codex-balanced', 'editor', 'default', 'running', 'Reading')
      `;

      const result = await startDarkRound({ userId }, id, "claude-frontier");
      assert.equal(result.ok, false);
      assert.equal((result as { kind?: string }).kind, "model-conflict");
      assert.match(String((result as { error?: string }).error), /Codex Terra/);

      const jobs = await darkJobs(id);
      assert.equal(jobs.length, 1, "the conflict must not have queued a second round");
    });
  });
});

describe("the brief is a job, on the default lane", { timeout: 60000 }, () => {
  it("queues a brief carrying the same model choice a round would", async () => {
    await withEnv(CLAUDE_ONLY, async () => {
      const userId = `dark-brief-${Date.now()}`;
      const id = await makeInvestigation(userId);

      const result = await startBriefJob({ userId }, id, "claude-frontier");
      assert.equal(result.ok, true);

      await ensureJobsSchema();
      const sql = await getSql();
      const jobs = await sql<{ model_choice: string; model_choice_source: string; lane: string }>`
        select model_choice, model_choice_source, lane from desk_jobs
        where kind = 'brief' and subject_id = ${id}
      `;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.model_choice, "claude-frontier");
      assert.equal(jobs[0]!.model_choice_source, "editor");
      /*
        The default lane, not `editorial`. The editorial lane is deliberately
        one-at-a-time because an editorial is a forty-minute job; writing a
        brief is one model call and must not queue behind one.
      */
      assert.equal(jobs[0]!.lane, "default");
      assert.equal(laneForKind("brief"), "default");
    });
  });
});
