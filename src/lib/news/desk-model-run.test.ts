import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { failOverAndRetry, type DraftInput, type ReportedDraftResult } from "./desk-model-run.ts";
import type { DeskJob } from "./jobs.ts";

/**
 * `failOverAndRetry` is the exact function job 41 hit on 2026-09-02 (see
 * `automatic-failover.ts`'s docstring) -- until now it had no regression
 * test of its own, old or new (audit-lite 0.6.7 FINDING-001): only the pure
 * `planAutomaticFailover` it calls was tested. This drives the real wiring
 * -- the stage/model_choice/failover_note writes and the retry call --
 * through injected fakes, the same pattern `perform-scan-failover.test.ts`
 * already uses for the Scan half of the same mechanism.
 */

const LIVE_401 =
  "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";
const LIVE_TIMEOUT_NO_OUTPUT = "Claude Code request timed out after 150s, 0 bytes out";

function job(overrides: Partial<DeskJob> = {}): DeskJob {
  return {
    id: 41,
    newsroom_id: 1,
    user_id: "u1",
    kind: "draft",
    subject_id: 7,
    model_choice: "claude-frontier",
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
} as ReportedDraftResult;

describe("failOverAndRetry", () => {
  it("fails over on an auth-lapse error: picks the next rung and words the switch as 'sign-in lapsed'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];
    let noteWritten = "";
    const runReportCalls: unknown[] = [];

    const result = await failOverAndRetry({
      job: job(),
      error: LIVE_401,
      draftInput,
      runReport: async (opts) => {
        runReportCalls.push(opts.modelChoice);
        return successfulDraft;
      },
      probe: async (choice) => ({ ok: true, label: "Codex Terra", choice: choice as "codex-balanced" }),
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
    assert.deepEqual(modelChoiceCalls, [[41, "codex-balanced"]]);
    assert.deepEqual(runReportCalls, ["codex-balanced"], "the retry must run on the next rung");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Codex Terra: Claude Opus sign-in lapsed"),
      `expected the auth-lapse stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.equal(
      noteWritten,
      "This draft moved to Codex Terra because Claude Opus sign-in lapsed",
      "the durable failover_note must carry the same 'sign-in lapsed' wording as the stage",
    );
  });

  it("fails over on a timeout / zero-output error: picks the next rung and words the switch as 'timed out'", async () => {
    const modelChoiceCalls: [number, string][] = [];
    const stageMessages: string[] = [];
    let noteWritten = "";
    const runReportCalls: unknown[] = [];

    const result = await failOverAndRetry({
      job: job(),
      error: LIVE_TIMEOUT_NO_OUTPUT,
      draftInput,
      runReport: async (opts) => {
        runReportCalls.push(opts.modelChoice);
        return successfulDraft;
      },
      probe: async (choice) => ({ ok: true, label: "Codex Terra", choice: choice as "codex-balanced" }),
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
    assert.deepEqual(modelChoiceCalls, [[41, "codex-balanced"]]);
    assert.deepEqual(runReportCalls, ["codex-balanced"], "the retry must run on the next rung");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Codex Terra: Claude Opus timed out"),
      `expected the timeout stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.equal(
      noteWritten,
      "This draft moved to Codex Terra because Claude Opus timed out",
      "the durable failover_note must carry the same 'timed out' wording as the stage",
    );
  });

  it("never fails over an editor's explicit model choice", async () => {
    let modelChoiceSet = false;
    let stageSet = false;
    let noteSet = false;

    const result = await failOverAndRetry({
      job: job({ model_choice_source: "editor" }),
      error: LIVE_401,
      draftInput,
      runReport: async () => {
        throw new Error("must not retry when the editor pinned the model");
      },
      probe: async () => {
        throw new Error("must not even probe for an explicit choice");
      },
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

    assert.ok("error" in result && result.error === LIVE_401, "the original error must pass through unchanged");
    assert.equal(modelChoiceSet, false);
    assert.equal(stageSet, false);
    assert.equal(noteSet, false);
  });

  it("explains why Automatic did not move on when the next rung was not ready", async () => {
    const result = await failOverAndRetry({
      job: job(),
      error: LIVE_401,
      draftInput,
      runReport: async () => {
        throw new Error("must not retry when nothing is ready");
      },
      probe: async () => ({ ok: false, error: "Codex is not installed on this machine." }),
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
    assert.match(result.error, /Automatic tried Codex Terra next, but it was not ready/);
    assert.match(result.error, /Codex is not installed on this machine\./);
  });
});
