import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachDailyRuntimeReceipt, validateDailyRuntime } from "./daily-scan.server.ts";
import { attachDraftBatchRuntimeReceipt, validateBatchRuntime } from "./draft-batch.server.ts";
import type { ForcedRuntimeSnapshot } from "./forced-runtime.server.ts";

const terra = (effort: "none" | "low" | "medium" | "high" | "xhigh" | "max"): ForcedRuntimeSnapshot => ({
  runtime: "codex-balanced",
  modelChoice: "codex-balanced",
  transport: "codex",
  model: "gpt-5.6-terra",
  modelEffort: effort,
});

describe("named-runtime technical preflight fallback", () => {
  const fakeValidate = async (_room: number, runtime: string, effort?: any) => {
    if (runtime === "claude-sonnet") throw new Error("Claude service unavailable");
    if (runtime === "codex-balanced") return terra(effort);
    throw new Error(`${runtime} is unavailable`);
  };

  it("wraps a scheduled last-rung Claude choice to ready Codex and records the switch", async () => {
    const result = await validateDailyRuntime(7, "claude-sonnet", "max", fakeValidate as any);
    assert.equal(result.modelChoice, "codex-balanced");
    assert.equal(result.modelEffort, "max");
    assert.equal(result.requestedRuntime, "claude-sonnet");
    assert.match(result.switchNote ?? "", /moved to Codex Terra because Claude Sonnet was unavailable/i);
  });

  it("queues a batch on the ready fallback with requested and actual runtime receipt", async () => {
    const result = await validateBatchRuntime(7, "claude-sonnet", "max", fakeValidate as any);
    assert.equal(result.modelChoice, "codex-balanced");
    assert.equal(result.modelEffort, "max");
    assert.equal(result.requestedRuntime, "claude-sonnet");
    assert.equal(result.resolvedRuntime, "codex-balanced");
    assert.match(result.switchReason ?? "", /Claude Sonnet was unavailable/i);
  });

  it("preserves the editor's original request across two switches in one batch job", () => {
    const first = attachDraftBatchRuntimeReceipt(terra("max"), {
      requestedRuntime: "claude-sonnet",
      requestedEffort: "max",
      switchReason: "Claude Sonnet was unavailable",
      switchNote: "First switch",
    });
    const second = attachDraftBatchRuntimeReceipt({
      runtime: "claude-haiku",
      modelChoice: "claude-haiku",
      transport: "claude-code",
      model: "haiku",
      modelEffort: "max",
    }, {
      requestedRuntime: first.requestedRuntime,
      requestedEffort: first.requestedEffort,
      switchReason: "Codex Terra timed out",
      switchNote: "Second switch",
    });
    assert.equal(second.requestedRuntime, "claude-sonnet");
    assert.equal(second.requestedEffort, "max");
    assert.equal(second.resolvedRuntime, "claude-haiku");
    assert.equal(second.switchNote, "Second switch");
  });

  it("promotes a scheduled mid-call switch while preserving the original requested runtime", () => {
    const first = attachDailyRuntimeReceipt({
      ...terra("high"),
      requestedRuntime: "custom:11111111-1111-4111-8111-111111111111",
      requestedEffort: null,
      resolvedRuntime: "codex-balanced",
      switchReason: "Gemini timed out",
      switchNote: "First switch",
    }, {
      runtime: "claude-sonnet",
      modelChoice: "claude-sonnet",
      transport: "claude-code",
      model: "claude-sonnet-4-6",
      modelEffort: "high",
    }, {
      previousRuntime: "codex-balanced",
      previousEffort: "high",
      switchReason: "Codex Terra reached its quota",
      switchNote: "Moved to Claude Sonnet because Codex Terra reached its quota.",
    });
    assert.equal(first.requestedRuntime, "custom:11111111-1111-4111-8111-111111111111");
    assert.equal(first.requestedEffort, null);
    assert.equal(first.resolvedRuntime, "claude-sonnet");
    assert.equal(first.modelEffort, "high");
    assert.match(first.switchNote, /Moved to Claude Sonnet.*quota/i);
  });
});
