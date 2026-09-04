import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CLAUDE_CLI_MISSING,
  claudeCliCandidates,
  claudeCodeChat,
  parseCliEnvelope,
  resetClaudeCliCache,
} from "./ai-claude-code.server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FAKE_CLAUDE = join(ROOT, "scripts/fakes/fake-claude-cli.mjs");

function withEnv(vars: Record<string, string | undefined>) {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

describe("parseCliEnvelope", () => {
  it("pulls the answer out of a success envelope", () => {
    const raw = JSON.stringify({ is_error: false, result: '{"headline":"Hi"}', subtype: "success" });
    assert.deepEqual(parseCliEnvelope(raw), { ok: true, text: '{"headline":"Hi"}' });
  });

  it("trims surrounding whitespace", () => {
    const raw = `\n  ${JSON.stringify({ is_error: false, result: "  PONG  " })}  \n`;
    assert.deepEqual(parseCliEnvelope(raw), { ok: true, text: "PONG" });
  });

  it("reports an error envelope rather than returning its text as an answer", () => {
    const raw = JSON.stringify({
      is_error: true,
      result: "rate limit reached",
      api_error_status: 429,
    });
    const out = parseCliEnvelope(raw);
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.match(out.error, /429/);
      assert.match(out.error, /rate limit/);
    }
  });

  it("treats an empty result as a failure, not as empty copy", () => {
    const out = parseCliEnvelope(JSON.stringify({ is_error: false, result: "" }));
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /empty/i);
  });

  it("does not throw on unreadable output", () => {
    const out = parseCliEnvelope("not json at all");
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /unreadable/i);
  });

  it("does not throw on no output", () => {
    const out = parseCliEnvelope("   ");
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /nothing/i);
  });

  it("ignores a non-string result", () => {
    const out = parseCliEnvelope(JSON.stringify({ is_error: false, result: { a: 1 } }));
    assert.equal(out.ok, false);
  });
});

describe("claudeCliCandidates", () => {
  it("honours an explicit CLAUDE_CLI_PATH and looks nowhere else", () => {
    const prev = process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_CLI_PATH = "/custom/claude";
    try {
      assert.deepEqual(claudeCliCandidates(), ["/custom/claude"]);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CLI_PATH;
      else process.env.CLAUDE_CLI_PATH = prev;
    }
  });

  it("offers real candidates when nothing is pinned", () => {
    const prev = process.env.CLAUDE_CLI_PATH;
    delete process.env.CLAUDE_CLI_PATH;
    try {
      const found = claudeCliCandidates();
      assert.ok(found.length > 1);
      assert.ok(found.every((p) => p.includes("claude")));
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CLI_PATH = prev;
    }
  });
});

describe("CLAUDE_CLI_MISSING", () => {
  it("tells the operator what to actually do", () => {
    assert.match(CLAUDE_CLI_MISSING, /npm i -g @anthropic-ai\/claude-code/);
    assert.match(CLAUDE_CLI_MISSING, /CLAUDE_CLI_PATH/);
    assert.match(CLAUDE_CLI_MISSING, /ANTHROPIC_API_KEY/);
  });
});

describe("claudeCodeChat promotes a long inline system prompt to a file", () => {
  /*
   * Every case below pins CLAUDE_CLI_PATH at scripts/fakes/fake-claude-cli.mjs
   * before calling claudeCodeChat, so none of it can reach a live model or
   * spend anything — no RUN_LIVE_MODEL_TESTS opt-in needed, unlike the paid
   * evaluation these tests are neighbours to.
   */
  /*
   * Live crash this guards against: dark_jobs id 49, investigation 3
   * (2026-09-02). A Dark Desk "Start digging" round built an 11,961-character
   * system prompt and handed it to claudeCodeChat as a plain `system` string
   * with no `systemPromptFile` — grokChat's claude-code branch (ai.ts) never
   * set one. `assertNotAnArgument` correctly refused to let 11,961 characters
   * become a command-line argument, which is a genuine safety backstop, but
   * it meant the round could never run. The fix has to live below every
   * caller: claudeCodeChat itself now promotes an inline prompt over the
   * safe argv length to a private temp file before it ever reaches argv.
   */
  it("writes an over-length system prompt to a file instead of argv, and it survives", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_SYSTEM_PROMPT: "1",
    });
    resetClaudeCliCache();
    // One character past the incident's 11,961 and well past the 8,000-char
    // argv safety line, with margin to spare (>32KB, matching the ask).
    const system = "S".repeat(33_000);
    try {
      const result = await claudeCodeChat({
        system,
        user: "dig",
        model: "claude-opus-5",
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { mode: string; promptLength: number };
      assert.equal(echoed.mode, "file");
      assert.equal(echoed.promptLength, system.length);
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("still passes a short system prompt inline, unchanged", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_SYSTEM_PROMPT: "1",
    });
    resetClaudeCliCache();
    const system = "Reply with the single word ok.";
    try {
      const result = await claudeCodeChat({
        system,
        user: "ok",
        model: "claude-opus-5",
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { mode: string; promptLength: number };
      assert.equal(echoed.mode, "inline");
      assert.equal(echoed.promptLength, system.length);
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("honours a caller-supplied systemPromptFile as before, ignoring `system`", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "tr-voice-test-"));
    const voicePath = join(dir, "voice.txt");
    writeFileSync(voicePath, "the house voice", "utf8");
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_SYSTEM_PROMPT: "1",
    });
    resetClaudeCliCache();
    try {
      const result = await claudeCodeChat({
        system: "S".repeat(40_000), // must be ignored: systemPromptFile wins
        systemPromptFile: voicePath,
        user: "draft",
        model: "claude-opus-5",
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { mode: string; promptLength: number };
      assert.equal(echoed.mode, "file");
      assert.equal(echoed.promptLength, "the house voice".length);
    } finally {
      restore();
      resetClaudeCliCache();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/*
 * Dark Desk F1: `--allowed-tools ""` (the pre-fix default) still describes a
 * full, live tool surface to the model — Bash, WebSearch, WebFetch, every
 * MCP tool — with every one of them pre-denied, so a planner told to "go
 * find sources" would try one, get refused, and narrate the refusal into
 * whatever JSON it was returning. `noTools: true` asks the CLI to hide the
 * surface instead (`--tools ""`), so there is nothing live to try. These
 * tests pin CLAUDE_CLI_PATH at the fake CLI and assert on the exact argv
 * flag it saw — no live model, nothing billed.
 */
describe("claudeCodeChat's noTools flag reaches the CLI as --tools, not --allowed-tools", () => {
  it("noTools: true sends --tools \"\" (the surface is hidden, not just denied)", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_TOOLS: "1",
    });
    resetClaudeCliCache();
    try {
      const result = await claudeCodeChat({
        system: "Return JSON only.",
        user: "plan the next hop",
        model: "claude-opus-5",
        timeoutMs: 10_000,
        noTools: true,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { flag: string; value: string };
      assert.equal(echoed.flag, "--tools");
      assert.equal(echoed.value, "");
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("omitting both noTools and allowedTools keeps the old --allowed-tools \"\" behaviour, unchanged", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_TOOLS: "1",
    });
    resetClaudeCliCache();
    try {
      const result = await claudeCodeChat({
        system: "Return JSON only.",
        user: "write the piece",
        model: "claude-opus-5",
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { flag: string; value: string };
      assert.equal(echoed.flag, "--allowed-tools");
      assert.equal(echoed.value, "");
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("a real allowedTools list still reaches the CLI as --allowed-tools, untouched by noTools", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_TOOLS: "1",
    });
    resetClaudeCliCache();
    try {
      const result = await claudeCodeChat({
        system: "",
        user: "research the piece",
        model: "claude-opus-5",
        timeoutMs: 10_000,
        allowedTools: ["WebSearch", "WebFetch"],
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { flag: string; value: string };
      assert.equal(echoed.flag, "--allowed-tools");
      assert.equal(echoed.value, "WebSearch,WebFetch");
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });

  it("refuses a call that combines noTools with a non-empty allowedTools", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_TOOLS: "1",
    });
    resetClaudeCliCache();
    try {
      await assert.rejects(
        claudeCodeChat({
          system: "",
          user: "plan the next hop",
          model: "claude-opus-5",
          timeoutMs: 10_000,
          noTools: true,
          allowedTools: ["WebFetch"],
        }),
        /noTools.*allowedTools|allowedTools.*noTools/is,
      );
    } finally {
      restore();
      resetClaudeCliCache();
    }
  });
});
