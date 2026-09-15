import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planDarkRoundFailover,
  runCheckpointedDarkStages,
  runDarkResearchWithRememberedChoice,
  terminalPlannerStartupFailure,
} from "./dark.ts";
import type { DeskJob } from "./jobs.ts";

/**
 * `performDarkRound`'s failover block had no regression test, old or new
 * (audit-lite 0.6.7 FINDING-001) -- only the pure `planAutomaticFailover` it
 * calls was tested. `planDarkRoundFailover` is the decide-and-write step
 * extracted from `performDarkRound` specifically so it can be driven here
 * with injected fakes, without a live investigation/dials/research-loop.
 */

const LIVE_401 =
  "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";
const LIVE_TIMEOUT_NO_OUTPUT = "Claude Code request timed out after 150s, 0 bytes out";
const CODEX_AUTH_FAILURE =
  "Codex authentication has expired or Codex is signed out. Open Codex, sign in again, then try again.";
const CODEX_TIMEOUT_NO_OUTPUT = "Codex request timed out after 150s, 0 bytes out";

function job(overrides: Partial<DeskJob> = {}): DeskJob {
  return {
    id: 99,
    newsroom_id: 1,
    user_id: "u1",
    kind: "dark",
    subject_id: 5,
    model_choice: "codex-balanced",
    model_choice_source: "auto",
    lane: "editorial",
    status: "running",
    stage: "Digging",
    failover_note: "",
    error: null,
    created_at: "2026-09-02T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    started_at: "2026-09-02T00:00:00Z",
    finished_at: null,
    ...overrides,
  } as DeskJob;
}

describe("planDarkRoundFailover", () => {
  it("fails over on an auth-lapse error: picks the next rung and words the switch as 'sign-in lapsed'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];

    const result = await planDarkRoundFailover(job(), CODEX_AUTH_FAILURE, {
      probe: async (choice) => ({
        ok: true,
        label: "Claude Sonnet",
        choice: choice as "claude-sonnet",
      }),
      setModelChoice: async (id, choice) => {
        modelChoiceCalls.push([id, choice]);
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
    });

    assert.deepEqual(result, {
      next: "claude-sonnet",
      label: "Claude Sonnet",
      switchedBecause: "Codex Terra sign-in lapsed",
    });
    assert.deepEqual(modelChoiceCalls, [[99, "claude-sonnet"]]);
    assert.deepEqual(stageMessages, ["Switched to Claude Sonnet: Codex Terra sign-in lapsed"]);
  });

  it("fails over on a timeout / zero-output error: picks the next rung and words the switch as 'timed out'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];

    const result = await planDarkRoundFailover(job(), CODEX_TIMEOUT_NO_OUTPUT, {
      probe: async (choice) => ({
        ok: true,
        label: "Claude Sonnet",
        choice: choice as "claude-sonnet",
      }),
      setModelChoice: async (id, choice) => {
        modelChoiceCalls.push([id, choice]);
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
    });

    assert.deepEqual(result, {
      next: "claude-sonnet",
      label: "Claude Sonnet",
      switchedBecause: "Codex Terra timed out",
    });
    assert.deepEqual(modelChoiceCalls, [[99, "claude-sonnet"]]);
    assert.deepEqual(stageMessages, ["Switched to Claude Sonnet: Codex Terra timed out"]);
  });

  it("never fails over an editor's explicit model choice", async () => {
    let probed = false;
    let modelChoiceSet = false;
    let stageSet = false;

    const result = await planDarkRoundFailover(job({ model_choice_source: "editor" }), LIVE_401, {
      probe: async () => {
        probed = true;
        return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
      },
      setModelChoice: async () => {
        modelChoiceSet = true;
      },
      setStage: async () => {
        stageSet = true;
      },
    });

    assert.equal(result, null);
    assert.equal(probed, false, "an explicit editor choice must never even probe another provider");
    assert.equal(modelChoiceSet, false);
    assert.equal(stageSet, false);
  });

  it("keeps a configured Automatic gateway exclusive", async () => {
    let probed = false;
    const result = await planDarkRoundFailover(
      job({ model_choice: "configured" }),
      LIVE_TIMEOUT_NO_OUTPUT,
      {
        probe: async () => {
          probed = true;
          return { ok: true, label: "Claude Sonnet", choice: "claude-sonnet" };
        },
      },
    );
    assert.equal(result, null);
    assert.equal(probed, false);
  });

  it("returns null when Automatic's next rung is not ready either, without writing anything", async () => {
    let modelChoiceSet = false;
    let stageSet = false;

    const result = await planDarkRoundFailover(job(), LIVE_401, {
      probe: async () => ({ ok: false, error: "Codex is not installed on this machine." }),
      setModelChoice: async () => {
        modelChoiceSet = true;
      },
      setStage: async () => {
        stageSet = true;
      },
    });

    assert.equal(result, null);
    assert.equal(modelChoiceSet, false);
    assert.equal(stageSet, false);
  });

  it("never fails over a non-recognised failure (e.g. a content refusal), even on Automatic", async () => {
    let probed = false;

    const result = await planDarkRoundFailover(job(), "The writing model declined this request", {
      probe: async () => {
        probed = true;
        return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
      },
    });

    assert.equal(result, null);
    assert.equal(
      probed,
      false,
      "a refusal is not a login lapse or a timeout and must not trigger a probe",
    );
  });
});

describe("runCheckpointedDarkStages", () => {
  it("retries only synthesis after Automatic synthesis timeout", async () => {
    const events: string[] = [];
    const result = await runCheckpointedDarkStages({
      initialChoice: "claude-sonnet",
      research: async (choice) => {
        events.push(`research:${choice}`);
        return { hops: 3, plannerStartupFailures: 0, summary: "three completed hops" };
      },
      synthesize: async (choice) => {
        events.push(`synthesis:${choice}`);
        return choice === "claude-sonnet"
          ? { stored: 0, summary: "", error: "Claude request timed out" }
          : { stored: 2, summary: "two signals", error: undefined };
      },
      failOver: async (_error, stage) => {
        events.push(`failover:${stage}`);
        return {
          next: "codex-balanced",
          label: "Codex Terra",
          switchedBecause: "Claude timed out",
        };
      },
      setStage: async (stage) => {
        events.push(`stage:${stage}`);
      },
    });

    assert.equal(result.choice, "codex-balanced");
    assert.deepEqual(events, [
      "research:claude-sonnet",
      "synthesis:claude-sonnet",
      "failover:synthesis",
      "stage:Claude timed out → Codex Terra retrying synthesis",
      "synthesis:codex-balanced",
    ]);
  });
});

describe("runDarkResearchWithRememberedChoice", () => {
  it("persists each primary or failover choice before that research attempt starts", async () => {
    const calls: string[] = [];
    const deps = {
      remember: async (_id: number, choice: string) => {
        calls.push(`remember:${choice}`);
      },
      run: async (choice: string) => {
        calls.push(`run:${choice}`);
        return choice;
      },
    };

    await runDarkResearchWithRememberedChoice(5, "claude-frontier", deps);
    await runDarkResearchWithRememberedChoice(5, "codex-balanced", deps);

    assert.deepEqual(calls, [
      "remember:claude-frontier",
      "run:claude-frontier",
      "remember:codex-balanced",
      "run:codex-balanced",
    ]);
  });

  it("keeps choice persistence best-effort and still starts research when its write fails", async () => {
    let ran = false;
    const result = await runDarkResearchWithRememberedChoice(5, "codex-balanced", {
      remember: async () => {
        throw new Error("database write unavailable");
      },
      run: async () => {
        ran = true;
        return "finished";
      },
    });
    assert.equal(ran, true);
    assert.equal(result, "finished");
  });
});

describe("terminalPlannerStartupFailure", () => {
  it("classifies a provider failure before any source action as a failed round", () => {
    assert.equal(
      terminalPlannerStartupFailure(
        { hops: 0, plannerStartupFailures: 1 },
        "Codex could not complete this draft",
      ),
      "Codex could not complete this draft",
    );
  });

  it("does not misclassify a completed zero-result search as a provider failure", () => {
    assert.equal(
      terminalPlannerStartupFailure(
        { hops: 1, plannerStartupFailures: 0 },
        "Codex could not complete this draft",
      ),
      null,
    );
  });
});
