import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkOpinionReadiness } from "./opinion-readiness.ts";

async function withEnv<T>(changes: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(changes)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("Opinion provider readiness", { concurrency: false }, () => {
  it("does not mistake an Anthropic API key for the Claude Code CLI Opinion path", async () => {
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      throw new Error("Opinion readiness must not probe the Anthropic API path");
    };
    try {
      const result = await withEnv(
        { TOWNREPORTER_CLAUDE_CODE: "0", ANTHROPIC_API_KEY: "present-but-not-an-opinion-path" },
        () =>
          checkOpinionReadiness("claude-frontier", {
            findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
          }),
      );
      assert.equal(result.ready, false);
      assert.match(result.why, /Claude Code.*unavailable|open Claude Code/i);
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Automatic proves a rung is ready but preserves auto for pair-level fallback", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("auto", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return choice === "codex-frontier"
          ? { ok: true as const, label: "Codex Sol", choice }
          : { ok: true as const, label: "Claude Opus", choice };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.effectiveChoice, "auto");
    assert.deepEqual(probed, ["codex-frontier"]);
  });

  it("an explicit provider auth failure never probes a fallback", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("codex-frontier", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: false as const, error: "Codex OAuth session expired." };
      },
    });
    assert.equal(result.ready, false);
    assert.match(result.why, /Codex OAuth session expired/i);
    assert.deepEqual(probed, ["codex-frontier"]);
  });
});
