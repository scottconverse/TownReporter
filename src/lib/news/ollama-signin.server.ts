/*
  "Sign in to Ollama" -- server-only (DEF-2, Scott's pick of option B).

  `ollama signin` prints a link for the browser and waits for it to be opened.
  This module runs that command, reads the link, and hands ONLY the link back
  to the desk. It never asks for, stores, logs or prints a password, a key or
  any credential: the CLI owns its own file and its own refresh.

  UNVERIFIED (Nov 4 2026): how `ollama signin` behaves when it is not attached
  to a terminal. Scott's machine has Ollama 0.40.11 and `ollama --help` lists
  `signin`, but running it is outside this task's rules. The implementation
  treats "a URL appeared on stdout or stderr" as the success signal, and a
  clean exit (code 0) as "signed in". A build without the command is reported
  in Scott's own words (OLLAMA_NO_SIGNIN_WORDS).

  Server-only by the `.server.ts` suffix: it spawns a process.
*/

import { spawn, type ChildProcess } from "node:child_process";
import { OLLAMA_NO_SIGNIN_WORDS } from "./ollama-status.ts";
import { resolveOllamaExecutable } from "./ollama-supervision.server.ts";

export type OllamaSignInStatus =
  | "starting"
  | "awaiting_user"
  | "done"
  | "failed"
  | "no-signin"
  | "not-installed"
  | "cancelled";

export type OllamaSignIn = {
  status: OllamaSignInStatus;
  /** The link `ollama signin` printed, or null while we are waiting for it. */
  url: string | null;
  /** A plain sentence for the card. Never a credential, never raw CLI output. */
  detail: string;
  pid: number | null;
};

type SpawnLike = typeof spawn;

type Active = {
  child: ChildProcess;
  status: OllamaSignInStatus;
  url: string | null;
  detail: string;
  exited: boolean;
  exitCode: number | null;
  output: string;
};

let active: Active | null = null;

const URL_RE = /https?:\/\/[^\s"'<>]+/;
const LINK_WAIT_MS = 15_000;
const NO_SIGNIN_RE = /unknown\s+(?:command|flag|subcommand)|unrecognized|not a valid command|no such command/i;

export const OLLAMA_SIGNIN_START_FAILED = "Ollama did not start the sign-in. You can skip this step.";
export const OLLAMA_SIGNIN_NO_LINK = "Ollama did not print a sign-in link. You can skip this step.";
export const OLLAMA_SIGNIN_NOT_INSTALLED = "Ollama is not installed on this machine. You can skip this step.";
export const OLLAMA_SIGNIN_NOT_SIGNED_IN = "Ollama did not finish the sign-in. You can skip this step.";

function snapshot(row: Active): OllamaSignIn {
  return {
    status: row.status,
    url: row.url,
    detail: row.detail,
    pid: row.child.pid ?? null,
  };
}

/**
 * Run `ollama signin` and wait (briefly) for the link it prints.
 *
 * The process keeps running after the link arrives: it is what completes the
 * sign-in when the user opens the link. `pollOllamaSignIn` reports when it
 * exits, and `cancelOllamaSignIn` stops it by the PID we started.
 */
export async function startOllamaSignIn(
  options: {
    spawn?: SpawnLike;
    exists?: (path: string) => boolean;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    linkWaitMs?: number;
  } = {},
): Promise<OllamaSignIn> {
  if (active && !active.exited) return snapshot(active);

  const executable = resolveOllamaExecutable({
    env: options.env,
    platform: options.platform,
    exists: options.exists,
  });
  if (!executable) {
    return { status: "not-installed", url: null, detail: OLLAMA_SIGNIN_NOT_INSTALLED, pid: null };
  }

  const spawnFn = options.spawn ?? spawn;
  let child: ChildProcess;
  try {
    child = spawnFn(executable, ["signin"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return { status: "failed", url: null, detail: OLLAMA_SIGNIN_START_FAILED, pid: null };
  }

  const row: Active = {
    child,
    status: "starting",
    url: null,
    detail: "Waiting for Ollama to print its link…",
    exited: false,
    exitCode: null,
    output: "",
  };
  active = row;

  const read = (chunk: Buffer | string) => {
    row.output = (row.output + chunk.toString()).slice(-8_000);
    if (!row.url) {
      const match = URL_RE.exec(row.output);
      if (match) {
        row.url = match[0];
        row.status = "awaiting_user";
        row.detail = "";
      }
    }
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  child.once("error", () => {
    row.exited = true;
    row.status = "failed";
    row.detail = OLLAMA_SIGNIN_START_FAILED;
  });
  child.once("exit", (code) => {
    row.exited = true;
    row.exitCode = code;
    if (code === 0) {
      row.status = "done";
      row.detail = "";
    } else if (NO_SIGNIN_RE.test(row.output)) {
      row.status = "no-signin";
      row.detail = OLLAMA_NO_SIGNIN_WORDS;
    } else if (row.url) {
      row.status = "failed";
      row.detail = OLLAMA_SIGNIN_NOT_SIGNED_IN;
    } else {
      row.status = "failed";
      row.detail = OLLAMA_SIGNIN_NO_LINK;
    }
  });

  // Wait for the link, the process exit, or the ceiling -- whichever is first.
  const waitMs = options.linkWaitMs ?? LINK_WAIT_MS;
  await new Promise<void>((resolve) => {
    if (row.url || row.exited) return resolve();
    const timer = setTimeout(resolve, waitMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);
    const poll = setInterval(() => {
      if (row.url || row.exited) {
        clearInterval(poll);
        done();
      }
    }, 100);
    (poll as unknown as { unref?: () => void }).unref?.();
    setTimeout(() => clearInterval(poll), waitMs + 250);
  });

  if (!row.url && !row.exited) {
    row.status = "failed";
    row.detail = OLLAMA_SIGNIN_NO_LINK;
  }
  return snapshot(row);
}

export function pollOllamaSignIn(): OllamaSignIn | null {
  return active ? snapshot(active) : null;
}

/** Stop the sign-in attempt THIS app started, by its saved PID. */
export function cancelOllamaSignIn(): OllamaSignIn | null {
  if (!active) return null;
  const pid = active.child.pid;
  if (pid) {
    try {
      active.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  active.exited = true;
  active.status = "cancelled";
  active.detail = "";
  return snapshot(active);
}

/** Test-only: forget the in-flight attempt between test files. */
export function resetOllamaSignInForTests(): void {
  active = null;
}
