import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScanChatWithFailover } from "./scan-model-run.ts";

const LIVE_401 =
  "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";

/**
 * `performScanWork` delegates its one AI read, and the Automatic failover
 * around it, to `runScanChatWithFailover` (see the comment on that function
 * and on `performScanWork`/`PerformScanWorkDeps` in desk.ts). This is the
 * same one-shot ladder retry Draft's `failOverAndRetry` does: a job left on
 * Automatic whose provider's login lapsed mid-run tries exactly one later
 * rung of AUTOMATIC_LADDER, once, using the SAME `system`/`user` text --
 * never a second fetch pass over the watch list.
 */
describe("runScanChatWithFailover", () => {
  it("retries once on a provider auth failure when the job is on Automatic, reusing the same system/user text", async () => {
    const grokCalls: { system: string; user: string; choice: unknown }[] = [];
    const probeCalls: string[] = [];
    const stageMessages: string[] = [];
    let modelChoiceSetTo: string | undefined;

    const result = await runScanChatWithFailover({
      job: { id: 41, model_choice: "claude-frontier", model_choice_source: "auto" },
      system: "SYSTEM PROMPT",
      user: "USER PAYLOAD",
      maxTokens: 3500,
      timeoutMs: 90_000,
      grokChat: async (system, user, _maxTokens, opts) => {
        grokCalls.push({ system, user, choice: opts?.choice });
        if (grokCalls.length === 1) return { ok: false as const, error: LIVE_401 };
        return { ok: true as const, text: '{"leads":[]}' };
      },
      probe: async (choice) => {
        probeCalls.push(choice);
        return { ok: true as const, label: "Codex Terra", choice: "codex-balanced" as const };
      },
      setModelChoice: async (_id, choice) => {
        modelChoiceSetTo = choice;
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      grokCalls.map((c) => c.choice),
      ["claude-frontier", "codex-balanced"],
      "the retry must run on the next ladder rung, not the one that just failed",
    );
    assert.ok(
      grokCalls.every((c) => c.system === "SYSTEM PROMPT" && c.user === "USER PAYLOAD"),
      "the retry must reuse the same fetched-source payload, never fetch again",
    );
    assert.deepEqual(
      probeCalls,
      ["codex-balanced"],
      "must probe only the rung strictly after the current one",
    );
    assert.equal(modelChoiceSetTo, "codex-balanced");
    assert.ok(
      stageMessages.some((s) => /Switched to Codex Terra: .* sign-in lapsed/.test(s)),
      `expected a "Switched to" stage message, got: ${JSON.stringify(stageMessages)}`,
    );
  });

  it("never fails over an editor's explicit model choice", async () => {
    const grokCalls: unknown[] = [];
    let probeCalled = false;

    const result = await runScanChatWithFailover({
      job: { id: 1, model_choice: "claude-frontier", model_choice_source: "editor" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: 90_000,
      grokChat: async (_s, _u, _m, opts) => {
        grokCalls.push(opts?.choice);
        return { ok: false as const, error: LIVE_401 };
      },
      probe: async () => {
        probeCalled = true;
        return { ok: true as const, label: "Codex Terra", choice: "codex-balanced" as const };
      },
      setModelChoice: async () => {
        assert.fail("an explicit editor choice must never switch models");
      },
      setStage: async () => {
        assert.fail("an explicit editor choice must never rewrite the stage");
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(grokCalls, ["claude-frontier"], "must never retry on another rung");
    assert.equal(probeCalled, false, "planAutomaticFailover must not even probe for an explicit choice");
  });

  it("never fails over a non-auth failure, even on Automatic", async () => {
    const grokCalls: unknown[] = [];
    let probeCalled = false;

    const result = await runScanChatWithFailover({
      job: { id: 2, model_choice: "claude-frontier", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: 90_000,
      grokChat: async (_s, _u, _m, opts) => {
        grokCalls.push(opts?.choice);
        return { ok: false as const, error: "The model refused: content policy." };
      },
      probe: async () => {
        probeCalled = true;
        return { ok: true as const, label: "Codex Terra", choice: "codex-balanced" as const };
      },
      setModelChoice: async () => {
        assert.fail("a refusal must never switch models");
      },
      setStage: async () => {
        assert.fail("a refusal must never rewrite the stage");
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected the refusal to pass through");
    assert.match(result.error, /content policy/i);
    assert.deepEqual(grokCalls, ["claude-frontier"]);
    assert.equal(probeCalled, false, "a refusal is not a login lapse and must not trigger a failover probe");
  });

  it("returns the first failure unchanged when Automatic's next rung is not ready either", async () => {
    const grokCalls: unknown[] = [];

    const result = await runScanChatWithFailover({
      job: { id: 3, model_choice: "claude-frontier", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: 90_000,
      grokChat: async (_s, _u, _m, opts) => {
        grokCalls.push(opts?.choice);
        return { ok: false as const, error: LIVE_401 };
      },
      probe: async () => ({ ok: false as const, error: "Codex is not installed on this machine." }),
      setModelChoice: async () => {
        assert.fail("nothing to switch to means nothing gets rewritten");
      },
      setStage: async () => {
        assert.fail("nothing to switch to means nothing gets rewritten");
      },
    });

    assert.equal(result.ok, false);
    assert.deepEqual(grokCalls, ["claude-frontier"], "must not retry when there is nowhere ready to retry on");
  });
});
