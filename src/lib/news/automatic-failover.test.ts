import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planAutomaticFailover,
  automaticFailoverReason,
  failoverReasonPhrase,
  failoverNoteSentence,
  appendStoryFailoverNote,
} from "./automatic-failover.ts";
import { unreadableReplyError } from "./ai.ts";

it("appends a third Story hop without dropping earlier reasons or duplicating a retried receipt", () => {
  const first = failoverNoteSentence("DeepSeek v4.1 Flash", "Claude Haiku", "auth");
  const second = failoverNoteSentence("Codex Sol 6.1", "DeepSeek v4.1 Flash", "quota");
  const third = failoverNoteSentence("Claude Sonnet", "Codex Sol 6.1", "timeout");
  const history = appendStoryFailoverNote(appendStoryFailoverNote(first, second), third);
  assert.equal(history, "Claude Haiku sign-in lapsed -> DeepSeek v4.1 Flash reached its usage limit -> Codex Sol 6.1 timed out -> Claude Sonnet");
  assert.equal(appendStoryFailoverNote(history, third), history);
});

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

/**
 * The Codex-then-Sonnet hop both 2026-09-02 live cases walked. It is no longer
 * the shared Automatic ladder -- 0.6.63 Unit Y moved Story and Scan to
 * DeepSeek, then Qwen, then Terra -- but it is still the ladder a forced
 * surface (draft batch, scheduled scan, meeting redraft) and a hand-picked
 * Claude run fail over along. Naming it here keeps the two incidents
 * regression-tested against the ladder they actually happened on, instead of
 * asserting the old contents through the default.
 */
const CODEX_TO_SONNET = ["codex-balanced", "claude-sonnet"] as const;

describe("planAutomaticFailover", () => {
  it("moves Automatic to Claude Sonnet when Codex login lapses mid-run", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "codex-balanced",
      ladder: CODEX_TO_SONNET,
      error: "Codex authentication has expired or Codex is signed out.",
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Claude Sonnet", choice: "claude-sonnet" };
      },
    });
    assert.deepEqual(plan, { next: "claude-sonnet", label: "Claude Sonnet", reason: "auth" });
    assert.deepEqual(calls, ["claude-sonnet"], "must not probe the current rung or any before it");
  });

  it("moves Automatic to Claude Sonnet when Codex times out with no output", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "codex-balanced",
      ladder: CODEX_TO_SONNET,
      error: "Codex request timed out after 150s, 0 bytes out",
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Claude Sonnet", choice: "claude-sonnet" };
      },
    });
    assert.deepEqual(plan, { next: "claude-sonnet", label: "Claude Sonnet", reason: "timeout" });
    assert.deepEqual(calls, ["claude-sonnet"], "must not probe the current rung or any before it");
  });

  it("moves Automatic to Claude Sonnet when Codex reaches its usage allowance", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "codex-balanced",
      ladder: CODEX_TO_SONNET,
      error: "Codex API error 429: usage limit reached; resets 11:30pm (America/Denver).",
      probe: async () => ({ ok: true, label: "Claude Sonnet", choice: "claude-sonnet" }),
    });
    assert.deepEqual(plan, { next: "claude-sonnet", label: "Claude Sonnet", reason: "quota" });
  });

  it("moves Automatic to Claude Sonnet when Codex is unavailable", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "codex-balanced",
      ladder: CODEX_TO_SONNET,
      error: "Codex is unreachable on this machine.",
      probe: async () => ({ ok: true, label: "Claude Sonnet", choice: "claude-sonnet" }),
    });
    assert.deepEqual(plan, { next: "claude-sonnet", label: "Claude Sonnet", reason: "unavailable" });
  });

  it("recognizes plain unavailable and HTTP 503 provider failures", async () => {
    for (const error of [
      "Codex is unavailable.",
      "Codex API error (503): upstream unavailable",
    ]) {
      const plan = await planAutomaticFailover({
        source: "auto",
        current: "codex-balanced",
        ladder: CODEX_TO_SONNET,
        error,
        probe: async () => ({ ok: true, label: "Claude Sonnet", choice: "claude-sonnet" }),
      });
      assert.deepEqual(plan, {
        next: "claude-sonnet",
        label: "Claude Sonnet",
        reason: "unavailable",
      });
    }
  });

  it("uses a surface-specific ladder without rerouting the shared Story ladder", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-sonnet",
      error: LIVE_TIMEOUT_NO_OUTPUT,
      ladder: ["claude-sonnet", "codex-balanced"],
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" };
      },
    });

    assert.deepEqual(plan, { next: "codex-balanced", label: "Codex Sol 6.1 (balanced)", reason: "timeout" });
    assert.deepEqual(calls, ["codex-balanced"]);
  });

  it("routes an editor's preferred model to the Automatic ladder's first rung around the same login lapse", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "editor",
      current: "claude-frontier",
      error: LIVE_401,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "DeepSeek v4.1 Flash", choice: "deepseek-flash" };
      },
    });
    assert.deepEqual(plan, { next: "deepseek-flash", label: "DeepSeek v4.1 Flash", reason: "auth" });
    assert.deepEqual(calls, ["deepseek-flash"]);
  });

  it("routes an editor's preferred model to the Automatic ladder's first rung around the same timeout", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "editor",
      current: "claude-frontier",
      error: LIVE_TIMEOUT_NO_OUTPUT,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "DeepSeek v4.1 Flash", choice: "deepseek-flash" };
      },
    });
    assert.deepEqual(plan, {
      next: "deepseek-flash",
      label: "DeepSeek v4.1 Flash",
      reason: "timeout",
    });
    assert.deepEqual(calls, ["deepseek-flash"]);
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
      ladder: ["claude-frontier", "codex-balanced"],
      probe: async () => ({ ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" }),
    });
    assert.deepEqual(plan, { next: "codex-balanced", label: "Codex Sol 6.1 (balanced)", reason: "timeout" });
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
      current: "claude-sonnet",
      ladder: CODEX_TO_SONNET,
      error: LIVE_TIMEOUT_NO_OUTPUT,
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" };
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
      probe: async () => ({ ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" }),
    });
    assert.equal(plan, null);
  });

  it("keeps a content refusal terminal even when its explanation mentions quota", async () => {
    let probes = 0;
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-frontier",
      error:
        "The selected model declined to produce the requested editorial: I cannot write this. A quota reset will not change that.",
      probe: async () => {
        probes += 1;
        return { ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" };
      },
    });
    assert.equal(plan, null);
    assert.equal(probes, 0);
  });

  it("fails over on an empty model response", async () => {
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "deepseek-flash",
      error: "empty model response",
      probe: async () => ({ ok: true, label: "Qwen 3.6 35B", choice: "qwen-local" }),
    });
    assert.deepEqual(plan, { next: "qwen-local", label: "Qwen 3.6 35B", reason: "timeout" });
  });

  it("returns null once the ladder's last rung has already failed", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "claude-sonnet",
      ladder: CODEX_TO_SONNET,
      error:
        "Codex authentication has expired or Codex is signed out. Open Codex, sign in again, then try again.",
      probe: async (choice) => {
        calls.push(choice);
        return { ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" };
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

  it("reads as a reply the desk could not read for reason 'unreadable'", () => {
    assert.equal(
      failoverReasonPhrase("DeepSeek v4.1 Flash", "unreadable"),
      "DeepSeek v4.1 Flash sent a reply the desk could not read",
    );
  });
});

/**
 * Unit Y item 3's second half. The bake-off (2026-09-24) caught DeepSeek
 * answering with JSON missing one comma; `readableReplyOrRetry` (./ai.ts)
 * retries that once on the SAME provider and then reports it with
 * `unreadableReplyError`'s wording. Until this classifier existed that
 * sentence matched nothing here, so the ladder treated a stutter as terminal
 * -- the whole point of the item was that the reply, not the socket, was the
 * failure, and a failure of either kind gets the one hop.
 */
describe("an unreadable reply is a provider failure like any other", () => {
  it("classifies the sentence the retry reports as 'unreadable'", () => {
    assert.equal(automaticFailoverReason(unreadableReplyError("DeepSeek v4.1 Flash")), "unreadable");
    assert.equal(
      automaticFailoverReason("The writing model sent a reply the desk could not read (unreadable JSON)."),
      "unreadable",
    );
  });

  it("moves Automatic to the next rung after two unreadable replies from rung 1", async () => {
    const calls: string[] = [];
    const plan = await planAutomaticFailover({
      source: "auto",
      current: "deepseek-flash",
      error: unreadableReplyError("DeepSeek v4.1 Flash"),
      probe: async (choice) => {
        calls.push(choice);
        return choice === "qwen-local"
          ? { ok: false, error: "Qwen 3.6 35B skipped: not loaded" }
          : { ok: true, label: "Codex Sol 6.1 (balanced)", choice: "codex-balanced" };
      },
    });

    assert.deepEqual(plan, {
      next: "codex-balanced",
      label: "Codex Sol 6.1 (balanced)",
      reason: "unreadable",
    });
    assert.deepEqual(calls, ["qwen-local", "codex-balanced"]);
  });

  it("still treats a content refusal as terminal, not as an unreadable reply", async () => {
    assert.equal(automaticFailoverReason("EDITORIAL_REFUSAL: I cannot write this."), null);
  });
});

describe("failoverNoteSentence", () => {
  it("builds the durable sentence for a timeout switch", () => {
    assert.equal(
      failoverNoteSentence("Codex Sol 6.1 (balanced)", "Claude Opus", "timeout"),
      "This draft moved to Codex Sol 6.1 (balanced) because Claude Opus timed out",
    );
  });

  it("builds the durable sentence for a sign-in-lapse switch", () => {
    assert.equal(
      failoverNoteSentence("Codex Sol 6.1 (balanced)", "Claude Opus", "auth"),
      "This draft moved to Codex Sol 6.1 (balanced) because Claude Opus sign-in lapsed",
    );
  });
});
