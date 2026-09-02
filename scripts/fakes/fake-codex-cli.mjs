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
 *
 * A third command, `exec`, matches what src/lib/news/ai-codex.server.ts's
 * `buildCodexArgs` actually spawns for a draft call: `exec --model <m>
 * --sandbox danger-full-access --ephemeral --color never -`, with the whole
 * prompt on stdin (buildCodexPrompt). reportAndDraft (src/lib/news/report.ts)
 * makes several such calls in one draft -- a compact research pass, then the
 * full write pass, occasionally an edit pass -- and reads whatever JSON
 * lands on stdout with a permissive extractor (parseJsonBlock / coerceDraft),
 * so this fake tells the passes apart by a distinctive marker each of
 * report.ts's own prompts puts in the user text, and answers each with a
 * JSON shape those parsers accept. Any prompt it does not recognise gets the
 * write-pass shape, which is the most complete one.
 */
import { existsSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const stateFile = process.env.FAKE_CODEX_STATE_FILE;

/**
 * Read all of stdin. A synchronous `readFileSync(0)` throws EAGAIN on
 * Windows for a piped, non-blocking stdin before the writer has produced
 * anything -- exactly this process's situation, spawned with
 * stdio: ["pipe", ...] and fed asynchronously by `child.stdin.end(input)` in
 * ai-codex.server.ts's `run()`. Draining the stream event-driven instead
 * avoids that race.
 */
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

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
} else if (argv.includes("exec")) {
  // buildCodexArgs (ai-codex.server.ts) puts "exec" after "--ask-for-approval
  // never --search", not first -- so this cannot be an argv[0] check the way
  // "login status" is.
  // The whole prompt (SYSTEM INSTRUCTIONS + USER REQUEST, see
  // buildCodexPrompt) arrives on stdin, exactly like the real CLI reads it.
  const prompt = await readStdin();
  // report.ts's research-pass user message opens with "Lead: "; the write
  // pass's opens with "NEWS ANGLE: ". Anything else (the occasional edit
  // pass, which sends "Draft JSON to edit:") gets the write shape below,
  // since it is the superset a JSON-object-shaped answer parses out of.
  const isResearchPass = /\bLead:\s/.test(prompt) && !/NEWS ANGLE:/.test(prompt);
  if (isResearchPass) {
    process.stdout.write(
      JSON.stringify({
        news: "The council approved the item on a fake-CLI test drive.",
        why_it_matters: "It shows Automatic failing over from Claude to Codex, in a browser.",
        angle: "A one-shot fail-over, proven end to end.",
        form: "brief",
        questions: [],
        unknowns: [],
        follow: "",
        fetch_urls: [],
      }) + "\n",
    );
  } else {
    process.stdout.write(
      JSON.stringify({
        headline: "Codex Terra drafted this after Claude's login lapsed",
        dek: "A one-shot Automatic fail-over, proven in a real browser.",
        body:
          "The newsroom's Automatic writing model started this draft on Claude Opus. Its " +
          "login had lapsed, so the desk moved to the next rung of the ladder on its own.\n\n" +
          "Codex Terra finished the draft from there. Nothing about the failure reached the " +
          "editor as a dead end: the desk explained what happened and kept working.",
        topic: "council",
        source_urls: [],
        integrity_notes: "",
        memory_entities: [],
        form: "brief",
        found: [],
        unanswered: [],
        claims: [],
        reporting_trail: [],
      }) + "\n",
    );
  }
  process.exit(0);
} else {
  process.stdout.write("ok\n");
  process.exit(0);
}
