import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentStepFromEvent,
  claudeCodeAgentRun,
  resetClaudeCliCache,
} from "./ai-claude-code.server.ts";

/*
  THE AGENT RUN, WITHOUT AN AGENT. The meeting writer hands the CLI a folder and
  a prompt and then reads files back out of that folder, so three things have to
  hold before a real nine-minute run can be trusted: the working directory is
  the run's folder, the command can kill a run that never ends, and a DeepSeek
  run reaches the relay rather than Anthropic.

  The CLI is faked by a small script written into a temp folder, the same way
  `ai-claude-code.test.ts` fakes it with `scripts/fakes/fake-claude-cli.mjs`.
  Nothing here touches a login, a network, or a model.
*/

/** A stand-in CLI: it does to its folder what the real one would do with tools. */
const FAKE_CLI = `
import { writeFileSync } from "node:fs";

const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;

if (process.env.FAKE_AGENT_MODE === "tools") {
  // TXB-2: a named-tool stream. Two Bash calls and one WebFetch, with a tool
  // RESULT in between that must not be counted as anything.
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", id: "b1", input: { command: "curl -s https://example.gov/packet" } }] },
  });
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", id: "b2", input: { command: "pdftotext packet.pdf" } }] },
  });
  emit({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "b2", content: "SECRET FILE BODY" }] },
  });
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "WebFetch", id: "w1", input: { url: "https://example.gov" } }] },
  });
  writeFileSync("story.txt", "Headline\\n\\nDek\\n\\nBody\\n");
  emit({ type: "result", subtype: "success", is_error: false, result: "RUN-DONE" });
  process.exit(0);
} else if (process.env.FAKE_AGENT_MODE === "sleep") {
  writeFileSync("pid.txt", String(process.pid));
  setInterval(() => {}, 1000);
} else {
  writeFileSync(
    "env.json",
    JSON.stringify({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      prompt,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "",
      authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? "",
      model: process.env.ANTHROPIC_MODEL ?? "",
      contextTokens: process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS ?? "",
    }),
  );
  emit({ type: "system", subtype: "init", session_id: "fake" });
  emit({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "curl -s https://longmont.primegov.com", description: "Fetching the council packet" } }] },
  });
  // A tool RESULT carries whole file contents; it must never become a step.
  emit({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "SECRET FILE BODY" }] },
  });
  writeFileSync("story.txt", "Headline\\n\\nDek\\n\\nBody\\n");
  emit({ type: "assistant", message: { content: [{ type: "text", text: "Wrote story.txt" }] } });
  emit({ type: "result", subtype: "success", is_error: false, result: "RUN-DONE" });
  process.exit(0);
}
`;

/** A temp folder holding the fake CLI, plus a separate empty working folder. */
function fakeCli(folder = "agent-test"): { bin: string; workDir: string } {
  const root = mkdtempSync(join(tmpdir(), `${folder}-`));
  const bin = join(root, "fake-agent-cli.mjs");
  writeFileSync(bin, FAKE_CLI, "utf8");
  const workDir = join(root, "work");
  return { bin, workDir };
}

function withEnv(bin: string): () => void {
  const before = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = bin;
  resetClaudeCliCache();
  return () => {
    if (before === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = before;
    resetClaudeCliCache();
  };
}

/** True once a pid is gone. Windows reports a killed pid as a throw, POSIX as ESRCH. */
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

describe("claudeCodeAgentRun", () => {
  it("runs in the caller's folder, lets the agent write there, and reports steps", async () => {
    const { bin, workDir } = fakeCli("agent-run");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workDir, { recursive: true });
    const steps: string[] = [];
    const restore = withEnv(bin);
    try {
      const result = await claudeCodeAgentRun({
        workDir,
        prompt: "Read SKILL.md and cover the meeting.",
        model: "claude-opus-5-5",
        timeoutMs: 20_000,
        onEvent: (text) => steps.push(text),
      });
      assert.equal(result.ok, true);
      assert.equal(result.timedOut, false);
      assert.equal(result.lastText, "RUN-DONE");
      // The agent's own output landed in ITS folder, not the process's cwd.
      assert.equal(readFileSync(join(workDir, "story.txt"), "utf8"), "Headline\n\nDek\n\nBody\n");
      assert.equal(existsSync(join(process.cwd(), "story.txt")), false);
      const env = JSON.parse(readFileSync(join(workDir, "env.json"), "utf8"));
      assert.equal(env.cwd, workDir);
      assert.equal(env.prompt, "Read SKILL.md and cover the meeting.");
      // No system prompt: the CLI's own prompt is what teaches it to use tools.
      assert.equal(env.argv.includes("--system-prompt"), false);
      assert.equal(env.argv.includes("--system-prompt-file"), false);
      assert.ok(env.argv.includes("stream-json"));
      assert.ok(env.argv.includes("--verbose"));
      // The step is the agent's own description, and a tool result is not one.
      assert.deepEqual(steps, ["Fetching the council packet", "Wrote story.txt"]);
    } finally {
      restore();
    }
  });

  it("counts the agent's tool calls by name, never their contents (TXB-2)", async () => {
    const { bin, workDir } = fakeCli("agent-tools");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workDir, { recursive: true });
    const restore = withEnv(bin);
    const before = process.env.FAKE_AGENT_MODE;
    process.env.FAKE_AGENT_MODE = "tools";
    try {
      const result = await claudeCodeAgentRun({
        workDir,
        prompt: "Cover the meeting.",
        model: "claude-opus-5-5",
        timeoutMs: 20_000,
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.toolExecutions, { Bash: 2, WebFetch: 1 });
      // Names and counts only: no command, URL or result text rides along.
      const receipt = JSON.stringify(result.toolExecutions);
      assert.equal(receipt.includes("curl"), false);
      assert.equal(receipt.includes("SECRET"), false);
    } finally {
      if (before === undefined) delete process.env.FAKE_AGENT_MODE;
      else process.env.FAKE_AGENT_MODE = before;
      restore();
    }
  });

  it("kills the tree when the run outlives its time limit", async () => {
    const { bin, workDir } = fakeCli("agent-timeout");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workDir, { recursive: true });
    const restore = withEnv(bin);
    const before = process.env.FAKE_AGENT_MODE;
    process.env.FAKE_AGENT_MODE = "sleep";
    try {
      const result = await claudeCodeAgentRun({
        workDir,
        prompt: "Never finish.",
        model: "claude-opus-5-5",
        timeoutMs: 300,
      });
      assert.equal(result.ok, false);
      assert.equal(result.timedOut, true);
      assert.match(result.error ?? "", /timed out/i);
      const pid = Number(readFileSync(join(workDir, "pid.txt"), "utf8"));
      // taskkill is asynchronous; give it a moment before calling the process gone.
      for (let attempt = 0; attempt < 20 && !gone(pid); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(gone(pid), true);
    } finally {
      if (before === undefined) delete process.env.FAKE_AGENT_MODE;
      else process.env.FAKE_AGENT_MODE = before;
      restore();
    }
  });

  it("points a DeepSeek run at the relay, without Claude's own effort flag", async () => {
    const { bin, workDir } = fakeCli("agent-deepseek");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(workDir, { recursive: true });
    const restore = withEnv(bin);
    try {
      const result = await claudeCodeAgentRun({
        workDir,
        prompt: "Cover the meeting.",
        model: "deepseek-v4.1-flash:1017-cloud",
        deepSeek: { baseUrl: "http://127.0.0.1:11434", apiKey: "ollama" },
        reasoningEffort: "low",
        timeoutMs: 20_000,
      });
      assert.equal(result.ok, true);
      const env = JSON.parse(readFileSync(join(workDir, "env.json"), "utf8"));
      assert.match(env.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\//);
      assert.equal(env.authToken, "ollama");
      assert.equal(env.model, "deepseek-v4.1-flash:1017-cloud");
      assert.equal(env.contextTokens, "1048576");
      assert.equal(env.argv.includes("--effort"), false);
      assert.ok(env.argv.includes("--strict-mcp-config"));
    } finally {
      restore();
    }
  });
});

describe("agentStepFromEvent", () => {
  it("takes a Bash description and refuses a long draft", () => {
    assert.equal(
      agentStepFromEvent({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { description: "Running the audit" } }] },
      }),
      "Running the audit",
    );
    assert.equal(
      agentStepFromEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "x".repeat(400) }] },
      }),
      undefined,
    );
    assert.equal(agentStepFromEvent({ type: "user", message: { content: [{ type: "text", text: "hi" }] } }), undefined);
  });

  it("keeps a step to one short line", () => {
    const step = agentStepFromEvent({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { description: `line one\nline two ${"y".repeat(400)}` } }] },
    });
    assert.ok(step && step.length <= 120);
    assert.equal(step?.includes("\n"), false);
  });
});
