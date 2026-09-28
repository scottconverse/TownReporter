/*
  The one place the desk starts a media tool -- SERVER ONLY.

  yt-dlp is a python program, and it reaches for ffmpeg. Both are started as
  children of this server, both read their own environment, and yt-dlp's input
  is a URL fetched from the open web -- the same class of child as the agent
  CLIs, and the same reason they get a named allow-list rather than a copy of
  everything this server was started with (cli-child-env.server.ts).

  Three call sites used to spawn `python` each on their own terms. One function
  is what makes the environment answerable in one place: a new call site cannot
  forget it, because it cannot spawn python without going through here.
*/
import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioOptions,
  type StdioPipe,
} from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { mediaToolChildEnv } from "./cli-child-env.server.ts";
import { resolveCliPath } from "./cli-spawn.server.ts";

/** The interpreter yt-dlp is installed into when nobody names one: PATH's `python`. */
const MEDIA_TOOL = "python";

/**
 * The variable an operator sets to name the python.exe that has yt-dlp.
 *
 * This machine has three Pythons on PATH and only one of them has yt-dlp
 * installed, so which `python` a capture starts is decided by PATH order --
 * invisible, and different for an installer-launched server than for a shell.
 * Naming the interpreter makes that decision the operator's, and makes a wrong
 * one fail in words instead of running a python that cannot answer.
 */
export const TOWNREPORTER_PYTHON = "TOWNREPORTER_PYTHON";

export type MediaToolPython = { ok: true; bin: string } | { ok: false; error: string };

/**
 * The operator named a python and it is not there.
 *
 * Not the same failure as "no python anywhere", and it must not be answered
 * with a fallback to whatever else is on the machine: the install that set
 * `TOWNREPORTER_PYTHON` did so to choose WHICH python runs yt-dlp, and quietly
 * running a different interpreter instead is the bug this variable exists to
 * end -- a capture that reports failure with no reason an operator can act on.
 * The Claude and Codex CLIs read their own `*_CLI_PATH` this way
 * (`codexCliPathMissing`, ai-codex.server.ts).
 */
export function mediaToolPythonMissing(named: string): string {
  return (
    `${TOWNREPORTER_PYTHON} is set to ${named}, but there is no file there. ` +
    `TownReporter will not run a different python instead: ` +
    `correct the path, or unset ${TOWNREPORTER_PYTHON} to use "python" from PATH.`
  );
}

/**
 * The interpreter a media tool child should start: the operator's, or PATH's.
 *
 * A relative operator path is made absolute while a copy of their own value is
 * still in hand -- a capture is spawned with a `cwd` of its own, so a relative
 * path that passed this check would point somewhere else by the time it was
 * started (the same reason `resolveCliPath` exists for the provider CLIs).
 * Unset is `python`, exactly as before.
 */
export function resolveMediaToolPython(env: NodeJS.ProcessEnv = process.env): MediaToolPython {
  const named = env[TOWNREPORTER_PYTHON]?.trim();
  if (!named) return { ok: true, bin: MEDIA_TOOL };
  const resolved = resolveCliPath(named);
  if (existsSync(resolved)) return { ok: true, bin: resolved };
  return { ok: false, error: mediaToolPythonMissing(named) };
}

type MediaToolOptions<Stdin extends StdioNull | StdioPipe, Stdout extends StdioNull | StdioPipe, Stderr extends StdioNull | StdioPipe> =
  { cwd?: string } & SpawnOptionsWithStdioTuple<Stdin, Stdout, Stderr>;

/*
  The two shapes the desk starts: a capture that reads stdout and stderr, and a
  readiness check that reads stdout only. Spelled as overloads so a call site
  keeps the same narrowed `child.stdout` / `child.stderr` it had while it called
  `spawn` itself -- a plain `ChildProcess` would make every reader of those
  streams nullable, and `child.stdout?.on(...)` would turn a wrong stdio array
  into a capture that silently records nothing.
*/
export function spawnMediaTool(
  argv: string[],
  options: MediaToolOptions<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>;
export function spawnMediaTool(
  argv: string[],
  options: MediaToolOptions<StdioNull, StdioPipe, StdioNull>,
): ChildProcessByStdio<null, Readable, null>;
export function spawnMediaTool(
  argv: string[],
  options: { cwd?: string; stdio: StdioOptions },
): ChildProcess;
export function spawnMediaTool(
  argv: string[],
  options: { cwd?: string; stdio: StdioOptions },
): ChildProcess {
  /*
    Refused, not rerouted: an operator who set TOWNREPORTER_PYTHON to a file
    that is not there gets the sentence, and the capture fails with it as its
    reason. The callers already turn a failed start into their own failure
    shape (meeting-capture-ytdlp.ts reads `error.message` into `stderr`), so
    this is the same channel a spawn failure has always used -- the difference
    is that the sentence says which setting to fix.
  */
  const python = resolveMediaToolPython();
  if (!python.ok) throw new Error(python.error);
  return spawn(python.bin, argv, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    // The argv carries URLs and a Windows path to the output directory. A shell
    // would re-split both.
    shell: false,
    windowsHide: true,
    stdio: options.stdio,
    env: mediaToolChildEnv(),
  });
}
