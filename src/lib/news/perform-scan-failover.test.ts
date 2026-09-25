import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScanChatWithFailover, scanCallTimeoutMs } from "./scan-model-run.ts";

const LIVE_401 =
  "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";

const RUNG_AUTH_FAILURE = "The model is signed out. Sign in again, then try again.";
const RUNG_TIMEOUT_NO_OUTPUT = "The call timed out after 150s, 0 bytes out";

/**
 * `performScanWork` delegates its one AI read, and the Automatic failover
 * around it, to `runScanChatWithFailover` (see the comment on that function
 * and on `performScanWork`/`PerformScanWorkDeps` in desk.ts). This is the
 * same one-shot ladder retry Draft's `failOverAndRetry` does: a job left on
 * Automatic whose provider's login lapsed mid-run tries exactly one later
 * rung of AUTOMATIC_LADDER, once, using the SAME `system`/`user` text --
 * never a second fetch pass over the watch list.
 *
 * The ladder those scenarios walk is the 0.6.63 one: DeepSeek v4.1 Flash,
 * then Qwen 3.6 35B on this computer, then Codex Terra. The two failure
 * messages above are provider-neutral on purpose -- each test names the rung
 * it runs on, and the failure text is whatever that rung's transport said.
 */
describe("runScanChatWithFailover", () => {
  it("passes the selected Ollama model to the scan call", async () => {
    const localModel = { baseUrl: "http://127.0.0.1:11434/v1", id: "deepseek-v4.1-flash:cloud" };
    const seen: unknown[] = [];
    const result = await runScanChatWithFailover({
      job: { id: 7, model_choice: "local-model", model_choice_source: "editor" },
      newsroomId: 1,
      localModel,
      system: "system",
      user: "source evidence",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
      grokChat: async (_system, _user, _maxTokens, options) => {
        seen.push(options?.localModel);
        return { ok: true, text: '{"leads":[]}' };
      },
      probe: async () => { throw new Error("unexpected probe"); },
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen, [localModel]);
  });
  it("passes the authenticated newsroom to an explicit custom connection without failover", async () => {
    const calls: Array<{ choice?: string; newsroomId?: number }> = [];
    const result = await runScanChatWithFailover({
      job: {
        id: 6,
        model_choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35",
        model_choice_source: "editor",
      },
      newsroomId: 44,
      system: "scan system",
      user: "private accepted source excerpts",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
      grokChat: async (_system, _user, _tokens, options) => {
        calls.push(options ?? {});
        return { ok: true, text: "{}" };
      },
      probe: async () => {
        throw new Error("an explicit custom pick must not fail over");
      },
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      { choice: "custom:9ce9a944-f444-4a69-8927-7c7705c07a35", newsroomId: 44, timeoutMs: 90_000 },
    ]);
  });
  it("retries once on a provider auth failure when the job is on the ladder's first rung, reusing the same system/user text", async () => {
    const grokCalls: { system: string; user: string; choice: unknown }[] = [];
    const probeCalls: string[] = [];
    const stageMessages: string[] = [];
    let modelChoiceSetTo: string | undefined;

    const result = await runScanChatWithFailover({
      job: { id: 41, model_choice: "deepseek-flash", model_choice_source: "auto" },
      system: "SYSTEM PROMPT",
      user: "USER PAYLOAD",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
      grokChat: async (system, user, _maxTokens, opts) => {
        grokCalls.push({ system, user, choice: opts?.choice });
        if (grokCalls.length === 1) return { ok: false as const, error: RUNG_AUTH_FAILURE };
        return { ok: true as const, text: '{"leads":[]}' };
      },
      probe: async (choice) => {
        probeCalls.push(choice);
        return { ok: true as const, label: "Qwen 3.6 35B", choice: "qwen-local" as const };
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
      ["deepseek-flash", "qwen-local"],
      "the retry must run on the next ladder rung, not the one that just failed",
    );
    assert.ok(
      grokCalls.every((c) => c.system === "SYSTEM PROMPT" && c.user === "USER PAYLOAD"),
      "the retry must reuse the same fetched-source payload, never fetch again",
    );
    assert.deepEqual(
      probeCalls,
      ["qwen-local"],
      "must probe only the rung strictly after the current one",
    );
    assert.equal(modelChoiceSetTo, "qwen-local");
    assert.ok(
      stageMessages.some((s) => /Switched to Qwen 3.6 35B: .* sign-in lapsed/.test(s)),
      `expected a "Switched to" stage message, got: ${JSON.stringify(stageMessages)}`,
    );
  });

  /**
   * Audit-lite 0.6.7 FINDING-001: only the sign-in-lapse branch above was
   * ever exercised through this real wiring; the "timed out" branch (added
   * the same release, for the second 2026-09-02 incident) had no test here.
   */
  it("retries once on a timeout / zero-output failure when the job is on the ladder's first rung, and words the stage 'timed out'", async () => {
    const grokCalls: { system: string; user: string; choice: unknown }[] = [];
    const probeCalls: string[] = [];
    const stageMessages: string[] = [];
    let modelChoiceSetTo: string | undefined;

    const result = await runScanChatWithFailover({
      job: { id: 46, model_choice: "deepseek-flash", model_choice_source: "auto" },
      system: "SYSTEM PROMPT",
      user: "USER PAYLOAD",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
      grokChat: async (system, user, _maxTokens, opts) => {
        grokCalls.push({ system, user, choice: opts?.choice });
        if (grokCalls.length === 1) return { ok: false as const, error: RUNG_TIMEOUT_NO_OUTPUT };
        return { ok: true as const, text: '{"leads":[]}' };
      },
      probe: async (choice) => {
        probeCalls.push(choice);
        return { ok: true as const, label: "Qwen 3.6 35B", choice: "qwen-local" as const };
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
      ["deepseek-flash", "qwen-local"],
      "the retry must run on the next ladder rung, not the one that just failed",
    );
    assert.deepEqual(probeCalls, ["qwen-local"]);
    assert.equal(modelChoiceSetTo, "qwen-local");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Qwen 3.6 35B: DeepSeek v4.1 Flash timed out"),
      `expected the "timed out" stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.ok(
      stageMessages.every((s) => !/sign-in lapsed/.test(s)),
      "a timeout must never be worded as a sign-in lapse",
    );
  });

  it("routes an editor's explicit model choice around a technical failure", async () => {
    const grokCalls: unknown[] = [];
    let probeCalled = false;

    const result = await runScanChatWithFailover({
      job: { id: 1, model_choice: "claude-frontier", model_choice_source: "editor" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
      grokChat: async (_s, _u, _m, opts) => {
        grokCalls.push(opts?.choice);
        return { ok: false as const, error: LIVE_401 };
      },
      probe: async () => {
        probeCalled = true;
        return { ok: true as const, label: "DeepSeek v4.1 Flash", choice: "deepseek-flash" as const };
      },
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      grokCalls,
      ["claude-frontier", "deepseek-flash"],
      "a hand-picked model not on the ladder falls to its first rung",
    );
    assert.equal(probeCalled, true);
  });

  it("emits the scheduled runtime receipt before retrying a timed-out call", async () => {
    const events: string[] = [];
    const receipts: unknown[] = [];
    const result = await runScanChatWithFailover({
      job: { id: 47, model_choice: "deepseek-flash", model_choice_source: "scheduled" },
      system: "SYSTEM",
      user: "FETCHED ONCE",
      maxTokens: 3500,
      modelEffort: "none",
      timeoutMs: () => 90_000,
      grokChat: async (_system, _user, _maxTokens, opts) => {
        events.push(`chat:${opts?.choice}`);
        return events.length === 1
          ? { ok: false as const, error: RUNG_TIMEOUT_NO_OUTPUT }
          : { ok: true as const, text: '{"leads":[]}' };
      },
      probe: async () => ({
        ok: true as const,
        label: "Qwen 3.6 35B",
        choice: "qwen-local" as const,
      }),
      onSwitch: async (receipt) => {
        events.push("persist-receipt");
        receipts.push(receipt);
      },
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(events, ["chat:deepseek-flash", "persist-receipt", "chat:qwen-local"]);
    assert.deepEqual(receipts, [{
      previousChoice: "deepseek-flash",
      nextChoice: "qwen-local",
      previousLabel: "DeepSeek v4.1 Flash",
      nextLabel: "Qwen 3.6 35B",
      // The Qwen rung declares no measured efforts, so the receipt records
      // that the destination ran on its own default rather than carrying the
      // DeepSeek rung's "none" across.
      nextEffort: null,
      reason: "timeout",
      switchReason: "DeepSeek v4.1 Flash timed out",
      switchNote: "This draft moved to Qwen 3.6 35B because DeepSeek v4.1 Flash timed out",
    }]);
  });

  it("gives the rung a mid-run failover lands on an effort only that rung accepts", async () => {
    const efforts: unknown[] = [];
    const result = await runScanChatWithFailover({
      job: { id: 101, model_choice: "qwen-local", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      modelEffort: "none",
      timeoutMs: () => 90_000,
      grokChat: async (_s, _u, _m, opts) => {
        efforts.push(opts?.reasoningEffort);
        return efforts.length === 1
          ? { ok: false as const, error: RUNG_TIMEOUT_NO_OUTPUT }
          : { ok: true as const, text: '{"leads":[]}' };
      },
      probe: async () => ({
        ok: true as const,
        label: "Codex Terra",
        choice: "codex-balanced" as const,
      }),
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });

    assert.equal(result.ok, true);
    // The Qwen rung has no measured effort list, so nothing is sent for it;
    // Codex Terra accepts "none", so the retry sends that.
    assert.deepEqual(efforts, [undefined, "none"]);
  });

  /**
   * Unit Y item 3, second half of the hop: a stutter is about the model, not
   * about the position in the ladder, so the rung a mid-run failover lands on
   * gets the same one second ask the first rung got before its reply is called
   * unreadable. There is no further rung to fall to here.
   */
  it("retries the rung a mid-run failover lands on once before calling its reply unreadable", async () => {
    const grokCalls: unknown[] = [];
    const result = await runScanChatWithFailover({
      job: { id: 102, model_choice: "deepseek-flash", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
      read: (text) => text.includes('"leads"'),
      grokChat: async (_s, _u, _m, opts) => {
        grokCalls.push(opts?.choice);
        return grokCalls.length === 1
          ? { ok: false as const, error: RUNG_AUTH_FAILURE }
          : { ok: true as const, text: "not json at all" };
      },
      probe: async () => ({
        ok: true as const,
        label: "Qwen 3.6 35B",
        choice: "qwen-local" as const,
      }),
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected the unreadable reply to be reported");
    assert.equal(result.error, "Qwen 3.6 35B sent a reply the desk could not read (unreadable JSON).");
    assert.deepEqual(
      grokCalls,
      ["deepseek-flash", "qwen-local", "qwen-local"],
      "the hopped-to rung is asked twice, exactly like the first rung",
    );
  });

  it("never fails over a non-auth failure, even on Automatic", async () => {
    const grokCalls: unknown[] = [];
    let probeCalled = false;

    const result = await runScanChatWithFailover({
      job: { id: 2, model_choice: "claude-frontier", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
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
    assert.equal(
      probeCalled,
      false,
      "a refusal is not a login lapse and must not trigger a failover probe",
    );
  });

  it("returns the first failure unchanged when Automatic's next rung is not ready either", async () => {
    const grokCalls: unknown[] = [];

    const result = await runScanChatWithFailover({
      job: { id: 3, model_choice: "claude-frontier", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: () => 90_000,
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
    assert.deepEqual(
      grokCalls,
      ["claude-frontier"],
      "must not retry when there is nowhere ready to retry on",
    );
  });
});

/*
  2026-09-02 production timeout (desk_jobs 46 / scan_runs 5): 31 sources
  fetched clean in ~35s, then the single AI read died at a flat 90s ceiling
  even though the CLI providers -- the ones Story drafts budget 150s of
  callMs for via providerBudget() -- routinely need more than 90s for a
  full-payload read. scanCallTimeoutMs gives the scan the same per-provider
  budget, floored at the old 90s so the configured-gateway path never gets
  worse.
*/
describe("scanCallTimeoutMs", () => {
  it("gives the CLI providers at least the 150s a draft call gets", () => {
    assert.ok(scanCallTimeoutMs("claude-frontier") >= 150_000);
    assert.ok(scanCallTimeoutMs("codex-balanced") >= 150_000);
  });

  it("floors the configured gateway at the old 90s flat timeout", () => {
    assert.ok(scanCallTimeoutMs("configured") >= 90_000);
  });
});

describe("runScanChatWithFailover per-attempt timeout", () => {
  it("recomputes the timeout for the rung a mid-run failover actually lands on", async () => {
    const seenTimeouts: number[] = [];

    const result = await runScanChatWithFailover({
      job: { id: 99, model_choice: "deepseek-flash", model_choice_source: "auto" },
      system: "S",
      user: "U",
      maxTokens: 3500,
      timeoutMs: scanCallTimeoutMs,
      grokChat: async (_s, _u, _m, opts) => {
        seenTimeouts.push(opts!.timeoutMs!);
        if (seenTimeouts.length === 1) return { ok: false as const, error: RUNG_AUTH_FAILURE };
        return { ok: true as const, text: '{"leads":[]}' };
      },
      probe: async () => ({
        ok: true as const,
        label: "Qwen 3.6 35B",
        choice: "qwen-local" as const,
      }),
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
    });

    assert.equal(result.ok, true);
    // Computed fresh per attempt, on the rung that attempt actually runs on,
    // not carried over from the first: both rungs here are local, so the
    // second attempt gets the local budget rather than the first's.
    assert.deepEqual(seenTimeouts, [
      scanCallTimeoutMs("deepseek-flash"),
      scanCallTimeoutMs("qwen-local"),
    ]);
  });
});
