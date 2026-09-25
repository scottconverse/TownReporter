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
import { mediaToolChildEnv } from "./cli-child-env.server.ts";

/** The interpreter yt-dlp is installed into; resolved from PATH, as before. */
const MEDIA_TOOL = "python";

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
  return spawn(MEDIA_TOOL, argv, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    // The argv carries URLs and a Windows path to the output directory. A shell
    // would re-split both.
    shell: false,
    windowsHide: true,
    stdio: options.stdio,
    env: mediaToolChildEnv(),
  });
}
