import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planDarkRoundFailover } from "./dark.ts";
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

function job(overrides: Partial<DeskJob> = {}): DeskJob {
  return {
    id: 99,
    newsroom_id: 1,
    user_id: "u1",
    kind: "dark",
    subject_id: 5,
    model_choice: "claude-frontier",
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

    const result = await planDarkRoundFailover(job(), LIVE_401, {
      probe: async (choice) => ({ ok: true, label: "Codex Terra", choice: choice as "codex-balanced" }),
      setModelChoice: async (id, choice) => {
        modelChoiceCalls.push([id, choice]);
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
    });

    assert.deepEqual(result, {
      next: "codex-balanced",
      label: "Codex Terra",
      switchedBecause: "Claude Opus sign-in lapsed",
    });
    assert.deepEqual(modelChoiceCalls, [[99, "codex-balanced"]]);
    assert.deepEqual(stageMessages, ["Switched to Codex Terra: Claude Opus sign-in lapsed"]);
  });

  it("fails over on a timeout / zero-output error: picks the next rung and words the switch as 'timed out'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];

    const result = await planDarkRoundFailover(job(), LIVE_TIMEOUT_NO_OUTPUT, {
      probe: async (choice) => ({ ok: true, label: "Codex Terra", choice: choice as "codex-balanced" }),
      setModelChoice: async (id, choice) => {
        modelChoiceCalls.push([id, choice]);
      },
      setStage: async (_id, stage) => {
        stageMessages.push(stage);
      },
    });

    assert.deepEqual(result, {
      next: "codex-balanced",
      label: "Codex Terra",
      switchedBecause: "Claude Opus timed out",
    });
    assert.deepEqual(modelChoiceCalls, [[99, "codex-balanced"]]);
    assert.deepEqual(stageMessages, ["Switched to Codex Terra: Claude Opus timed out"]);
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
    assert.equal(probed, false, "a refusal is not a login lapse or a timeout and must not trigger a probe");
  });
});
