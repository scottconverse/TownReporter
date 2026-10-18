import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { EDITORIAL_TOOLS } from "./editorial.ts";
import {
  CLAUDE_CLI_MISSING,
  buildClaudeCodeArgs,
  claudeCliCandidates,
  claudeCodeChat,
  findClaudeCli,
  parseCliEnvelope,
  resetClaudeCliCache,
} from "./ai-claude-code.server.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FAKE_CLAUDE = join(ROOT, "scripts/fakes/fake-claude-cli.mjs");

// Bug 21a: Opinion WebFetch could exfiltrate private pasted material in a URL or prompt.
it("Opinion retains full tools despite a legacy allow-list", async () => {
  const restore = withEnv({ CLAUDE_CLI_PATH: FAKE_CLAUDE, FAKE_CLAUDE_ECHO_TOOLS: "1" });
  resetClaudeCliCache();
  try {
    const result = await claudeCodeChat({ system: "Research", user: "Private editor paste", model: "claude-opus-5-5", allowedTools: EDITORIAL_TOOLS, timeoutMs: 10000 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const echoed = JSON.parse(result.text);
    assert.equal(echoed.flag, "none");
    assert.ok(echoed.argv.includes("--dangerously-skip-permissions"));
  } finally { restore(); resetClaudeCliCache(); }
});

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

  it("names the npm install under the profile when APPDATA is unset (a boot-started server)", () => {
    const profile = join(tmpdir(), "tr-profile-no-appdata");
    const restore = withEnv({ APPDATA: undefined, CLAUDE_CLI_PATH: undefined, HOME: undefined, USERPROFILE: profile });
    try {
      assert.ok(
        claudeCliCandidates().includes(
          `${join(profile, "AppData", "Roaming")}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
        ),
      );
    } finally { restore(); }
  });
});

describe("findClaudeCli looks again after a miss", () => {
  it("returns null before the CLI exists, then finds it once it appears", async () => {
    const profile = await mkdtemp(join(tmpdir(), "tr-claude-profile-"));
    const bin = `${join(profile, "AppData", "Roaming")}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const restore = withEnv({ APPDATA: undefined, CLAUDE_CLI_PATH: undefined, HOME: undefined, USERPROFILE: profile });
    resetClaudeCliCache();
    try {
      assert.equal(await findClaudeCli(), null);
      await mkdir(dirname(bin), { recursive: true });
      await writeFile(bin, "");
      assert.equal(await findClaudeCli(), bin);
    } finally {
      restore();
      resetClaudeCliCache();
      await rm(profile, { recursive: true, force: true });
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
        model: "claude-opus-5-5",
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
        model: "claude-opus-5-5",
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
        model: "claude-opus-5-5",
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

function assertNewsroomClaudeSettings(args: string[]) {
  assert.equal(args.filter((arg) => arg === "--settings").length, 1);
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]!), {
    claudeMdExcludes: ["**"],
    disableAllHooks: true,
    autoMemoryEnabled: false,
    outputStyle: "default",
    attribution: { commit: "", pr: "" },
  });
}

function assertFullClaudeTools(args: string[]) {
  assertNewsroomClaudeSettings(args);
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "bypassPermissions");
  for (const flag of ["--bare", "--mcp-config", "--disallowed-tools", "--restricted", "--safe-mode", "--strict-mcp-config", "--setting-sources", "--tools", "--allowed-tools", "--permission-prompts", "--disable-slash-commands", "--no-chrome"]) {
    assert.equal(args.includes(flag), false, `${flag} must not restrict tools or MCP`);
  }
}

describe("full Claude tools for every call", () => {
  it("isolates personal context for inline, file and OCR-style prompts without changing desk inputs", () => {
    for (const prompt of [{ system: "Desk instructions" }, { systemPromptFile: "C:/fixture/desk.txt" }, {}]) {
      const input = { model: "claude-haiku-5-5", reasoningEffort: "high" as const, ...prompt };
      const args = buildClaudeCodeArgs(input);
      assertFullClaudeTools(args);
      assert.equal(args[args.indexOf("--model") + 1], input.model);
      assert.equal(args[args.indexOf("--effort") + 1], "high");
      if ("system" in prompt) assert.equal(args[args.indexOf("--system-prompt") + 1], prompt.system);
      if ("systemPromptFile" in prompt) assert.equal(args[args.indexOf("--system-prompt-file") + 1], prompt.systemPromptFile);
    }
  });
  it("uses the production builder without tool restrictions", () => {
    assertFullClaudeTools(buildClaudeCodeArgs({ model: "claude-haiku-5-5", system: "Return JSON only." }));
    assertFullClaudeTools(buildClaudeCodeArgs({ model: "claude-haiku-5-5" }));
  });
  it("legacy noTools and allowedTools cannot restrict spawned chat", async () => {
    const restore = withEnv({ CLAUDE_CLI_PATH: FAKE_CLAUDE, FAKE_CLAUDE_ECHO_TOOLS: "1" });
    resetClaudeCliCache();
    try {
      for (const options of [{}, { noTools: true }, { allowedTools: [] }, { allowedTools: ["WebFetch"] }, { noTools: true, allowedTools: ["Read", "Bash", "mcp__anything"] }]) {
        const result = await claudeCodeChat({ system: "Return JSON only.", user: "research", model: "claude-haiku-5-5", timeoutMs: 10_000, ...options });
        assert.equal(result.ok, true);
        if (result.ok) assertFullClaudeTools(JSON.parse(result.text).argv);
      }
    } finally { restore(); resetClaudeCliCache(); }
  });
  it("OCR retains full tools while naming the requested page once", async () => {
    const restore = withEnv({ CLAUDE_CLI_PATH: FAKE_CLAUDE, FAKE_CLAUDE_ECHO_READ_CALL: "1" });
    resetClaudeCliCache();
    const dir = await mkdtemp(join(tmpdir(), "trd-ocr-tools-"));
    const filePath = join(dir, "page.jpg");
    await writeFile(filePath, "fixture");
    try {
      const { claudeCodeReadChat } = await import("./ai-claude-code.server.ts");
      const result = await claudeCodeReadChat({ prompt: "Transcribe this page verbatim.", filePath, model: "claude-haiku-5-5", timeoutMs: 10_000 });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const echoed = JSON.parse(result.text);
      assertFullClaudeTools(echoed.argv);
      assert.equal(echoed.cwd, dir);
      assert.equal(echoed.stdin.split(filePath).length - 1, 1);
    } finally { restore(); resetClaudeCliCache(); await rm(dir, { recursive: true, force: true }); }
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
        model: "claude-opus-5-5",
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
