import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productionOcr } from "./ocr.ts";
import { singleRenderedPdfFixture } from "./pdf-test-fixture.ts";
import {
  forcedOcrOptions,
  parseForcedRuntimeSnapshot,
  runForcedChat,
  type ForcedRuntimeSnapshot,
} from "./forced-runtime.server.ts";

const claude = {
  runtime: "claude-cli",
  modelChoice: "claude-sonnet",
  transport: "claude-code",
  model: "selected-claude",
} as const satisfies ForcedRuntimeSnapshot;

describe("forced runtime snapshots", () => {
  it("rejects a runtime paired with another provider choice", () => {
    assert.equal(parseForcedRuntimeSnapshot({ ...claude, modelChoice: "codex-balanced" }), null);
  });

  for (const malformed of [
    { runtime: "claude-cli", modelChoice: "claude-sonnet", transport: "claude-code" },
    { runtime: "local", modelChoice: "local-model", transport: "local" },
    { ...claude, transport: "codex" },
  ]) {
    it("refuses malformed snapshots before an adapter call", async () => {
      let calls = 0;
      await assert.rejects(
        runForcedChat(malformed as ForcedRuntimeSnapshot, "system", "user", 100, undefined, {
          claude: async () => {
            calls += 1;
            return { ok: true, text: "wrong" };
          },
          codex: async () => {
            calls += 1;
            return { ok: true, text: "wrong" };
          },
          local: async () => {
            calls += 1;
            return { ok: true, text: "wrong" };
          },
        }),
        /snapshot is invalid/,
      );
      assert.equal(calls, 0);
    });
  }

  it("preserves noTools on forced Claude Code calls", async () => {
    let received: unknown;
    const result = await runForcedChat(
      claude,
      "system",
      "user",
      100,
      { noTools: true },
      {
        claude: async (input) => {
          received = input;
          return { ok: true as const, text: "done" };
        },
        codex: async () => {
          throw new Error("wrong transport");
        },
        local: async () => {
          throw new Error("wrong transport");
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal((received as { noTools?: boolean }).noTools, true);
  });

  for (const [modelChoice, transport, model] of [
    ["codex-astra", "codex", "gpt-6-astra"],
    ["codex-frontier", "codex", "gpt-5.6-sol"],
    ["codex-balanced", "codex", "gpt-5.6-terra"],
    ["codex-luna", "codex", "gpt-5.6-luna"],
    ["claude-fable", "claude-code", "fable"],
    ["claude-frontier", "claude-code", "claude-opus-5"],
    ["claude-sonnet", "claude-code", "sonnet"],
    ["claude-haiku", "claude-code", "haiku"],
  ] as const) {
    it(`keeps ${modelChoice} pinned to its exact model and transport`, async () => {
      const snapshot = {
        runtime: modelChoice,
        modelChoice,
        transport,
        model,
      } as const satisfies ForcedRuntimeSnapshot;
      assert.deepEqual(parseForcedRuntimeSnapshot(snapshot), snapshot);
      const calls: Array<{ transport: string; model: string }> = [];
      await runForcedChat(snapshot, "system", "user", 100, undefined, {
        claude: async (input) => {
          calls.push({ transport: "claude-code", model: input.model });
          return { ok: true };
        },
        codex: async (input) => {
          calls.push({ transport: "codex", model: input.model });
          return { ok: true };
        },
        local: async () => {
          throw new Error("named cloud models must not use Local model");
        },
      });
      assert.deepEqual(calls, [{ transport, model }]);
    });
  }

  it("uses forced Claude Code OCR when a metered Anthropic key is present", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "must-not-be-used";
    const calls: string[] = [];
    try {
      const result = await productionOcr(
        singleRenderedPdfFixture(),
        forcedOcrOptions(claude, undefined, {
          anthropic: async () => {
            calls.push("anthropic");
            return "wrong";
          },
          "claude-code": async () => {
            calls.push("claude-code");
            return "Recorded passage";
          },
        }),
      );
      assert.deepEqual(calls, ["claude-code"]);
      assert.match(result.text, /Recorded passage/);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("keeps saved Custom AI credentials out of the batch snapshot and resolves them at call time", async () => {
    const snapshot = {
      runtime: "custom:11111111-1111-4111-8111-111111111111",
      modelChoice: "custom:11111111-1111-4111-8111-111111111111",
      transport: "custom",
      model: "gemini-2.5-flash",
      newsroomId: 42,
      label: "Gemini",
    } as const satisfies ForcedRuntimeSnapshot;
    assert.deepEqual(parseForcedRuntimeSnapshot(snapshot), snapshot);
    assert.doesNotMatch(JSON.stringify(snapshot), /api.?key|secret|base.?url/i);
    let received: unknown;
    const result = await runForcedChat(snapshot, "system", "user", 100, undefined, {
      claude: async () => { throw new Error("wrong transport"); },
      codex: async () => { throw new Error("wrong transport"); },
      local: async () => { throw new Error("wrong transport"); },
      custom: async (_system, _user, _maxTokens, options) => {
        received = options;
        return { ok: true as const, text: "done" };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(received, {
      choice: snapshot.modelChoice,
      newsroomId: 42,
      model: "gemini-2.5-flash",
    });
    assert.deepEqual(forcedOcrOptions(snapshot), {
      provider: snapshot.modelChoice,
      newsroomId: "42",
      localModel: undefined,
      forcedPlan: undefined,
      beforeModelCall: undefined,
      adapters: undefined,
    });
  });

  it("keeps SuperGrok credentials out of the batch snapshot and resolves them at call time", async () => {
    const snapshot = {
      runtime: "grok-oauth",
      modelChoice: "grok-oauth",
      transport: "xai-oauth",
      model: "grok-4.6",
      newsroomId: 42,
    } as const satisfies ForcedRuntimeSnapshot;
    assert.deepEqual(parseForcedRuntimeSnapshot(snapshot), snapshot);
    assert.doesNotMatch(JSON.stringify(snapshot), /access.?token|refresh.?token|secret/i);
    let received: unknown;
    const result = await runForcedChat(snapshot, "system", "user", 100, undefined, {
      claude: async () => { throw new Error("wrong transport"); },
      codex: async () => { throw new Error("wrong transport"); },
      local: async () => { throw new Error("wrong transport"); },
      xai: async (_system, _user, _maxTokens, options) => {
        received = options;
        return { ok: true as const, text: "done" };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(received, {
      choice: "grok-oauth",
      newsroomId: 42,
      model: "grok-4.6",
    });
    assert.equal(forcedOcrOptions(snapshot).provider, "grok-oauth");
    assert.equal(forcedOcrOptions(snapshot).newsroomId, "42");
  });
});
