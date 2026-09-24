#!/usr/bin/env node
/**
 * A stand-in for either provider CLI whose real job is to report what it was
 * handed: it writes its own environment as JSON to the path in `FAKE_ENV_DUMP`
 * before doing anything else.
 *
 * Point `CODEX_CLI_PATH` or `CLAUDE_CLI_PATH` at this file. Then the answers
 * below are only there so a caller's own parsing has something to chew on --
 * a draft, `login status`, `login --device-auth`, `auth status --json`.
 *
 * The dump exists to prove a NEGATIVE: that a spawned CLI does not receive the
 * server's secrets. That has to be measured from inside the child, because the
 * leak it guards against (`env: { ...process.env }`) is invisible from the
 * parent -- the parent's own `process.env` looks identical either way.
 */
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

const dump = process.env.FAKE_ENV_DUMP;
if (dump) writeFileSync(dump, JSON.stringify(process.env));

/** The device flow the desk parses, so a login can settle instead of hanging. */
const DEVICE_STDOUT = [
  "",
  "Welcome to Codex [v0.147.0]",
  "OpenAI's command-line coding agent",
  "",
  "1. Open this link in your browser and sign in to your account",
  "   https://auth.openai.com/codex/device",
  "",
  "2. Enter this one-time code (expires in 15 minutes)",
  "   ENV-CODE",
  "",
].join("\n");

if (argv[0] === "auth" && argv[1] === "status") {
  // probeClaudeCode expects one JSON object on stdout.
  process.stdout.write(`${JSON.stringify({ loggedIn: true })}\n`);
  process.exit(0);
}

if (argv[0] === "auth" && argv[1] === "login") {
  process.stdout.write("Open this link in your browser and sign in to your account\n");
  process.stdout.write(
    "   https://claude.com/cai/oauth/authorize?code=true&client_id=fake-env-cli\n",
  );
  process.exit(0);
}

if (argv[0] === "login" && argv[1] === "status") {
  process.stdout.write("Logged in\n");
  process.exit(0);
}

if (argv[0] === "login" && argv.includes("--device-auth")) {
  process.stdout.write(DEVICE_STDOUT);
  process.exit(0);
}

// A draft call. Both CLIs are asked for JSON on stdout; the prompt arrives on
// stdin, so drain it rather than let the writer see EPIPE.
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  process.stdout.write(
    argv.includes("--output-format")
      ? `${JSON.stringify({ result: "{}", is_error: false })}\n`
      : `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{}" } })}\n`,
  );
  process.exit(0);
});
