import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productionOcr } from "./ocr.ts";
import {
  forcedOcrOptions,
  parseForcedRuntimeSnapshot,
  runForcedChat,
  type ForcedRuntimeSnapshot,
} from "./forced-runtime.server.ts";

const claude = {
  runtime: "claude-cli",
  modelChoice: "claude-frontier",
  transport: "claude-code",
  model: "selected-claude",
} as const satisfies ForcedRuntimeSnapshot;

function fakePdfWithJpeg(): Uint8Array {
  const jpeg = new Uint8Array(5000);
  jpeg.set([0xff, 0xd8, 0xff], 0);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  const pdf = new Uint8Array(jpeg.length + 30);
  pdf.set(Buffer.from("%PDF-1.4 scanned "), 0);
  pdf.set(jpeg, 20);
  return pdf;
}

describe("forced runtime snapshots", () => {
  it("rejects a runtime paired with another provider choice", () => {
    assert.equal(parseForcedRuntimeSnapshot({ ...claude, modelChoice: "codex-balanced" }), null);
  });

  for (const malformed of [
    { runtime: "claude-cli", modelChoice: "claude-frontier", transport: "claude-code" },
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

  it("uses forced Claude Code OCR when a metered Anthropic key is present", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "must-not-be-used";
    const calls: string[] = [];
    try {
      const result = await productionOcr(
        fakePdfWithJpeg(),
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
});
