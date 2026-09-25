import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
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
  /*
    The rungs Automatic's ladder starts on (0.6.63, Unit Y item 1). A rung's
    enabledness reads its own off switch and its own endpoint, so a test that
    means to control which rung answers has to own both -- and clearing them is
    also what keeps an ambient shell value out of every test in this file.
  */
  "TOWNREPORTER_DEEPSEEK",
  "TOWNREPORTER_QWEN",
  "TOWNREPORTER_DEEPSEEK_BASE_URL",
  "TOWNREPORTER_QWEN_BASE_URL",
  "TOWNREPORTER_DEEPSEEK_MODEL",
  "TOWNREPORTER_QWEN_MODEL",
  // The ladder's last rung is Codex, so a test that reaches it must point at
  // the fake CLI (scripts/fakes/fake-codex-cli.mjs, which never calls a model)
  // rather than at whatever `codex` this machine has.
  "CODEX_CLI_PATH",
  "FAKE_CODEX_SIGNED_IN",
] as const;

/**
 * The Codex rung's own stand-in, the same one ai.test.ts uses: `probeCodex`
 * runs `codex login status` and nothing else, so pointing this at the fake is
 * the difference between "Automatic reached Codex Terra" and "this test
 * started a real agent CLI on the machine".
 */
const FAKE_CODEX = fileURLToPath(
  new URL("../../../scripts/fakes/fake-codex-cli.mjs", import.meta.url),
);

/**
 * Rung 1's endpoint, named so a test can make that ONE rung answer.
 *
 * A rung is enabled by its own endpoint or by a discovery probe (see
 * provider-registry.ts), and a test process has neither -- so a test that
 * means "Automatic should land on DeepSeek" has to name it. The address is
 * never dialled: the stubbed fetch in `before` answers it.
 */
const DEEPSEEK_URL = "http://127.0.0.1:11434/v1";
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

  The stubbed fetch is what makes the named Claude probe succeed
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

/**
 * DeepSeek answerable, Codex switched off.
 *
 * 0.6.63 (Unit Y item 1) put DeepSeek v4.1 Flash first on every Automatic
 * surface, Dark Desk included, so this is the env in which Dark's Automatic
 * has a first rung to land on. Codex is off so a probe can never reach the CLI
 * genuinely installed on a developer machine -- the same reason CLAUDE_ONLY
 * switches it off.
 */
const DEEPSEEK_READY = {
  TOWNREPORTER_DEEPSEEK_BASE_URL: DEEPSEEK_URL,
  TOWNREPORTER_CODEX: "0",
};

let originalFetch: typeof globalThis.fetch;

before(() => {
  originalFetch = globalThis.fetch;
  /*
    Two answers, one stub: the DeepSeek endpoint reports a model list holding
    exactly the model rung 1 names (which is what `probeOpenAi` verifies), and
    everything else answers `{}` -- not a model list, so LM Studio's rung finds
    no server where it points and nothing else can accidentally look ready.
  */
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(DEEPSEEK_URL)) {
      return new Response(
        JSON.stringify({ data: [{ id: "deepseek-v4.1-flash:cloud" }] }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
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
  return sql<{ id: number; model_choice: string; model_choice_source: string; lane: string; result_json: string }>`
    select id, model_choice, model_choice_source, lane, result_json from desk_jobs
    where kind = 'dark' and subject_id = ${investigationId} order by id
  `;
}

describe("Dark Desk carries the editor's model choice onto the job", { timeout: 60000 }, () => {
  it("pins an explicit choice and records that the EDITOR made it", async () => {
    await withEnv(CLAUDE_ONLY, async () => {
      const userId = `dark-choice-editor-${Date.now()}`;
      const id = await makeInvestigation(userId);

      const result = await startDarkRound({ userId }, id, "claude-frontier", "xhigh");
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
      assert.deepEqual(JSON.parse(jobs[0]!.result_json), {
        requestedRuntime: "claude-frontier",
        requestedEffort: "xhigh",
        actualRuntime: "claude-frontier",
        modelEffort: "xhigh",
        preflightFailover: null,
      });
    });
  });

  it("resolves Automatic to a concrete provider and records that AUTOMATIC chose", async () => {
    await withEnv(DEEPSEEK_READY, async () => {
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

        The rung is DeepSeek, not Claude Sonnet, since 0.6.63 (Unit Y item 1):
        the owner's order is DeepSeek first for research and drafting, and Dark
        Desk is the surface that researches most. Claude Sonnet is still a hand
        pick on this menu; it is simply no longer a rung Automatic walks.
      */
      assert.equal(jobs[0]!.model_choice, "deepseek-flash");
      assert.equal(jobs[0]!.model_choice_source, "auto");
      const receipt = JSON.parse(jobs[0]!.result_json) as Record<string, unknown>;
      assert.equal(receipt.actualRuntime, "deepseek-flash");
      // Rung 1 answered, so nothing was passed over and the receipt carries no
      // skip list at all -- see `initialModelRuntimeReceipt`.
      assert.ok(
        !("skippedRungs" in receipt),
        "an empty skip list must not appear on the receipt",
      );
    });
  });

  /*
    0.6.63 (Unit Y items 1 and 2). Dark Desk's Automatic walks the registry
    ladder now, and a rung whose model has to be ALREADY loaded is skipped
    before it is probed rather than pinned -- with the reason on the job's
    receipt, so a round that ran on rung 3 cannot be mistaken for one that
    never offered rung 2.

    Rung 1 (DeepSeek) is out by its own off switch, rung 3 is the fake Codex
    CLI, and the LM Studio rung is the one under test: the stubbed fetch in
    `before` answers every endpoint with `{}` -- a body that is not a model
    list -- so discovery finds no server where the rung points and the skip is
    "its server did not answer". Which of the three skip reasons fires is the
    shared rule's business and is pinned in ai.test.ts ("not loaded" at
    src/lib/news/ai.test.ts:1134); what this test pins is that Dark Desk's
    Automatic path runs that rule at all, and that the editor's receipt says so.
  */
  it("skips a local rung it did not find loaded and records why on the receipt", async () => {
    await withEnv(
      {
        TOWNREPORTER_DEEPSEEK: "0",
        CODEX_CLI_PATH: FAKE_CODEX,
        FAKE_CODEX_SIGNED_IN: "1",
      },
      async () => {
        const userId = `dark-choice-skip-${Date.now()}`;
        const id = await makeInvestigation(userId);

        const result = await startDarkRound({ userId }, id, "auto");
        assert.equal(result.ok, true);

        const jobs = await darkJobs(id);
        assert.equal(jobs.length, 1);
        // The model line the editor reads: the rung that actually answered.
        assert.equal(jobs[0]!.model_choice, "codex-balanced");
        const receipt = JSON.parse(jobs[0]!.result_json) as { skippedRungs?: string[] };
        assert.deepEqual(receipt.skippedRungs, [
          "Qwen 3.6 35B skipped: its server did not answer",
        ]);
      },
    );
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

      const result = await startBriefJob({ userId }, id, "claude-frontier", "high");
      assert.equal(result.ok, true);

      await ensureJobsSchema();
      const sql = await getSql();
      const jobs = await sql<{ model_choice: string; model_choice_source: string; lane: string; result_json: string }>`
        select model_choice, model_choice_source, lane, result_json from desk_jobs
        where kind = 'brief' and subject_id = ${id}
      `;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.model_choice, "claude-frontier");
      assert.equal(jobs[0]!.model_choice_source, "editor");
      assert.deepEqual(JSON.parse(jobs[0]!.result_json), {
        requestedRuntime: "claude-frontier",
        requestedEffort: "high",
        actualRuntime: "claude-frontier",
        modelEffort: "high",
        preflightFailover: null,
      });
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
