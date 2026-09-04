#!/usr/bin/env node
/**
 * A stand-in for the Claude Code CLI, for tests that must not touch a real
 * login.
 *
 * Point CLAUDE_CLI_PATH at this file. It is a `.mjs`, which
 * src/lib/news/cli-spawn.server.ts runs through Node rather than handing to the
 * OS — the same path a real operator takes when they point at the npm
 * package's JavaScript entry point instead of the platform binary.
 *
 * Two commands, matching what the desk actually calls:
 *
 *   auth status --json   -> prints the status envelope
 *   auth login --claudeai -> prints an authorize URL, then behaves per FAKE_MODE
 *
 * Behaviour is set by environment, so one script covers every branch of the
 * state machine:
 *
 *   FAKE_CLAUDE_SIGNED_IN   "1" for a logged-in status envelope
 *   FAKE_CLAUDE_STATE_FILE  a file whose presence means "signed in" (the login
 *                           writes it, so a walk can watch the flip happen)
 *   FAKE_CLAUDE_MODE        exit-ok | exit-fail | hang   (default exit-ok)
 *   FAKE_CLAUDE_NO_URL      "1" to print nothing at all
 *   FAKE_CLAUDE_FAIL_PROMPTS
 *                           "1" to make every `-p` chat call (not the auth
 *                           commands) answer with the real 401 envelope a
 *                           live Claude Code CLI printed on 2026-09-02 when
 *                           its OAuth token expired mid-run:
 *                           `auth status --json` still reports loggedIn:true
 *                           (the CLI itself has not noticed yet) — this is
 *                           what a lapsed login mid-draft actually looks
 *                           like, and it is what src/lib/news/automatic-failover.ts
 *                           exists to catch.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const stateFile = process.env.FAKE_CLAUDE_STATE_FILE;

function signedIn() {
  if (process.env.FAKE_CLAUDE_SIGNED_IN === "1") return true;
  return Boolean(stateFile && existsSync(stateFile));
}

if (argv[0] === "auth" && argv[1] === "status") {
  process.stdout.write(
    JSON.stringify(
      signedIn()
        ? { loggedIn: true, email: "editor@example.org", subscriptionType: "max" }
        : { loggedIn: false },
    ) + "\n",
  );
  process.exit(signedIn() ? 0 : 1);
}

if (argv[0] === "auth" && argv[1] === "login") {
  if (process.env.FAKE_CLAUDE_NO_URL !== "1") {
    // The exact two lines the real CLI printed in the 2026-09-02 spike.
    process.stdout.write("Opening browser to sign in…\n");
    process.stdout.write(
      "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fake&state=fake\n",
    );
  }
  const mode = process.env.FAKE_CLAUDE_MODE || "exit-ok";
  if (mode === "hang") {
    // Stay up the way the real CLI does while it waits on its callback.
    setInterval(() => {}, 1000);
  } else if (mode === "exit-fail") {
    process.stderr.write("Sign-in was refused by the server.\n");
    process.exit(1);
  } else {
    /*
      A browser walk has to be able to SEE the waiting state. The real CLI
      stands there while a human reads the link; a fake that prints and exits
      in the same millisecond makes the one screen this feature exists for
      untestable. The delay stands in for the human.
    */
    const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS || 0);
    const finish = () => {
      if (stateFile) writeFileSync(stateFile, "signed-in");
      process.exit(0);
    };
    if (delay > 0) setTimeout(finish, delay);
    else finish();
  }
} else if (argv[0] === "-p" && process.env.FAKE_CLAUDE_ECHO_SYSTEM_PROMPT === "1") {
  /*
   * For tests that need to prove which route the system prompt travelled by:
   * `--system-prompt-file <path>` (reads the file off disk, argv only ever
   * carries the path) vs. `--system-prompt <text>` (the text is argv itself).
   * Echoes both the mode and the prompt's length back inside `result` so a
   * test can assert on it after parseCliEnvelope unwraps the envelope.
   */
  const fileIdx = argv.indexOf("--system-prompt-file");
  const inlineIdx = argv.indexOf("--system-prompt");
  let mode = "none";
  let promptLength = 0;
  if (fileIdx !== -1) {
    mode = "file";
    promptLength = readFileSync(argv[fileIdx + 1], "utf8").length;
  } else if (inlineIdx !== -1) {
    mode = "inline";
    promptLength = (argv[inlineIdx + 1] || "").length;
  }
  process.stdout.write(
    JSON.stringify({ is_error: false, result: JSON.stringify({ mode, promptLength }) }) + "\n",
  );
  process.exit(0);
} else if (argv[0] === "-p" && process.env.FAKE_CLAUDE_ECHO_TOOLS === "1") {
  /*
   * For tests that need to prove which tool-surface flag reached argv:
   * `--tools ""` (hides the surface entirely, Dark Desk F1's `noTools`) vs.
   * `--allowed-tools <list>` (a described surface, denied per name). Echoes
   * back the flag name and the value that followed it.
   */
  const toolsIdx = argv.indexOf("--tools");
  const allowedIdx = argv.indexOf("--allowed-tools");
  let flag = "none";
  let value = "";
  if (toolsIdx !== -1) {
    flag = "--tools";
    value = argv[toolsIdx + 1] ?? "";
  } else if (allowedIdx !== -1) {
    flag = "--allowed-tools";
    value = argv[allowedIdx + 1] ?? "";
  }
  process.stdout.write(JSON.stringify({ is_error: false, result: JSON.stringify({ flag, value }) }) + "\n");
  process.exit(0);
} else if (argv[0] === "-p" && process.env.FAKE_CLAUDE_FAIL_PROMPTS === "1") {
  // The exact envelope a real 401 mid-run produced. Exit 0: the CLI's own
  // process succeeded, it is the *call* that failed -- parseCliEnvelope in
  // src/lib/news/ai-claude-code.server.ts reads `is_error` off stdout
  // regardless of exit code, same as the real CLI does.
  process.stdout.write(
    JSON.stringify({
      is_error: true,
      api_error_status: 401,
      result:
        "Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.",
    }) + "\n",
  );
  process.exit(0);
} else {
  // Any other invocation is a chat call; answer the one word the Test asks for.
  process.stdout.write(JSON.stringify({ is_error: false, result: "ok" }) + "\n");
  process.exit(0);
}
