import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  CLAUDE_CLI_MISSING,
  claudeCliCandidates,
  claudeCodeChat,
  findClaudeCli,
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

  it("carries only the CLI-reported usage counters and result facts into metadata", () => {
    const out = parseCliEnvelope(
      JSON.stringify({
        is_error: false,
        result: "PONG",
        duration_ms: 427,
        modelUsage: { "claude-sonnet-4-5-20250929": { input_tokens: 10 } },
        usage: {
          input_tokens: 120,
          cache_creation_input_tokens: 55,
          cache_read_input_tokens: 1_900,
          output_tokens: 48,
        },
      }),
      { provider: "claude-code", model: "requested-model", durationMs: 999, timedOut: false },
    );
    assert.deepEqual(out, {
      ok: true,
      text: "PONG",
      meta: {
        provider: "claude-code",
        model: "claude-sonnet-4-5-20250929",
        durationMs: 427,
        timedOut: false,
        inputTokens: 120,
        outputTokens: 48,
      },
    });
  });

  it("retains metadata on an error envelope without inventing a total", () => {
    const out = parseCliEnvelope(
      JSON.stringify({ is_error: true, result: "rate limited", usage: { input_tokens: 12 } }),
      { provider: "claude-code", model: "claude-test", durationMs: 99, timedOut: false },
    );
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.deepEqual(out.meta, {
        provider: "claude-code",
        model: "claude-test",
        durationMs: 99,
        timedOut: false,
        inputTokens: 12,
      });
      assert.equal("totalTokens" in (out.meta ?? {}), false);
    }
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

describe("claudeCodeChat per-run effort", () => {
  it("passes a supported effort to the fake CLI and rejects unsupported values", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_EFFORT: "1",
    });
    resetClaudeCliCache();
    try {
      const result = await claudeCodeChat({
        system: "Return JSON only.",
        user: "draft",
        model: "sonnet",
        timeoutMs: 10_000,
        reasoningEffort: "xhigh",
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(JSON.parse(result.text), { effort: "xhigh" });
      await assert.rejects(
        claudeCodeChat({
          system: "Return JSON only.",
          user: "draft",
          model: "sonnet",
          timeoutMs: 10_000,
          reasoningEffort: "none",
        }),
        /Unsupported Claude effort none.*low, medium, high, xhigh, max/i,
      );
    } finally {
      restore();
      resetClaudeCliCache();
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
      const echoed = JSON.parse(result.text) as { flag: string; value: string; argv: string[] };
      assert.equal(echoed.flag, "--tools");
      assert.equal(echoed.value, "");
      assert.ok(echoed.argv.includes("--restricted"));
      assert.ok(echoed.argv.includes("--strict-mcp-config"));
      assert.ok(echoed.argv.includes("--safe-mode"));
      assert.ok(echoed.argv.includes("--no-session-persistence"));
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

  it("refuses filesystem, command, browser, and agent tools at the reporting boundary", async () => {
    for (const tool of ["Read", "Write", "Edit", "Bash", "PowerShell", "Agent", "mcp__anything"]) {
      await assert.rejects(
        claudeCodeChat({ system: "", user: "untrusted evidence", model: "claude-opus-5", timeoutMs: 1_000, allowedTools: [tool] }),
        /outside the reporting boundary/i,
      );
    }
  });
});

/**
 * OCR's one scoped Read (ocr.ts's `claudeCodeTranscribePage`): the only
 * place this desk hands the Claude Code CLI a live tool on purpose, and only
 * for exactly one file it just wrote itself. `--tools Read` — not
 * `--allowed-tools`, which describes a wider surface even when every entry
 * is denied — and the prompt on stdin names exactly one path.
 */
describe("claudeCodeReadChat sends --tools Read and names exactly one file", () => {
  it("passes --tools Read and a prompt naming one temp path", async () => {
    const restore = withEnv({
      CLAUDE_CLI_PATH: FAKE_CLAUDE,
      FAKE_CLAUDE_ECHO_READ_CALL: "1",
    });
    resetClaudeCliCache();
    const dir = await mkdtemp(join(tmpdir(), "trd-ocr-boundary-"));
    const filePath = join(dir, "page.jpg");
    await writeFile(filePath, "fixture");
    try {
      const { claudeCodeReadChat } = await import("./ai-claude-code.server.ts");
      const result = await claudeCodeReadChat({
        prompt: "Transcribe this page verbatim.",
        filePath,
        model: "claude-opus-5",
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text) as { tools: string; stdin: string; argv: string[]; cwd: string };
      assert.equal(echoed.tools, "Read");
      assert.ok(echoed.stdin.includes(filePath));
      assert.equal(echoed.cwd, dir);
      assert.ok(echoed.argv.includes("--restricted"));
      assert.ok(echoed.argv.includes("--strict-mcp-config"));
      // Exactly one path is named — the prompt does not also carry a second
      // temp file or a directory listing for the model to wander into.
      const pathMentions = echoed.stdin.split(filePath).length - 1;
      assert.equal(pathMentions, 1);
    } finally {
      restore();
      resetClaudeCliCache();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/*
 * The same relative-path defect Unit B fixed in the Codex adapter. An operator
 * writes `CLAUDE_CLI_PATH=scripts/fakes/fake-claude-cli.mjs`, the finder checks
 * it with `access()` against the server's cwd, and every call is then spawned
 * from TMPDIR/TEMP (so no stray CLAUDE.md is discovered). Node resolved the
 * relative script against the temp folder, exited 1 with "Cannot find module",
 * and the desk reported a provider failure for a CLI that never ran. The
 * failover job lands on this adapter, so the fake has to start from either cwd.
 */
describe("claudeCodeChat runs a relative CLAUDE_CLI_PATH from the temp reporting cwd", () => {
  it("resolves it to the file the finder vouched for, so the spawn finds it", async () => {
    const spawnCwd = await mkdtemp(join(tmpdir(), "claude-relative-cli-cwd-"));
    // Exactly the shape CI sets, relative to the checkout root.
    const relativeToRoot = relative(ROOT, FAKE_CLAUDE);
    const applicationCwd = process.cwd();
    const restore = withEnv({
      CLAUDE_CLI_PATH: relativeToRoot,
      FAKE_CLAUDE_ECHO_TOOLS: "1",
      TMPDIR: spawnCwd,
      TEMP: spawnCwd,
    });
    resetClaudeCliCache();
    try {
      process.chdir(ROOT);
      assert.equal(
        await findClaudeCli(),
        FAKE_CLAUDE,
        "a relative CLAUDE_CLI_PATH must leave the finder absolute, or the spawn resolves it against TMPDIR",
      );
      const result = await claudeCodeChat({
        system: "Return JSON only.",
        user: "plan the next hop",
        model: "claude-opus-5",
        timeoutMs: 10_000,
      });
      assert.equal(result.ok, true, "the CLI must actually start, not merely exist");
      if (!result.ok) return;
      // The cwd really was the temp folder the adapter reports from, and the
      // CLI still started -- which is the whole point: an absolute path is
      // what makes those two facts compatible.
      const echoed = JSON.parse(result.text) as { flag: string; value: string; cwd: string };
      assert.equal(echoed.cwd, spawnCwd);
    } finally {
      process.chdir(applicationCwd);
      restore();
      resetClaudeCliCache();
      await rm(spawnCwd, { recursive: true, force: true });
    }
  });
});
