import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RUNG_MS,
  NO_MODEL_IN_TIME,
  extendDeadlineForRung,
  failOverAndRetry,
  failOverOperationAndRetry,
  rungTimeoutMs,
  runPinnedCallWithFailover,
  storyProviderFailure,
  type DraftInput,
  type ReportedDraftResult,
} from "./desk-model-run.ts";
import type { DeskJob } from "./jobs.ts";
import type { EffectiveProviderChoice, ProviderProbe } from "./ai.ts";
import { modelChoiceLabel } from "./model-choice.ts";
import { KIND_BUDGETS } from "./provider-registry.ts";

/**
 * `failOverAndRetry` is the exact function job 41 hit on 2026-09-02 (see
 * `automatic-failover.ts`'s docstring) -- until now it had no regression
 * test of its own, old or new (audit-lite 0.6.7 FINDING-001): only the pure
 * `planAutomaticFailover` it calls was tested. This drives the real wiring
 * -- the stage/model_choice/failover_note writes and the retry call --
 * through injected fakes, the same pattern `perform-scan-failover.test.ts`
 * already uses for the Scan half of the same mechanism.
 *
 * 0.6.63 Unit Y moved the ladder to DeepSeek v4.1 Flash 1017 -> the LM Studio rung
 * -> Codex Terra. That middle rung named one pinned model ("Qwen 3.6 35B")
 * until 0.6.69 (Unit AL item 4), when it became whatever LM Studio has LOADED
 * and took the bare label "Local model". The fake probe below answers with the
 * registry's own label for the rung it was asked about, so the stage strings
 * here read "Local model"; the picked model's own name reaches the page as
 * "Local model (<name>)" from a real probe and from the job receipt. Two
 * things in this file followed the ladder change, and both are fixture truth
 * rather than assertions being relaxed:
 *
 *  - A hop only ever goes FORWARD (`planAutomaticFailover` slices the ladder
 *    after `current`). DeepSeek advances to Local model; balanced Codex
 *    advances to Claude Sonnet (Gemini left the ladder Oct 26 2026).
 *  - The fake probe answers about the rung it was handed instead of returning
 *    one hardcoded provider. The old constant probe ("Claude Sonnet") silently
 *    disagreed with the ladder the moment the ladder changed, and a test that
 *    reads as "the switch was worded for the provider that answered" must not
 *    be able to pass while naming a different one.
 */
function readyProbe(
  seen: string[] = [],
): (choice?: EffectiveProviderChoice | string) => Promise<ProviderProbe> {
  return async (choice) => {
    const rung = choice ?? "";
    seen.push(rung);
    return {
      ok: true,
      label: modelChoiceLabel(rung),
      choice: rung as EffectiveProviderChoice,
    };
  };
}

const LIVE_401 =
  "Codex error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";
const LIVE_TIMEOUT_NO_OUTPUT = "Codex request timed out after 150s, 0 bytes out";

/** Job 41's recorded balanced Codex choice. Tests override it when they need
 * to exercise the earlier rungs or all of the remaining ladder. */
function job(overrides: Partial<DeskJob> = {}): DeskJob {
  return {
    id: 41,
    newsroom_id: 1,
    user_id: "u1",
    kind: "draft",
    subject_id: 7,
    model_choice: "codex-balanced",
    model_choice_source: "auto",
    lane: "default",
    status: "running",
    stage: "Drafting",
    failover_note: "",
    error: null,
    created_at: "2026-09-02T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    started_at: "2026-09-02T00:00:00Z",
    finished_at: null,
    ...overrides,
  } as DeskJob;
}

const draftInput = {} as DraftInput;

const successfulDraft: ReportedDraftResult = {
  headline: "H",
  dek: "D",
  body: "Body text.",
  topic: "T",
  source_urls: [],
  integrity_notes: "",
  memory_entities: [],
  form: "news" as ReportedDraftResult extends { form: infer F } ? F : never,
  provenance: [],
  found_note: "",
  findings: [],
  unanswered: [],
  research_memo: {} as ReportedDraftResult extends { research_memo: infer R } ? R : never,
  claims: [],
} as unknown as ReportedDraftResult;

describe("runPinnedCallWithFailover", () => {
  it("retries only the failed pinned Queue call on a ready technical fallback", async () => {
    const calls: string[] = [];
    const switches: string[] = [];
    const initial = { modelChoice: "deepseek-flash", researchCheckpoint: "complete" };
    const fallback = { modelChoice: "qwen-local", researchCheckpoint: "complete" };

    const result = await runPinnedCallWithFailover({
      snapshot: initial,
      source: "editor",
      run: async (snapshot) => {
        calls.push(snapshot.modelChoice);
        return snapshot === initial
          ? { ok: false as const, error: LIVE_TIMEOUT_NO_OUTPUT }
          : { ok: true as const, text: "draft" };
      },
      probe: readyProbe(),
      resolve: async (choice) => {
        assert.equal(choice, "qwen-local");
        return fallback;
      },
      onSwitch: async ({ nextChoice }) => {
        switches.push(nextChoice);
      },
    });

    assert.deepEqual(calls, ["deepseek-flash", "qwen-local"]);
    assert.equal(result.snapshot, fallback);
    assert.equal(result.result.ok, true);
    assert.deepEqual(switches, ["qwen-local"]);
    assert.equal(result.snapshot.researchCheckpoint, "complete");
  });

  it("keeps a pinned Queue refusal terminal", async () => {
    let calls = 0;
    const snapshot = { modelChoice: "codex-balanced" };
    const refusal = "The selected model declined to produce the requested story.";

    const result = await runPinnedCallWithFailover({
      snapshot,
      source: "editor",
      run: async () => {
        calls += 1;
        return { ok: false as const, error: refusal };
      },
      probe: async () => {
        throw new Error("refusal must not probe a fallback");
      },
      resolve: async () => {
        throw new Error("refusal must not resolve a fallback");
      },
      onSwitch: async () => {
        throw new Error("refusal must not switch models");
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.snapshot, snapshot);
    assert.deepEqual(result.result, { ok: false, error: refusal });
  });

  it("does not walk a failed ladder again on a retry in the same draft run", async () => {
    const tried = new Set<string>();
    const calls: string[] = [];
    const first = { modelChoice: "deepseek-flash" };
    const failing = async (snapshot: { modelChoice: string }) => {
      calls.push(snapshot.modelChoice);
      return { ok: false as const, error: LIVE_TIMEOUT_NO_OUTPUT };
    };
    const options = {
      source: "editor" as const,
      exhaustLadder: true,
      tried,
      run: failing,
      probe: readyProbe(),
      resolve: async (choice: string) => ({ modelChoice: choice }),
      onSwitch: async () => {},
    };

    const once = await runPinnedCallWithFailover({ ...options, snapshot: first });
    const callsAfterFirst = calls.length;
    const retry = await runPinnedCallWithFailover({ ...options, snapshot: once.snapshot });

    assert.ok(callsAfterFirst >= 1);
    assert.equal(calls.length, callsAfterFirst, "the retry must not re-run a rung that already failed");
    assert.equal(retry.result.ok, false);
    assert.match(retry.result.error ?? "", /already failed/);
  });

  it("stops without switching once the draft run has no time for another model", async () => {
    const switches: string[] = [];
    const snapshot = { modelChoice: "codex-balanced" };

    const result = await runPinnedCallWithFailover({
      snapshot,
      source: "editor",
      exhaustLadder: true,
      run: async () => ({ ok: false as const, error: NO_MODEL_IN_TIME }),
      outOfTime: () => true,
      probe: readyProbe(),
      resolve: async () => {
        throw new Error("no time left, so no fallback may be resolved");
      },
      onSwitch: async ({ nextChoice }) => {
        switches.push(nextChoice);
      },
    });

    assert.deepEqual(switches, []);
    assert.equal(result.result.error, NO_MODEL_IN_TIME);
  });
});

describe("rungTimeoutMs", () => {
  it("gives each model its own limit, never the leftover of an earlier model", () => {
    const deadlineAt = 100_000;
    assert.deepEqual(rungTimeoutMs({ requestedMs: 150_000, deadlineAt, now: 0 }), { timeoutMs: 100_000 });
    assert.deepEqual(rungTimeoutMs({ requestedMs: 20_000, deadlineAt, now: 0 }), { timeoutMs: 20_000 });
  });

  it("refuses a call when the run has under the shortest real limit left, instead of sending 1 ms", () => {
    assert.deepEqual(rungTimeoutMs({ requestedMs: 150_000, deadlineAt: 100_000, now: 99_999 }), { refused: true });
    assert.deepEqual(rungTimeoutMs({ requestedMs: 1, deadlineAt: 100_000, now: 0 }), { refused: true });
  });
});

describe("extendDeadlineForRung", () => {
  /*
    desk_jobs 428: the whole-meeting writer started on Codex (900 s wall), Codex
    timed out, the run fell back to the local rung (2,400 s wall) -- and kept
    Codex's deadline, because it was stamped once from the first choice. Every
    later call was then refused for want of MIN_RUNG_MS, and the draft was saved
    with no lead and a placeholder in every item.
  */
  it("gives the fallback rung its own clock from the run's start, not the dead rung's leftover", () => {
    const runStartedAt = 1_000_000;
    const now = runStartedAt + 750_000; // Codex spent 750 of its 900 seconds
    const codexDeadline = runStartedAt + KIND_BUDGETS.codex.wallMs;
    // What the run kept before the fix: 150 s left, so a 600 s local call is cut to 150 s.
    assert.deepEqual(
      rungTimeoutMs({ requestedMs: KIND_BUDGETS.local.callMs, deadlineAt: codexDeadline, now }),
      { timeoutMs: 150_000 },
      "the old constant deadline is what the fallback used to get",
    );
    const switchedDeadline = extendDeadlineForRung({
      runStartedAt,
      currentDeadlineAt: codexDeadline,
      rungWallMs: KIND_BUDGETS.local.wallMs,
    });
    assert.ok(switchedDeadline - now > MIN_RUNG_MS, "the fallback leaves more than the shortest real call");
    assert.deepEqual(
      rungTimeoutMs({ requestedMs: KIND_BUDGETS.local.callMs, deadlineAt: switchedDeadline, now }),
      { timeoutMs: KIND_BUDGETS.local.callMs },
      "a ten-minute local call gets its whole ten minutes, not the dead rung's leftovers",
    );
  });

  it("never moves a deadline earlier than the one it is handed", () => {
    assert.equal(
      extendDeadlineForRung({ runStartedAt: 0, currentDeadlineAt: 5_000_000, rungWallMs: KIND_BUDGETS.codex.wallMs }),
      5_000_000,
      "a shorter rung cannot take time away",
    );
    assert.equal(
      extendDeadlineForRung({ runStartedAt: 0, currentDeadlineAt: 100, rungWallMs: KIND_BUDGETS.local.wallMs }),
      KIND_BUDGETS.local.wallMs,
    );
  });
});

describe("failOverAndRetry", () => {
  it("fails over on an auth-lapse error: picks the next rung and words the switch as 'sign-in lapsed'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];
    let noteWritten = "";
    const runReportCalls: unknown[] = [];

    const result = await failOverAndRetry({
      job: job({ model_choice: "deepseek-flash" }),
      error: LIVE_401,
      draftInput,
      runReport: async (opts) => {
        runReportCalls.push(opts.modelChoice);
        return successfulDraft;
      },
      probe: readyProbe(),
      setModelChoice: async (id, choice) => {
        modelChoiceCalls.push([id, choice]);
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
      setFailoverNote: async (_id, note) => {
        noteWritten = note;
      },
    });

    assert.equal(result, successfulDraft);
    assert.deepEqual(modelChoiceCalls, [[41, "qwen-local"]]);
    assert.deepEqual(runReportCalls, ["qwen-local"], "the retry must run on the next rung");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Local model: DeepSeek v4.1 Flash 1017 sign-in lapsed"),
      `expected the auth-lapse stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.equal(
      noteWritten,
      "This draft moved to Local model because DeepSeek v4.1 Flash 1017 sign-in lapsed",
      "the durable failover_note must carry the same 'sign-in lapsed' wording as the stage",
    );
  });

  it("the failover note names the effort the failed DeepSeek rung actually ran at, not the job's medium", async () => {
    let noteWritten = "";

    await failOverAndRetry({
      job: job({ model_choice: "deepseek-flash" }),
      error: LIVE_401,
      draftInput: { ...draftInput, modelEffort: "medium" },
      runReport: async () => successfulDraft,
      probe: readyProbe(),
      setModelChoice: async () => {},
      setStage: async () => {},
      setFailoverNote: async (_id, note) => {
        noteWritten = note;
      },
    });

    assert.equal(
      noteWritten,
      "This draft moved to Local model because DeepSeek v4.1 Flash 1017 sign-in lapsed (DeepSeek v4.1 Flash 1017 ran at effort none)",
      "DeepSeek v4.1 Flash 1017 does not offer medium, so it ran with effort none (G25-EF-1) and the receipt must say none",
    );
  });

  it("fails over on a timeout / zero-output error: picks the next rung and words the switch as 'timed out'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];
    let noteWritten = "";
    const runReportCalls: unknown[] = [];

    const result = await failOverAndRetry({
      job: job({ model_choice: "deepseek-flash" }),
      error: LIVE_TIMEOUT_NO_OUTPUT,
      draftInput,
      runReport: async (opts) => {
        runReportCalls.push(opts.modelChoice);
        return successfulDraft;
      },
      probe: readyProbe(),
      setModelChoice: async (id, choice) => {
        modelChoiceCalls.push([id, choice]);
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
      setFailoverNote: async (_id, note) => {
        noteWritten = note;
      },
    });

    assert.equal(result, successfulDraft);
    assert.deepEqual(modelChoiceCalls, [[41, "qwen-local"]]);
    assert.deepEqual(runReportCalls, ["qwen-local"], "the retry must run on the next rung");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Local model: DeepSeek v4.1 Flash 1017 timed out"),
      `expected the timeout stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.equal(
      noteWritten,
      "This draft moved to Local model because DeepSeek v4.1 Flash 1017 timed out",
      "the durable failover_note must carry the same 'timed out' wording as the stage",
    );
  });

  it("routes an editor's preferred model around a technical failure and records the switch", async () => {
    let modelChoiceSet = false;
    let stageSet = false;
    let noteSet = false;
    let retryEffort: unknown;

    const result = await failOverAndRetry({
      job: job({ model_choice: "deepseek-flash", model_choice_source: "editor" }),
      error: LIVE_401,
      draftInput: { ...draftInput, modelEffort: "none" },
      runReport: async (input) => {
        retryEffort = input.modelEffort;
        return successfulDraft;
      },
      probe: readyProbe(),
      setModelChoice: async () => {
        modelChoiceSet = true;
      },
      setStage: async () => {
        stageSet = true;
      },
      setFailoverNote: async () => {
        noteSet = true;
      },
    });

    assert.equal(result, successfulDraft);
    assert.equal(modelChoiceSet, true);
    assert.equal(stageSet, true);
    assert.equal(noteSet, true);
    /*
      "none" is DeepSeek's effort, and the rung that answered here is Qwen --
      whose levels are unmeasured, so it accepts none of them. The retry must
      not carry the previous rung's effort to a rung that cannot take it, which
      is the same rule the pre-0.6.63 fixture checked with Claude Sonnet:
      `modelEffortsFor("qwen-local")` is empty, so the validated effort is null
      and the provider's own default applies.
    */
    assert.equal(retryEffort, null, "Qwen must not receive DeepSeek-only none effort");
  });

  it("explains why Automatic did not move on when no later rung was ready", async () => {
    const probed: string[] = [];
    const result = await failOverAndRetry({
      job: job({ model_choice: "deepseek-flash" }),
      error: LIVE_401,
      draftInput,
      runReport: async () => {
        throw new Error("must not retry when nothing is ready");
      },
      probe: async (choice) => {
        const rung = choice ?? "";
        probed.push(rung);
        return { ok: false, error: `${modelChoiceLabel(rung)} is not ready on this machine.` };
      },
      setModelChoice: async () => {
        throw new Error("nothing to switch to means nothing gets rewritten");
      },
      setStage: async () => {
        throw new Error("nothing to switch to means nothing gets rewritten");
      },
      setFailoverNote: async () => {
        throw new Error("nothing to switch to means nothing gets rewritten");
      },
    });

    assert.ok("error" in result);
    /* A failed first rung probes all three later rungs once, in order.
       The message names Claude Sonnet 5.5, the final rung that was tried. */
    assert.deepEqual(probed, ["qwen-local", "codex-balanced", "claude-sonnet"], "each later rung is probed once");
    assert.match(result.error, /Automatic tried Claude Sonnet 5\.5 next, but it was not ready/);
    assert.match(result.error, /Claude Sonnet 5\.5 is not ready on this machine\./);
  });
});

describe("Story provider failure and stage failover", () => {
  it("uses Story-specific allowance copy instead of Opinion copy", () => {
    const message = storyProviderFailure(
      "Claude API error 429: usage limit reached; resets 11:30pm (America/Denver).",
    );
    assert.match(message, /Story drafting/);
    assert.match(message, /11:30pm/);
    assert.match(message, /saved material was preserved/);
    assert.doesNotMatch(message, /Opinion request/);
  });

  it("keeps Automatic's unavailable-next-rung detail in Story quota copy", () => {
    const message = storyProviderFailure(
      "Codex error 429: usage limit reached. Automatic tried Local model next, but it was not ready: Local model is unavailable.",
    );
    assert.match(message, /Automatic tried Local model next, but it was not ready/);
    assert.doesNotMatch(message, /Opinion request/);
  });

  it("keeps a content refusal terminal even when its explanation mentions quota", () => {
    const refusal =
      "The selected model declined to produce the requested story: I cannot write this. A quota reset will not change that.";
    assert.equal(storyProviderFailure(refusal), refusal);
  });

  it("fails over a document-reading stage once and resumes it on the local rung", async () => {
    const calls: string[] = [];
    const stages: string[] = [];
    const result = await failOverOperationAndRetry({
      job: job({ model_choice: "deepseek-flash" }),
      error: "Codex usage limit reached",
      operation: async (choice) => {
        calls.push(choice);
        return "document evidence";
      },
      probe: readyProbe(),
      setModelChoice: async () => undefined,
      setStage: async (_id, stage) => {
        stages.push(stage);
      },
      setFailoverNote: async () => undefined,
    });
    assert.deepEqual(result, { ok: true, value: "document evidence", choice: "qwen-local" });
    assert.deepEqual(calls, ["qwen-local"]);
    assert.deepEqual(stages, [
      "Switched to Local model: DeepSeek v4.1 Flash 1017 reached its usage limit",
    ]);
  });

  it("reroutes an explicit document model on technical failure but keeps refusal terminal", async () => {
    for (const candidate of [
      {
        current: "claude-frontier",
        source: "editor",
        error: "Claude API error 429: usage limit reached",
      },
      {
        current: "claude-frontier",
        source: "auto",
        error:
          "The selected model declined to produce the requested story: I cannot write this. A quota reset will not change that.",
      },
    ] as const) {
      let probes = 0;
      let operations = 0;
      const explicitJob = {
        ...job(),
        model_choice: candidate.current,
        model_choice_source: candidate.source,
      };
      const result = await failOverOperationAndRetry({
        job: explicitJob,
        error: candidate.error,
        operation: async () => {
          operations += 1;
          return "must not run";
        },
        probe: async (choice) => {
          probes += 1;
          return {
            ok: true,
            label: modelChoiceLabel(choice),
            choice: choice as EffectiveProviderChoice,
          };
        },
        setModelChoice: async () => undefined,
        setStage: async () => undefined,
        setFailoverNote: async () => undefined,
      });
      if (candidate.source === "editor") {
        /*
          `claude-frontier` is not a rung of Automatic's ladder, so the hop
          falls back to the whole ladder and takes its FIRST ready rung --
          DeepSeek v4.1 Flash 1017. The old fixture expected Codex Terra because its
          probe answered "codex-balanced" for every rung it was handed; the
          probe now names the rung it was actually asked for.
        */
        assert.deepEqual(result, { ok: true, value: "must not run", choice: "deepseek-flash" });
        assert.equal(probes, 1);
        assert.equal(operations, 1);
      } else {
        assert.equal(result.ok, false);
        assert.equal(probes, 0);
        assert.equal(operations, 0);
      }
    }
  });

  it("explains when document failover found no later provider available", async () => {
    const probed: string[] = [];
    const result = await failOverOperationAndRetry({
      job: job({ model_choice: "deepseek-flash" }),
      error: "Codex usage limit reached",
      operation: async () => "must not run",
      probe: async (choice) => {
        const rung = choice ?? "";
        probed.push(rung);
        return { ok: false, error: `${modelChoiceLabel(rung)} is not ready.` };
      },
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
      setFailoverNote: async () => undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(probed, ["qwen-local", "codex-balanced", "claude-sonnet"], "each later rung is probed once");
    assert.match(result.error, /Automatic tried Claude Sonnet 5\.5 next/);
    assert.match(result.error, /Claude Sonnet 5\.5 is not ready/);
    assert.doesNotMatch(result.error, /Opinion request/);
  });
});


for (const message of ["Custom provider Gemini (gemini-3.5-flash) timed out after 150 seconds.", "Custom provider Gemini (gemini-3.5-flash) API error 429: Google quota exhausted"]) it(`records provider detail and the next hop: ${message}`, async () => {
  let hop: unknown;
  const result = await runPinnedCallWithFailover({
    snapshot:{modelChoice:"custom:gemini"}, source:"editor",
    run: async snapshot => snapshot.modelChoice === "custom:gemini" ? {ok:false,error:message} : {ok:true,text:"draft"},
    probe: async () => ({ok:true,choice:"codex-balanced",label:"Codex Sol 6.1 (balanced)"}),
    resolve: async () => ({modelChoice:"codex-balanced"}),
    onSwitch: async receipt => { hop = receipt; },
  });
  assert.equal(result.result.ok,true);
  assert.match(JSON.stringify(hop),/Codex Sol 6.1/);
  assert.ok(JSON.stringify(hop).includes(message));
});


it("keeps Google's message through terminal Story and editor rendering", async () => {
  const {editorDraftError}=await import("./desk-copy.ts");
  const error="Custom provider Gemini (gemini-3.5-flash) API error 429: Google quota exhausted. The desk found no ready fallback; no draft was created.";
  assert.equal(editorDraftError(storyProviderFailure(error)),error);
});

it("explains the desk outcome when a custom timeout has no ready fallback", async () => {
  const result = await runPinnedCallWithFailover({
    snapshot: { modelChoice: "custom:gemini" }, source: "editor", ladder: ["codex-balanced"],
    run: async () => ({ ok: false, error: "Custom provider Gemini (gemini-3.5-flash) timed out after 150 seconds." }),
    probe: async () => ({ ok: false, error: "Codex is signed out." }),
    resolve: async () => assert.fail("no fallback can run"),
    onSwitch: async () => assert.fail("no hop can be recorded"),
  });
  assert.match(result.result.error, /Gemini.*timed out after 150 seconds/);
  assert.match(result.result.error, /The desk found no ready fallback; no draft was created/);
});
