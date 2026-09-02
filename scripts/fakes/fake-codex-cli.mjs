#!/usr/bin/env node
/**
 * A stand-in for the Codex CLI. Same idea as fake-claude-cli.mjs: point
 * CODEX_CLI_PATH at this file.
 *
 *   login status          -> exit 0 when "signed in", 1 otherwise
 *   login --device-auth    -> prints the device URL and a one-time code
 *
 *   FAKE_CODEX_SIGNED_IN   "1" for signed in
 *   FAKE_CODEX_STATE_FILE  a file whose presence means "signed in"
 *   FAKE_CODEX_MODE        exit-ok | exit-fail | hang   (default exit-ok)
 */
import { existsSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const stateFile = process.env.FAKE_CODEX_STATE_FILE;

function signedIn() {
  if (process.env.FAKE_CODEX_SIGNED_IN === "1") return true;
  return Boolean(stateFile && existsSync(stateFile));
}

if (argv[0] === "login" && argv[1] === "status") {
  process.stdout.write(signedIn() ? "Logged in\n" : "Not logged in\n");
  process.exit(signedIn() ? 0 : 1);
}

if (argv[0] === "login" && argv.includes("--device-auth")) {
  // The layout the real CLI printed in the 2026-09-02 spike, minus the colour.
  process.stdout.write("\nWelcome to Codex [v0.147.0]\n");
  process.stdout.write("OpenAI's command-line coding agent\n\n");
  process.stdout.write(
    "Follow these steps to sign in with ChatGPT using device code authorization:\n\n",
  );
  process.stdout.write("1. Open this link in your browser and sign in to your account\n");
  process.stdout.write("   https://auth.openai.com/codex/device\n\n");
  process.stdout.write("2. Enter this one-time code (expires in 15 minutes)\n");
  process.stdout.write("   FAKE-CODE\n\n");
  const mode = process.env.FAKE_CODEX_MODE || "exit-ok";
  if (mode === "hang") {
    setInterval(() => {}, 1000);
  } else if (mode === "exit-fail") {
    process.stderr.write("Device authorization was declined.\n");
    process.exit(1);
  } else {
    if (stateFile) writeFileSync(stateFile, "signed-in");
    process.exit(0);
  }
} else {
  process.stdout.write("ok\n");
  process.exit(0);
}
