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

  it("Automatic probes Claude and only Claude -- Opinion has one provider", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("auto", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: true as const, label: "Claude Opus", choice };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.effectiveChoice, "auto");
    assert.deepEqual(probed, ["claude-frontier"]);
  });

  it("a provider auth failure is reported as-is and probes nothing else", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("claude-frontier", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: false as const, error: "Claude Code OAuth session expired." };
      },
    });
    assert.equal(result.ready, false);
    assert.match(result.why, /OAuth session expired/i);
    assert.deepEqual(probed, ["claude-frontier"]);
  });

  /*
    Audit finding "Opinion 'Local model' pick silently uses Claude":
    `checkOpinionReadiness` used to hardcode `candidates = ["claude-frontier"]`
    regardless of the `choice` argument, so an explicit "local-model" pick
    probed (and, via the commit boundary, persisted and queued) Claude
    instead. These pin the fix: an explicit pick probes only that candidate.
  */
  it("an explicit local-model pick probes ONLY local-model, never Claude", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("local-model", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: true as const, label: "Local model", choice };
      },
    });
    assert.equal(result.ready, true);
    assert.equal(
      result.effectiveChoice,
      "local-model",
      "a local-model pick must not be silently replaced by another provider",
    );
    assert.deepEqual(probed, ["local-model"]);
  });

  it("an unready local-model pick is reported as not-ready with the local probe's own message, and stays local-model", async () => {
    const probed: string[] = [];
    const result = await checkOpinionReadiness("local-model", {
      findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
      probeCandidate: async (choice) => {
        probed.push(choice);
        return { ok: false as const, error: "LLM is unreachable. Check that it is running." };
      },
    });
    assert.equal(result.ready, false);
    assert.match(result.why, /unreachable/i);
    assert.doesNotMatch(
      result.why,
      /Claude Code/i,
      "a local-model failure must never be reported as a Claude Code problem",
    );
    assert.equal(result.effectiveChoice, "local-model");
    assert.deepEqual(probed, ["local-model"]);
  });

  it("the real (non-mocked) candidate probe dispatches local-model through ai.ts's generic provider probe, not the Claude Code CLI path", async () => {
    const result = await withEnv(
      {
        LLM_BASE_URL: undefined,
        LLM_API_KEY: undefined,
        LLM_MODEL: undefined,
        OPENAI_API_KEY: undefined,
      },
      () =>
        checkOpinionReadiness("local-model", {
          findVoice: async () => ({ ok: true as const, voice: { path: "C:\\voice.md" } }),
        }),
    );
    assert.equal(result.ready, false);
    assert.doesNotMatch(
      result.why,
      /No Opinion model is available\. Open Claude Code on this machine and sign in\./,
      "an unconfigured local-model pick must not be rewritten into Opinion's Claude-only " +
        "sign-in message -- that message names no fix for a local server at all",
    );
    assert.match(
      result.why,
      /LLM_BASE_URL/,
      "the guidance for an unconfigured local-model pick must name the setting that fixes it",
    );
  });
});
