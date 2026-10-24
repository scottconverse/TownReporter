#!/usr/bin/env node
/*
  A stand-in Claude Code CLI that goes the DeepSeek road (phase0b, walk run 2).

  WHY. scripts/failover-e2e.mjs proves Automatic's ladder without a CLI (the CI
  runner has none). A live paper DOES have one, and then a DeepSeek call takes a
  different road: `claudeCodeChat` / `claudeCodeAgentRun`
  (src/lib/news/ai-claude-code.server.ts:402 and :683) open a relay route
  (src/lib/news/deepseek-relay.server.ts:149) and start the CLI with
  ANTHROPIC_BASE_URL pointing at it. The relay forwards `POST <route>/v1/messages`
  to the DeepSeek base URL in Anthropic Messages shape (:58-90). This fake is
  that CLI: it reads the same argv the real one gets from `buildClaudeCodeArgs`
  (:323-361), sends ONE Messages request to the relay, and prints what the app
  reads.

  ARGV READ: --model, --system-prompt / --system-prompt-file, --output-format
  (json or stream-json). The user text arrives on stdin.

  ERRORS. On an HTTP error it prints an error result envelope and exits
  non-zero. Only the SUCCESS envelope was measured against a real CLI
  (runs/phase0b-run2/REPORT.md, "Real CLI measurement"). The ERROR envelope is a
  best guess built from `parseCliEnvelope`
  (src/lib/news/ai-claude-code.server.ts:919-940): the real CLI answered a 429
  by retrying for minutes and never printed an error result to copy. Unlike the
  real CLI this fake does NOT retry with backoff: a walk needs a deterministic,
  fast answer, and the retry is the real binary's behavior, not the product's.
*/
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

let user = "";
for await (const chunk of process.stdin) user += chunk;

/*
  A walk or a person debugging the CLI road can set FAKE_RELAY_CLI_LOG to a
  file path; every invocation appends one line naming its output format, model
  and how many bytes of prompt it was given. Off unless asked for, and it never
  records the prompt itself.
*/
const logPath = process.env.FAKE_RELAY_CLI_LOG;
if (logPath) {
  try {
    writeFileSync(
      logPath,
      JSON.stringify({
        at: Date.now(),
        format: process.argv.slice(2)[process.argv.slice(2).indexOf("--output-format") + 1],
        model: process.argv.slice(2)[process.argv.slice(2).indexOf("--model") + 1],
        promptBytes: user.length,
      }) + "\n",
      { flag: "a" },
    );
  } catch {
    /* diagnostics only */
  }
}

const model = argValue("--model") ?? process.env.ANTHROPIC_MODEL ?? "";
const outputFormat = argValue("--output-format") ?? "json";
const stream = outputFormat === "stream-json";
const systemFile = argValue("--system-prompt-file");
const system = argValue("--system-prompt") ?? "";

let systemText = system;
if (systemFile) {
  try {
    systemText = readFileSync(systemFile, "utf8");
  } catch {
    systemText = "";
  }
}

const base = process.env.ANTHROPIC_BASE_URL ?? "";
const body = {
  model,
  max_tokens: 4096,
  messages: [{ role: "user", content: user }],
  ...(systemText ? { system: systemText } : {}),
  // The agent run's CLI streams; the chat call does not.
  stream,
};

let status = 0;
let text = "";
let apiErrorStatus;
try {
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN ?? ""}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  status = response.status;
  if (!response.ok) {
    apiErrorStatus = status;
    const raw = await response.text();
    let message = raw.slice(0, 500);
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.error?.message === "string") message = parsed.error.message;
    } catch {
      /* keep the raw text */
    }
    printError(message);
  } else if (stream) {
    // Read the SSE the relay forwards and keep the text deltas.
    const sse = await response.text();
    let collected = "";
    for (const line of sse.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const event = JSON.parse(trimmed.slice(5));
        if (event.type === "content_block_delta" && typeof event.delta?.text === "string")
          collected += event.delta.text;
      } catch {
        /* non-JSON SSE data line */
      }
    }
    text = collected;
    printStreamSuccess();
  } else {
    const parsed = await response.json();
    text = (parsed.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    printJsonSuccess();
  }
} catch (error) {
  // A transport failure has no HTTP status. The real CLI prints an error
  // result and exits non-zero; so does this.
  printError(error instanceof Error ? error.message : String(error));
}

/** Write, wait for the pipe to flush, then exit with the code the shape needs. */
function finish(code, payload) {
  process.stdout.write(payload, () => process.exit(code));
}

function printJsonSuccess() {
  finish(
    0,
    JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, num_turns: 1, model }) + "\n",
  );
}

function printJsonError(message) {
  finish(
    1,
    JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      api_error_status: apiErrorStatus,
      result: message,
      num_turns: 1,
      model,
    }) + "\n",
  );
}

/*
  The agent run reads stream-json line by line: a short assistant remark becomes
  a job step (agentStepFromEvent, src/lib/news/ai-claude-code.server.ts:633),
  and the LAST `{"type":"result"}` line is the run's answer (:792).
*/
function printStreamSuccess() {
  const lines = [
    { type: "system", subtype: "init", model, tools: [] },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Writing the story" }] } },
    { type: "result", subtype: "success", is_error: false, result: text, num_turns: 1, model },
  ];
  writeSkillFiles(text);
  finish(0, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function printStreamError(message) {
  const lines = [
    { type: "system", subtype: "init", model, tools: [] },
    {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      api_error_status: apiErrorStatus,
      result: message,
      num_turns: 1,
      model,
    },
  ];
  finish(1, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

/** Dispatch to the shape this output format uses. */
function printError(message) {
  if (stream) printStreamError(message);
  else printJsonError(message);
}

/*
  The files the news skill writer reads back (src/lib/news/news-skill-writer.server.ts:
  story.txt at :177, CHECK-FIRST.txt at :200, RUN-NOTES.md at :204). story.txt is
  in the two-block shape `parseSkillStory` accepts
  (src/lib/news/meeting-skill-writer.ts:241) -- headline, dek, body, then the
  editor marker -- and the model's own answer text is the body.
*/
function writeSkillFiles(answer) {
  const dir = process.cwd();
  writeFileSync(
    `${dir}/story.txt`,
    [
      "Relay CLI wrote this lead",
      "A stand-in Claude Code CLI answered through the desk's own DeepSeek relay.",
      "",
      answer,
      "",
      "EDITOR FILE: NOT FOR PUBLICATION",
      "",
      "Written by scripts/fakes/fake-deepseek-relay-cli.mjs.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    `${dir}/CHECK-FIRST.txt`,
    [
      "Confirm the lead's central fact against the record.",
      "Confirm the number in the lead is the one the record gives.",
      "Confirm the quote rests on more than one source.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    `${dir}/RUN-NOTES.md`,
    ["Opened: none (stand-in CLI).", "Final script result line: skipped.", "RUN-DONE", ""].join("\n"),
    "utf8",
  );
}
