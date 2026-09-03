import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAutomaticFailover,
  failoverReasonPhrase,
  failoverNoteSentence,
} from "./automatic-failover.ts";

/**
 * Live case 2026-09-02, job 41: Automatic pinned to Claude Opus, and Claude
 * Code's login expired between the commit-time probe and the actual draft
 * call. The desk never tried Codex, because by the time the job ran nothing
 * on the row remembered Automatic had picked it. This is the exact wording
 * the provider returned.
 */
const LIVE_401 =
  "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";

/**
 * Live case 2026-09-02, second one, same day: Automatic pinned to Claude
 * Opus, both CLIs signed in, and the draft died with this exact wording --
 * a timeout that sent nothing back. Automatic never tried Codex.
 */
const LIVE_TIMEOUT_NO_OUTPUT = "Claude Code request timed out after 150s, 0 bytes out";

describe("planAutomaticFailover", () => {
  it("moves Automatic to Codex Terra when Claude's login lapsed mid-run and Codex is ready", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: LIVE_401,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
      },
    });
    assert.deepEqual(plan, { next: "codex-balanced", label: "Codex Terra", reason: "auth" });
    assert.deepEqual(calls, ["codex-balanced"], "must not probe the current rung or any before it");
  });

  it("moves Automatic to Codex Terra when Claude's draft timed out with no output and Codex is ready", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: LIVE_TIMEOUT_NO_OUTPUT,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
      },
    });
    assert.deepEqual(plan, { next: "codex-balanced", label: "Codex Terra", reason: "timeout" });
    assert.deepEqual(calls, ["codex-balanced"], "must not probe the current rung or any before it");
  });

  it("never fails over an editor's explicit model choice, even on the same login lapse", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "editor",
      current: "claude-frontier",
      error: LIVE_401,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
      },
    });
    assert.equal(plan, null);
    assert.deepEqual(calls, [], "an explicit choice must never even probe another provider");
  });

  it("never fails over an editor's explicit model choice, even on the same timeout", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "editor",
      current: "claude-frontier",
      error: LIVE_TIMEOUT_NO_OUTPUT,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
      },
    });
    assert.equal(plan, null);
    assert.deepEqual(calls, [], "an explicit choice must never even probe another provider");
  });

  it("returns null when Automatic's next rung is not ready either", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: LIVE_401,
      probe: async () => ({ ok: false, error: "Codex is not installed on this machine." }),
    });
    assert.equal(plan, null);
  });

  it("moves on a timeout even with auth-shaped wording nearby, and reports it as a timeout, not an auth lapse", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: "Claude Code readiness check timed out.",
      probe: async () => ({ ok: true, label: "Codex Terra", choice: "codex-balanced" }),
    });
    assert.deepEqual(plan, { next: "codex-balanced", label: "Codex Terra", reason: "timeout" });
  });

  it("does not fail over on a timeout when Automatic's next rung is not ready either", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: LIVE_TIMEOUT_NO_OUTPUT,
      probe: async () => ({ ok: false, error: "Codex is not installed on this machine." }),
    });
    assert.equal(plan, null);
  });

  it("does not fail over on a timeout once the ladder's last rung has already failed", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "codex-balanced",
      error: LIVE_TIMEOUT_NO_OUTPUT,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Claude Opus", choice: "claude-frontier" };
      },
    });
    assert.equal(plan, null);
    assert.deepEqual(calls, [], "there is no rung after the last one to probe");
  });

  it("never fails over on a content refusal", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: "The writing model declined this request",
      probe: async () => ({ ok: true, label: "Codex Terra", choice: "codex-balanced" }),
    });
    assert.equal(plan, null);
  });

  it("never fails over on an empty model response", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error: "empty model response",
      probe: async () => ({ ok: true, label: "Codex Terra", choice: "codex-balanced" }),
    });
    assert.equal(plan, null);
  });

  it("returns null once the ladder's last rung has already failed", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "codex-balanced",
      error: "Codex authentication has expired or Codex is signed out. Open Codex, sign in again, then try again.",
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Claude Opus", choice: "claude-frontier" };
      },
    });
    assert.equal(plan, null);
    assert.deepEqual(calls, [], "there is no rung after the last one to probe");
  });
});

/**
 * 0.6.8: `desk_jobs.failover_note` is the durable twin of the transient
 * `stage` write every failover site already made ("Switched to <label>:
 * <reason>") -- it survives past "Done", which overwrites `stage`. Both the
 * stage wording and the durable note share this same phrase-builder so they
 * can never drift into two different explanations for the same switch.
 */
describe("failoverReasonPhrase", () => {
  it("reads as a timeout for reason 'timeout'", () => {
    assert.equal(failoverReasonPhrase("Claude Opus", "timeout"), "Claude Opus timed out");
  });

  it("reads as a lapsed sign-in for reason 'auth'", () => {
    assert.equal(failoverReasonPhrase("Claude Opus", "auth"), "Claude Opus sign-in lapsed");
  });
});

describe("failoverNoteSentence", () => {
  it("builds the durable sentence for a timeout switch", () => {
    assert.equal(
      failoverNoteSentence("Codex Terra", "Claude Opus", "timeout"),
      "This draft moved to Codex Terra because Claude Opus timed out",
    );
  });

  it("builds the durable sentence for a sign-in-lapse switch", () => {
    assert.equal(
      failoverNoteSentence("Codex Terra", "Claude Opus", "auth"),
      "This draft moved to Codex Terra because Claude Opus sign-in lapsed",
    );
  });
});

/**
 * Audit-lite 0.6.8 FINDING-001: `failoverReasonPhrase` was extracted so the
 * "<label> timed out" / "<label> sign-in lapsed" wording has exactly one
 * source of truth, but `dark.ts` and `scan-model-run.ts` kept their own
 * hand-typed copies of the identical ternary instead of calling it -- so
 * the single-source-of-truth guarantee the extraction was FOR didn't
 * actually hold. Both call sites were switched over to the shared helper
 * (0.6.13). This guard stops a future edit from quietly reintroducing a
 * duplicate: the literal wording `failoverReasonPhrase` produces must never
 * appear, hand-typed, in any *production* source file under src/lib/news
 * other than this one.
 */
describe("failoverReasonPhrase wording has exactly one source", () => {
  it("no other production file under src/lib/news hand-types the 'sign-in lapsed' / 'timed out' wording", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = fileURLToPath(new URL(".", import.meta.url));
    const offenders: string[] = [];
    for (const name of fs.readdirSync(here)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      if (name === "automatic-failover.ts") continue; // the one source of truth
      const text = fs.readFileSync(path.join(here, name), "utf8");
      // "sign-in lapsed" is distinctive to failoverReasonPhrase's own output
      // (unlike "timed out", which legitimately appears in unrelated
      // provider error messages, e.g. ai.ts's own timeout error text) --
      // any hand-typed copy of the ternary this guards against necessarily
      // includes this exact phrase.
      if (text.includes("sign-in lapsed")) {
        offenders.push(name);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these files hand-type the failover switch-reason wording instead of calling ` +
        `failoverReasonPhrase()/failoverNoteSentence() from automatic-failover.ts: ` +
        `${JSON.stringify(offenders)}`,
    );
  });
});
