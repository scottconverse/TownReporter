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
 * All calls retain the installed CLI's full tool and MCP configuration.
 * Permission bypass is explicit; settings sources remain enabled so operator
 * MCP servers are available. Prompts and transport stay owned by the desk.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertNotAnArgument } from "./voice.server.ts";
import { resolveCliPath, spawnPlan } from "./cli-spawn.server.ts";
import { cliAppDataDir, claudeChildEnv } from "./cli-child-env.server.ts";
import type { ChatResult, ChatResultMetadata } from "./ai-result-metadata.ts";
import { CLAUDE_CLI_EFFORTS, type ModelEffort } from "./provider-registry.ts";

/**
 * Mirrors the limit in `assertNotAnArgument` (voice.server.ts): the point
 * past which a string stops being a safe command-line argument. Kept as its
 * own constant here rather than imported so this module never has to reach
 * back into voice.server.ts for a number — only for the assertion itself.
 */
const SAFE_SYSTEM_ARG_CHARS = 8000;

export type ClaudeCodeResult = ChatResult;

/** Shape of `--output-format json`. Only the fields this module reads. */
type CliEnvelope = {
  is_error?: boolean;
  result?: unknown;
  subtype?: string;
  api_error_status?: unknown;
  duration_ms?: unknown;
  model?: unknown;
  modelUsage?: unknown;
  usage?: unknown;
  num_turns?: unknown;
  toolExecutions?: unknown;
};

type CliResultContext = Omit<ChatResultMetadata, "durationMs"> & { durationMs: number };

function reportedCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function cliMetadata(envelope: CliEnvelope, fallback: CliResultContext): ChatResultMetadata {
  const usage = envelope.usage && typeof envelope.usage === "object"
    ? envelope.usage as Record<string, unknown>
    : undefined;
  const reportedModel = typeof envelope.model === "string" && envelope.model.trim()
    ? envelope.model
    : envelope.modelUsage && typeof envelope.modelUsage === "object"
      ? Object.keys(envelope.modelUsage as Record<string, unknown>).find(Boolean)
      : undefined;
  return {
    ...fallback,
    ...(reportedCount(envelope.num_turns) !== undefined ? { toolRounds: reportedCount(envelope.num_turns) } : {}),
    ...(envelope.toolExecutions && typeof envelope.toolExecutions === "object" && !Array.isArray(envelope.toolExecutions)
      ? { toolExecutions: Object.fromEntries(Object.entries(envelope.toolExecutions).filter(([, count]) => reportedCount(count) !== undefined)) as Record<string, number> }
      : {}),
    model: reportedModel ?? fallback.model,
    durationMs: reportedCount(envelope.duration_ms) ?? fallback.durationMs,
    ...(reportedCount(usage?.input_tokens) !== undefined ? { inputTokens: reportedCount(usage?.input_tokens) } : {}),
    ...(reportedCount(usage?.output_tokens) !== undefined ? { outputTokens: reportedCount(usage?.output_tokens) } : {}),
    ...(reportedCount(usage?.total_tokens) !== undefined ? { totalTokens: reportedCount(usage?.total_tokens) } : {}),
  };
}

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
  const appData = cliAppDataDir();
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

let resolvedBin: string | undefined;

/**
 * First candidate that exists on disk, or null. A found path is memoized; a miss
 * is not, so a CLI installed after the first look (or a boot-time look made
 * before the profile was readable) is found on the next call, not at restart.
 */
export async function findClaudeCli(): Promise<string | null> {
  if (resolvedBin !== undefined) return resolvedBin;
  const { access } = await import("node:fs/promises");
  for (const candidate of claudeCliCandidates()) {
    try {
      await access(candidate);
      // `access()` resolves a relative CLAUDE_CLI_PATH against this process's
      // cwd, but every call below is spawned from TMPDIR/TEMP. Absolute here,
      // or the path that was found and the path that is executed differ.
      resolvedBin = resolveCliPath(candidate);
      return resolvedBin;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Reset the memoized lookup. Tests only. */
export function resetClaudeCliCache() {
  resolvedBin = undefined;
}

export const CLAUDE_CLI_MISSING =
  "Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code) and sign in with `claude`, set CLAUDE_CLI_PATH to its binary, or set ANTHROPIC_API_KEY instead.";

export async function probeClaudeCode(label = "Claude"): Promise<
  { ok: true; label: string } | { ok: false; error: string }
> {
  const bin = await findClaudeCli();
  if (!bin) return { ok: false, error: CLAUDE_CLI_MISSING };
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      const plan = spawnPlan(bin, ["auth", "status", "--json"]);
      child = spawn(plan.command, plan.args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: claudeChildEnv(),
      });
    } catch {
      resolve({ ok: false, error: CLAUDE_CLI_MISSING });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (result: { ok: true; label: string } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "Claude login check timed out." });
      killTree(child);
    }, 10_000);
    timer.unref?.();
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.on("error", () => finish({ ok: false, error: CLAUDE_CLI_MISSING }));
    child.on("close", (code) => {
      try {
        const status = JSON.parse(stdout) as { loggedIn?: boolean };
        if (code === 0 && status.loggedIn) return finish({ ok: true, label });
      } catch {
        /* use the actionable signed-out message below */
      }
      finish({
        ok: false,
        error: "Claude is signed out. Open Claude Code, sign in, then try again.",
      });
    });
  });
}

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
      const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
      killer.on("error", () => child.kill());
      killer.on("close", (code) => {
        if (code !== 0) child.kill();
      });
      const fallback = setTimeout(() => child.kill(), 500);
      fallback.unref?.();
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

/** Shared full-tool argv for chat and OCR; no allow-list or MCP suppression. */
export function buildClaudeCodeArgs(input: {
  model: string;
  reasoningEffort?: ModelEffort | null;
  system?: string;
  systemPromptFile?: string;
}): string[] {
  return [
    "-p",
    "--dangerously-skip-permissions",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
    // Override personal prompt inputs per call while leaving settings sources,
    // plugins, credentials and configured MCP servers loaded by the CLI.
    "--settings", JSON.stringify({
      claudeMdExcludes: ["**"],
      disableAllHooks: true,
      autoMemoryEnabled: false,
      outputStyle: "default",
      attribution: { commit: "", pr: "" },
    }),
    ...(input.systemPromptFile
      ? ["--system-prompt-file", input.systemPromptFile]
      : input.system !== undefined ? ["--system-prompt", input.system] : []),
    "--exclude-dynamic-system-prompt-sections",
    "--model", input.model,
    ...(input.reasoningEffort ? ["--effort", input.reasoningEffort] : []),
    "--output-format", "json",
  ];
}

/**
 * One prompt, one answer. The user text goes over stdin, never argv: the desk
 * sends packs up to ~28k characters and Windows caps a command line at ~32k.
 */
export async function claudeCodeChat(opts: {
  /** DeepSeek uses the same full-tool CLI with a per-call relay and credentials. */
  deepSeek?: {
    baseUrl: string;
    apiKey?: string;
    onEvidence?: import("./deepseek-relay.server.ts").DeepSeekRelayObserver;
  };
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
  /** @deprecated Compatibility no-op. Every call has the full tool set. */
  allowedTools?: string[];
  /** @deprecated Compatibility no-op. Cannot hide or deny tools. */
  noTools?: boolean;
  /** Per-run Claude CLI effort. Only values advertised by this installed CLI are accepted. */
  reasoningEffort?: ModelEffort | null;
}): Promise<ClaudeCodeResult> {
  // Every caller retains the installed CLI tool set, including editorial writing.
  /*
    A long prompt must never become an argument, no matter which caller
    forgot to plan for it.

    Every desk call used to have to remember to pass `systemPromptFile`
    itself, and grokChat's claude-code branch never did — it always inlined
    `system` as `--system-prompt`, which is fine for the one-line prompts
    most callers send and a live crash the day one doesn't (dark_jobs id 49:
    an 11,961-character Dark Desk system prompt tripped `assertNotAnArgument`
    below). Rather than push that discipline onto every caller, this is now
    the one choke point: a caller-supplied `systemPromptFile` is always
    honoured as-is, and an inline `system` over the safe argv length is
    silently promoted to a private temp file instead of being thrown at the
    command line. Only a system prompt that is both inline AND short ever
    reaches argv.
  */
  let systemPromptFile = opts.systemPromptFile;
  let ownedTempDir: string | undefined;
  if (!systemPromptFile && opts.system.length > SAFE_SYSTEM_ARG_CHARS) {
    ownedTempDir = await mkdtemp(join(tmpdir(), "trd-sysprompt-"));
    systemPromptFile = join(ownedTempDir, "system-prompt.txt");
    await writeFile(systemPromptFile, opts.system, "utf8");
  }
  const usingFile = Boolean(systemPromptFile);

  const cleanupTempDir = () => {
    if (!ownedTempDir) return;
    const dir = ownedTempDir;
    ownedTempDir = undefined;
    void rm(dir, { recursive: true, force: true }).catch(() => {
      /* best-effort; a leftover temp file is not worth failing the call over */
    });
  };

  // The editor authorizes research with the editorial voice loaded. A prompt
  // file is a transport mechanism, not a reason to remove requested web tools.
  // Fetched pages remain untrusted evidence, never instructions.

  if (!opts.deepSeek && opts.reasoningEffort && !CLAUDE_CLI_EFFORTS.includes(opts.reasoningEffort)) {
    cleanupTempDir();
    throw new Error(
      `Unsupported Claude effort ${opts.reasoningEffort}. Supported values: ${CLAUDE_CLI_EFFORTS.join(", ")}.`,
    );
  }

  const bin = await findClaudeCli();
  if (!bin) {
    cleanupTempDir();
    return { ok: false, error: CLAUDE_CLI_MISSING };
  }

  /*
    Arguments are visible to any process that can list processes, and Windows
    caps them at 32,767 characters anyway. `assertNotAnArgument` makes an
    over-length inline prompt a refusal rather than a habit — it should never
    actually fire now that the block above promotes long prompts to a file
    first, but it stays as the backstop for the one path left: a caller-passed
    `systemPromptFile` was not used, and the prompt is still too long, which
    only happens if `SAFE_SYSTEM_ARG_CHARS` and `assertNotAnArgument`'s own
    limit ever drift apart.
  */
  if (!usingFile) assertNotAnArgument(opts.system, "system prompt");

  const args = buildClaudeCodeArgs({
    model: opts.model,
    reasoningEffort: opts.deepSeek ? undefined : opts.reasoningEffort,
    system: usingFile ? undefined : opts.system,
    systemPromptFile,
  });

  const relay = opts.deepSeek
    ? await (await import("./deepseek-relay.server.ts")).deepSeekRelayRoute(opts.deepSeek).catch(error => {
      cleanupTempDir();
      throw error;
    })
    : undefined;
  const childEnv = claudeChildEnv();
  if (opts.deepSeek && relay) {
    Object.assign(childEnv, {
      ANTHROPIC_BASE_URL: relay.baseUrl,
      ANTHROPIC_AUTH_TOKEN: opts.deepSeek.apiKey || "ollama",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: opts.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: opts.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: opts.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: opts.model,
      ANTHROPIC_SMALL_FAST_MODEL: opts.model,
      CLAUDE_CODE_SUBAGENT_MODEL: opts.model,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  }

  return new Promise<ClaudeCodeResult>((resolve) => {
    const startedAt = Date.now();
    const baseMeta = (timedOut: boolean): CliResultContext => ({
      provider: "claude-code",
      model: opts.model,
      durationMs: Date.now() - startedAt,
      timedOut,
    });
    let child: ReturnType<typeof spawn>;
    try {
      const plan = spawnPlan(bin, args);
      child = spawn(plan.command, plan.args, {
        stdio: ["pipe", "pipe", "pipe"],
        // Run detached from any project so no stray CLAUDE.md is discovered.
        cwd: process.env.TMPDIR || process.env.TEMP || process.cwd(),
        windowsHide: true,
        // An allow-list, not this process's whole environment: the child is a
        // program that reads what it is given, and it does not need the
        // paper's secrets. See cli-child-env.server.ts.
        env: childEnv,
      });
    } catch {
      cleanupTempDir();
      relay?.release();
      resolve({ ok: false, error: CLAUDE_CLI_MISSING, meta: baseMeta(false) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: ClaudeCodeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupTempDir();
      relay?.release();
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
        meta: baseMeta(true),
      });
    }, opts.timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", () => finish({ ok: false, error: CLAUDE_CLI_MISSING, meta: baseMeta(false) }));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        const detail = stderr.trim().split("\n").pop()?.slice(0, 200) || `exit ${code}`;
        finish({ ok: false, error: `Claude Code failed: ${detail}`, meta: baseMeta(false) });
        return;
      }
      finish(parseCliEnvelope(stdout, baseMeta(false)));
    });

    child.stdin?.on("error", () => {
      /* the child died before reading; `close` reports the real reason */
    });
    child.stdin?.end(opts.user);
  });
}

/** OCR input transport, with the same full tools as ordinary chat. */
export async function claudeCodeReadChat(opts: {
  /** Instructions plus the exact file path to read, in one user message. */
  prompt: string;
  filePath: string;
  model: string;
  timeoutMs: number;
  reasoningEffort?: ModelEffort | null;
}): Promise<ClaudeCodeResult> {
  const bin = await findClaudeCli();
  if (!bin) return { ok: false, error: CLAUDE_CLI_MISSING };

  const args = buildClaudeCodeArgs(opts);
  const userMessage = `${opts.prompt}\n\nRead the file at exactly this path and use only its contents: ${opts.filePath}`;

  return new Promise<ClaudeCodeResult>((resolve) => {
    const startedAt = Date.now();
    const baseMeta = (timedOut: boolean): CliResultContext => ({
      provider: "claude-code",
      model: opts.model,
      durationMs: Date.now() - startedAt,
      timedOut,
    });
    let child: ReturnType<typeof spawn>;
    try {
      const plan = spawnPlan(bin, args);
      child = spawn(plan.command, plan.args, {
        stdio: ["pipe", "pipe", "pipe"],
        // Start beside the page so relative OCR references resolve correctly.
        cwd: dirname(opts.filePath),
        windowsHide: true,
        env: claudeChildEnv(),
      });
    } catch {
      resolve({ ok: false, error: CLAUDE_CLI_MISSING, meta: baseMeta(false) });
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
      killTree(child);
      const tail = stderr.trim().split("\n").pop()?.slice(0, 200) ?? "";
      const seen = `${Math.round(opts.timeoutMs / 1000)}s, ${stdout.length} bytes out`;
      finish({
        ok: false,
        error: `Claude Code request timed out after ${seen}${tail ? ` — ${tail}` : ""}`,
        meta: baseMeta(true),
      });
    }, opts.timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", () => finish({ ok: false, error: CLAUDE_CLI_MISSING, meta: baseMeta(false) }));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        const detail = stderr.trim().split("\n").pop()?.slice(0, 200) || `exit ${code}`;
        finish({ ok: false, error: `Claude Code failed: ${detail}`, meta: baseMeta(false) });
        return;
      }
      finish(parseCliEnvelope(stdout, baseMeta(false)));
    });
    child.stdin?.on("error", () => {
      /* close/error reports the process result */
    });
    child.stdin?.end(userMessage);
  });
}

/** Pull the answer out of `--output-format json`. Exported for tests. */
export function parseCliEnvelope(stdout: string, context?: CliResultContext): ClaudeCodeResult {
  const raw = stdout.trim();
  if (!raw) return { ok: false, error: "Claude Code returned nothing", ...(context ? { meta: context } : {}) };
  let parsed: CliEnvelope;
  try {
    parsed = JSON.parse(raw) as CliEnvelope;
  } catch {
    return { ok: false, error: "Claude Code returned unreadable output", ...(context ? { meta: context } : {}) };
  }
  const meta = context ? cliMetadata(parsed, context) : undefined;
  if (parsed.is_error) {
    const detail =
      typeof parsed.api_error_status === "string" || typeof parsed.api_error_status === "number"
        ? ` (${parsed.api_error_status})`
        : "";
    const text = typeof parsed.result === "string" ? parsed.result.slice(0, 200) : "";
    return { ok: false, error: `Claude Code error${detail}${text ? `: ${text}` : ""}`, ...(meta ? { meta } : {}) };
  }
  const text = typeof parsed.result === "string" ? parsed.result.trim() : "";
  if (!text) return { ok: false, error: "Empty model response", ...(meta ? { meta } : {}) };
  return { ok: true, text, ...(meta ? { meta } : {}) };
}
