import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { ensureJobsSchema } from "./jobs.ts";
import { startDarkRound } from "./dark.ts";

/**
 * QA-002 (Critical): an outside audit ran Dark Desk with no model provider
 * configured and watched it report SUCCESS — twelve cards filed, sourced from
 * LinkedIn, with no model ever consulted. `dark_runs.error` recorded "AI is
 * not available…" but `desk_jobs.status` still landed on `completed`, and
 * nothing downstream could tell the fallback crawl from a real dig.
 *
 * The fix mirrors the one Scan already has (`scanPreflight` in
 * preflight.ts, wired into `runScan` in desk.ts): ask before spending
 * anything. `startDarkRound` is the code `continueInvestigation` calls to
 * actually start a round — the one place a "dark" job gets enqueued for an
 * existing investigation — so it is the right and only place that needs to
 * refuse. These tests drive that function directly against a real (PGLite)
 * database and check the database afterward, not just the return value: a
 * refusal that still quietly wrote a job row would be exactly as dishonest
 * as the bug being fixed.
 */

const ENV_KEYS = [
  "XAI_API_KEY",
  "GROK_API_KEY",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "OPENAI_API_KEY",
  "XAI_MODEL",
  "XAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_EFFORT",
  "TOWNREPORTER_CLAUDE_CODE",
  "TOWNREPORTER_CODEX",
  "CLAUDE_CLI_PATH",
  /*
    Automatic's local rungs had to join this list in 0.6.63 (Unit Y item 1),
    when Dark Desk's Automatic began walking the same ladder Story and Scan
    walk: a rung's enabledness reads its own off switch and its own endpoint,
    so a test that means to control which rung answers has to own both.
  */
  "TOWNREPORTER_DEEPSEEK",
  "TOWNREPORTER_QWEN",
  "TOWNREPORTER_DEEPSEEK_BASE_URL",
  "TOWNREPORTER_QWEN_BASE_URL",
  "TOWNREPORTER_DEEPSEEK_MODEL",
  "TOWNREPORTER_QWEN_MODEL",
  "CODEX_CLI_PATH",
  "FAKE_CODEX_SIGNED_IN",
] as const;

/**
 * Rung 1's endpoint, named so a test can make that ONE rung answer.
 *
 * A rung is enabled by its own endpoint or by a discovery probe, and a test
 * process has neither -- so a test that means "a writing model is set up on
 * this desk" has to name one. The address is never dialled: the stubbed fetch
 * in the test below answers it.
 */
const DEEPSEEK_URL = "http://127.0.0.1:11434/v1";

/*
  No keys, neither local CLI, and no local model switched on — the exact
  first-run state the audit walked.

  `TOWNREPORTER_CODEX: "0"` joined this in 0.6.2. Dark Desk's preflight used
  to probe with no argument at all, which walked `resolveProvider()`'s default
  chain and never reached Codex; now it probes the editor's actual choice, and
  Automatic's ladder includes Codex. On a developer machine with the Codex CLI
  installed and signed in, "no model is configured" was no longer true with
  only Claude Code switched off — the test was describing a machine that no
  longer existed, not a defect in the refusal.

  The two local rungs are switched off by their own off switches for the same
  reason (Unit Y item 1): Dark Desk's Automatic walks the registry ladder now,
  and a desk with LM Studio or Ollama running on it is not the first-run desk
  this test is about. Off switches, not "nothing is listening", so the answer
  no longer depends on what happens to be running on the machine.
*/
const BARE = {
  TOWNREPORTER_CLAUDE_CODE: "0",
  TOWNREPORTER_CODEX: "0",
  TOWNREPORTER_DEEPSEEK: "0",
  TOWNREPORTER_QWEN: "0",
};

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

async function makeInvestigation(userId: string): Promise<number> {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into investigations (user_id, title, status, budget, summary)
    values (${userId}, ${"Preflight test investigation"}, ${"open"}, ${5}, ${""})
    returning id
  `;
  return rows[0]!.id;
}

describe("dark desk preflight (QA-002)", { timeout: 60000 }, () => {
  it("refuses before enqueueing any work when no model is configured", async () => {
    await withEnv(BARE, async () => {
      const userId = `dark-preflight-${Date.now()}`;
      const investigationId = await makeInvestigation(userId);

      const result = await startDarkRound({ userId }, investigationId);

      assert.equal(result.ok, false, "a round must not appear to start with no model reachable");
      if (result.ok) return;
      assert.equal((result as { kind?: string }).kind, "unconfigured");
      assert.doesNotMatch(
        String((result as { error?: string }).error ?? ""),
        /\btry again\b|\bretry\b/i,
        "must not invite a retry that installing no model cannot satisfy",
      );

      // The actual guarantee: nothing got queued. A refusal that still wrote
      // a job row would leave the same false "completed" outcome the audit
      // found, just one hop later.
      await ensureJobsSchema();
      const sql = await getSql();
      const jobs = await sql<{ id: number; status: string }>`
        select id, status from desk_jobs where kind = 'dark' and subject_id = ${investigationId}
      `;
      assert.equal(
        jobs.length,
        0,
        "no dark job should ever be enqueued when no model is configured",
      );
    });
  });

  it("does not refuse once a provider is configured — falls through to the normal checks", async () => {
    /*
      Deliberately does not use a real investigation id here: once the guard
      passes, `startDarkRound` would enqueue a job (which drains in the
      background and would make a real outbound call with this fake key).
      Using an id that cannot exist proves the guard let the request through
      — the function reaches the ordinary "Investigation not found" answer
      instead of a preflight refusal — without ever starting that job.
    */
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Rung 1 answers with a model list holding exactly the model it names,
      // which is what `probeOpenAi` verifies; everything else answers `{}`, so
      // no other rung can accidentally look configured.
      if (url.startsWith(DEEPSEEK_URL)) {
        return new Response(JSON.stringify({ data: [{ id: "deepseek-v4.1-flash:cloud" }] }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      await withEnv(
        {
          /*
            DeepSeek is the configured provider here, not Claude: since 0.6.63
            (Unit Y item 1) Claude Sonnet is a hand pick, so a reachable Claude
            key no longer makes a rung ready and this test would now be
            asserting a refusal it did not mean to describe.
          */
          TOWNREPORTER_DEEPSEEK_BASE_URL: DEEPSEEK_URL,
          // The other two rungs are off, so this test never runs the Codex CLI
          // installed on a developer machine.
          TOWNREPORTER_QWEN: "0",
          TOWNREPORTER_CODEX: "0",
        },
        async () => {
          const userId = `dark-preflight-ok-${Date.now()}`;
          const result = await startDarkRound({ userId }, 999_999_999);
          assert.equal(result.ok, false);
          if (result.ok) return;
          assert.equal((result as { error?: string }).error, "Investigation not found");
          assert.notEqual(
            (result as { kind?: string }).kind,
            "unconfigured",
            "a provider that answered its readiness probe must not be reported as unconfigured",
          );
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
