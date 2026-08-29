/**
 * Claude via the local Claude Code CLI — **server-only** (`.server.ts` suffix).
 *
 * Uses the operator's existing Claude Code login instead of an API key, so a
 * Max/Pro subscription powers the desk. The CLI owns token refresh; this module
 * never reads or handles credentials.
 *
 * MUST keep the `.server` suffix and be reached by dynamic import only: it uses
 * `node:child_process`, which must never reach the browser bundle.
 *
 * ## Why the flags
 *
 * A bare `claude -p` loads the whole coding-agent harness — every built-in tool
 * definition, the operator's own CLAUDE.md, and the skills index. Measured on
 * this machine that was ~44.6k tokens of preamble per call, and it would have
 * prefixed every news prompt with unrelated developer instructions. The flags
 * below cut it to ~29.6k and, more importantly, keep the operator's personal
 * config out of the newsroom's prompts entirely.
 *
 * `--setting-sources ""` is the load-bearing one: without it the desk inherits
 * whatever is in the operator's CLAUDE.md.
 *
 * ## Cost shape
 *
 * The preamble is identical on every call, so the server-side prompt cache
 * absorbs it after the first request — measured ~25.5k cache-read + ~4k write
 * per call, roughly a fifth of the uncached cost, and it survives across
 * separate CLI processes. Latency floor is ~2.5s per call.
 */
import { spawn } from "node:child_process";
import { assertNotAnArgument } from "./voice.server.ts";

export type ClaudeCodeResult = { ok: true; text: string } | { ok: false; error: string };

/** Shape of `--output-format json`. Only the fields this module reads. */
type CliEnvelope = {
  is_error?: boolean;
  result?: unknown;
  subtype?: string;
  api_error_status?: unknown;
};

/**
 * Where the CLI lives. `claude` on PATH is a shim (`claude.cmd` on Windows,
 * a shell script elsewhere) that Node cannot spawn without a shell, and going
 * through a shell breaks empty-string arguments like `--setting-sources ""`.
 * The npm install also ships a real binary — prefer it, and let the operator
 * override when the layout differs.
 */
export function claudeCliCandidates(): string[] {
  const explicit = process.env.CLAUDE_CLI_PATH?.trim();
  if (explicit) return [explicit];
  const appData = process.env.APPDATA;
  const home = process.env.HOME || process.env.USERPROFILE;
  const out: string[] = [];
  if (appData) {
    out.push(`${appData}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`);
  }
  if (home) {
    out.push(`${home}/.npm-global/lib/node_modules/@anthropic-ai/claude-code/bin/claude`);
    out.push(`${home}/.local/bin/claude`);
  }
  out.push("/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude");
  out.push("/usr/lib/node_modules/@anthropic-ai/claude-code/bin/claude");
  return out;
}

let resolvedBin: string | null | undefined;

/** First candidate that exists on disk, or null. Memoized. */
export async function findClaudeCli(): Promise<string | null> {
  if (resolvedBin !== undefined) return resolvedBin;
  const { access } = await import("node:fs/promises");
  for (const candidate of claudeCliCandidates()) {
    try {
      await access(candidate);
      resolvedBin = candidate;
      return resolvedBin;
    } catch {
      /* try the next one */
    }
  }
  resolvedBin = null;
  return null;
}

/** Reset the memoized lookup. Tests only. */
export function resetClaudeCliCache() {
  resolvedBin = undefined;
}

export const CLAUDE_CLI_MISSING =
  "Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code) and sign in with `claude`, set CLAUDE_CLI_PATH to its binary, or set ANTHROPIC_API_KEY instead.";

/**
 * End a spawned CLI and everything it started.
 *
 * The spawned `claude.exe` runs a child of its own. Measured on this machine, a
 * bare `child.kill()` did leave zero surviving `claude.exe` — so this is not a
 * fix for an observed orphan, and should not be described as one. It is the
 * stronger guarantee for the case the measurement did not cover: a helper the
 * CLI started that does not exit with it. `taskkill /T` takes the tree.
 */
function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }) {
  const pid = child.pid;
  if (pid && process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
      return;
    } catch {
      /* fall through to the plain kill */
    }
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

/**
 * One prompt, one answer. The user text goes over stdin, never argv: the desk
 * sends packs up to ~28k characters and Windows caps a command line at ~32k.
 */
export async function claudeCodeChat(opts: {
  /** Inline system prompt. Ignored when `systemPromptFile` is given. */
  system: string;
  user: string;
  model: string;
  timeoutMs: number;
  /**
   * Read the system prompt from this file instead of passing it inline.
   *
   * For the editorial voice this is not an optimisation, it is the mechanism
   * that keeps it private: only the PATH reaches the command line, and command
   * lines are readable by every process on this machine. It also sidesteps
   * Windows' 32,767-character argument limit, which a 98KB voice file exceeds
   * three times over.
   */
  systemPromptFile?: string;
  /**
   * Tools the call may use. Empty by default — most desk calls are text in,
   * text out. The editorial writer needs WebSearch and WebFetch because its
   * whole posture is receipts, and without them it is instructed to drop its
   * own claims appendix.
   */
  allowedTools?: string[];
}): Promise<ClaudeCodeResult> {
  const bin = await findClaudeCli();
  if (!bin) return { ok: false, error: CLAUDE_CLI_MISSING };

  /*
    A long prompt must never become an argument. Arguments are visible to any
    process that can list processes, and Windows caps them at 32,767 characters
    anyway. `assertNotAnArgument` makes that a refusal rather than a habit.
  */
  const usingFile = Boolean(opts.systemPromptFile);
  if (!usingFile) assertNotAnArgument(opts.system, "system prompt");

  const args = [
    "-p",
    ...(usingFile
      ? ["--system-prompt-file", opts.systemPromptFile!]
      : ["--system-prompt", opts.system]),
    // Drop the harness preamble the newsroom has no use for.
    "--exclude-dynamic-system-prompt-sections",
    // Do NOT inherit the operator's CLAUDE.md, skills, or plugins.
    "--setting-sources",
    "",
    // No file access and no bash, ever. Web tools only when the caller asks:
    // the editorial writer needs them, the planner and synthesis do not.
    "--allowed-tools",
    (opts.allowedTools ?? []).join(","),
    "--model",
    opts.model,
    "--output-format",
    "json",
  ];

  return new Promise<ClaudeCodeResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        // Run detached from any project so no stray CLAUDE.md is discovered.
        cwd: process.env.TMPDIR || process.env.TEMP || process.cwd(),
        windowsHide: true,
      });
    } catch {
      resolve({ ok: false, error: CLAUDE_CLI_MISSING });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: ClaudeCodeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      /*
        Kill the tree, not the shim.

        `claude` on Windows is a Node process that owns the real session. A bare
        kill() takes the parent and leaves the session running, still spending,
        with nothing left to read its answer.
      */
      killTree(child);
      /*
        Say what was happening when the clock ran out.

        The first timeout on the Opinion desk reported four words and threw away
        both streams, so a thirty-minute failure produced no evidence at all.
        A run that has written nothing to either stream is a different fault
        from one that was mid-answer.
      */
      const tail = stderr.trim().split("\n").pop()?.slice(0, 200) ?? "";
      const seen = `${Math.round(opts.timeoutMs / 1000)}s, ${stdout.length} bytes out`;
      finish({
        ok: false,
        error: `Claude Code request timed out after ${seen}${tail ? ` — ${tail}` : ""}`,
      });
    }, opts.timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", () => finish({ ok: false, error: CLAUDE_CLI_MISSING }));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        const detail = stderr.trim().split("\n").pop()?.slice(0, 200) || `exit ${code}`;
        finish({ ok: false, error: `Claude Code failed: ${detail}` });
        return;
      }
      finish(parseCliEnvelope(stdout));
    });

    child.stdin?.on("error", () => {
      /* the child died before reading; `close` reports the real reason */
    });
    child.stdin?.end(opts.user);
  });
}

/** Pull the answer out of `--output-format json`. Exported for tests. */
export function parseCliEnvelope(stdout: string): ClaudeCodeResult {
  const raw = stdout.trim();
  if (!raw) return { ok: false, error: "Claude Code returned nothing" };
  let parsed: CliEnvelope;
  try {
    parsed = JSON.parse(raw) as CliEnvelope;
  } catch {
    return { ok: false, error: "Claude Code returned unreadable output" };
  }
  if (parsed.is_error) {
    const detail =
      typeof parsed.api_error_status === "string" || typeof parsed.api_error_status === "number"
        ? ` (${parsed.api_error_status})`
        : "";
    const text = typeof parsed.result === "string" ? parsed.result.slice(0, 200) : "";
    return { ok: false, error: `Claude Code error${detail}${text ? `: ${text}` : ""}` };
  }
  const text = typeof parsed.result === "string" ? parsed.result.trim() : "";
  if (!text) return { ok: false, error: "Empty model response" };
  return { ok: true, text };
}
