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
  "CLAUDE_CLI_PATH",
] as const;

/** No keys AND no local CLI — the exact first-run state the audit walked. */
const BARE = { TOWNREPORTER_CLAUDE_CODE: "0" };

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
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    try {
      await withEnv({ ANTHROPIC_API_KEY: "test-key-validated-by-stub" }, async () => {
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
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
