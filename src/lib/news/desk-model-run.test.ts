import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  failOverAndRetry,
  failOverOperationAndRetry,
  storyProviderFailure,
  type DraftInput,
  type ReportedDraftResult,
} from "./desk-model-run.ts";
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
  "Codex error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";
const LIVE_TIMEOUT_NO_OUTPUT = "Codex request timed out after 150s, 0 bytes out";

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
      setFailoverNote: async (_id, note) => {
        noteWritten = note;
      },
    });

    assert.equal(result, successfulDraft);
    assert.deepEqual(modelChoiceCalls, [[41, "claude-sonnet"]]);
    assert.deepEqual(runReportCalls, ["claude-sonnet"], "the retry must run on the next rung");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Claude Sonnet: Codex Terra sign-in lapsed"),
      `expected the auth-lapse stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.equal(
      noteWritten,
      "This draft moved to Claude Sonnet because Codex Terra sign-in lapsed",
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
      setFailoverNote: async (_id, note) => {
        noteWritten = note;
      },
    });

    assert.equal(result, successfulDraft);
    assert.deepEqual(modelChoiceCalls, [[41, "claude-sonnet"]]);
    assert.deepEqual(runReportCalls, ["claude-sonnet"], "the retry must run on the next rung");
    assert.ok(
      stageMessages.some((s) => s === "Switched to Claude Sonnet: Codex Terra timed out"),
      `expected the timeout stage wording, got: ${JSON.stringify(stageMessages)}`,
    );
    assert.equal(
      noteWritten,
      "This draft moved to Claude Sonnet because Codex Terra timed out",
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

    assert.ok(
      "error" in result && result.error === LIVE_401,
      "the original error must pass through unchanged",
    );
    assert.equal(modelChoiceSet, false);
    assert.equal(stageSet, false);
    assert.equal(noteSet, false);
  });

  it("explains why Automatic did not move on when the next rung was not ready", async () => {
    let probeCalls = 0;
    const result = await failOverAndRetry({
      job: job(),
      error: LIVE_401,
      draftInput,
      runReport: async () => {
        throw new Error("must not retry when nothing is ready");
      },
      probe: async () => {
        probeCalls += 1;
        return { ok: false, error: "Claude is not signed in on this machine." };
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
    assert.match(result.error, /Automatic tried Claude Sonnet next, but it was not ready/);
    assert.match(result.error, /Claude is not signed in on this machine\./);
    assert.equal(probeCalls, 1, "Automatic must not probe the same unavailable rung twice");
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
      "Codex error 429: usage limit reached. Automatic tried Claude Sonnet next, but it was not ready: Claude is unavailable.",
    );
    assert.match(message, /Automatic tried Claude Sonnet next, but it was not ready/);
    assert.doesNotMatch(message, /Opinion request/);
  });

  it("keeps a content refusal terminal even when its explanation mentions quota", () => {
    const refusal =
      "The selected model declined to produce the requested story: I cannot write this. A quota reset will not change that.";
    assert.equal(storyProviderFailure(refusal), refusal);
  });

  it("fails over a document-reading stage once and resumes it on Claude Sonnet", async () => {
    const calls: string[] = [];
    const stages: string[] = [];
    const result = await failOverOperationAndRetry({
      job: job(),
      error: "Codex usage limit reached",
      operation: async (choice) => {
        calls.push(choice);
        return "document evidence";
      },
      probe: async () => ({ ok: true, label: "Claude Sonnet", choice: "claude-sonnet" }),
      setModelChoice: async () => undefined,
      setStage: async (_id, stage) => {
        stages.push(stage);
      },
      setFailoverNote: async () => undefined,
    });
    assert.deepEqual(result, { ok: true, value: "document evidence", choice: "claude-sonnet" });
    assert.deepEqual(calls, ["claude-sonnet"]);
    assert.deepEqual(stages, ["Switched to Claude Sonnet: Codex Terra reached its usage limit"]);
  });

  it("does not reroute an explicit document-reading model or a content refusal", async () => {
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
        probe: async () => {
          probes += 1;
          return { ok: true, label: "Codex Terra", choice: "codex-balanced" };
        },
        setModelChoice: async () => undefined,
        setStage: async () => undefined,
        setFailoverNote: async () => undefined,
      });
      assert.equal(result.ok, false);
      assert.equal(probes, 0);
      assert.equal(operations, 0);
    }
  });

  it("explains when document failover found the next provider unavailable", async () => {
    let probeCalls = 0;
    const result = await failOverOperationAndRetry({
      job: job(),
      error: "Codex usage limit reached",
      operation: async () => "must not run",
      probe: async () => {
        probeCalls += 1;
        return { ok: false, error: "Claude is not signed in." };
      },
      setModelChoice: async () => undefined,
      setStage: async () => undefined,
      setFailoverNote: async () => undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Automatic tried Claude Sonnet next/);
    assert.match(result.error, /Claude is not signed in/);
    assert.doesNotMatch(result.error, /Opinion request/);
    assert.equal(probeCalls, 1, "Automatic must not probe the same unavailable rung twice");
  });
});
