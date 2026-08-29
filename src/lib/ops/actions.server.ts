import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { findOpsAction, type OpsActionId } from "./actions";

const run = promisify(execFile);

/**
 * Running the allowlisted ops actions.
 *
 * The mapping from id to command lives here and nowhere else. Every command is
 * a fixed executable plus a fixed argument array built in this file; no caller
 * input is ever interpolated into a command string, so there is no shell to
 * inject into even if the login is defeated. Adding an action means editing
 * this table and `actions.ts`, deliberately, in a diff someone reviews.
 */
type Spec = {
  exe: "powershell" | "node";
  args: (root: string) => string[];
  timeoutMs: number;
};

const PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];
/** For the one action that hands work to Windows rather than running it. */
const PS_CMD = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

const SPECS: Record<OpsActionId, Spec> = {
  watchdog: {
    exe: "powershell",
    args: (root) => [...PS, join(root, "ops", "watchdog.ps1")],
    timeoutMs: 120_000,
  },
  /*
    Handed to Windows for a second reason on top of the one below.

    This reply travels out through the tunnel it is about to cut. Run inline,
    the server only answers once the script finishes — by which time the line
    is already down, the browser gets nothing, and a restart that worked
    perfectly reports as an error. Started as a task, the answer is sent
    immediately and the script waits a few seconds before cutting.
  */
  "restart-tunnel": {
    exe: "powershell",
    args: () => [
      ...PS_CMD,
      "Start-ScheduledTask -TaskName 'TownReporter Tunnel Restart'; " +
        "'Handed to Windows. The tunnel drops in about 4 seconds and is back within 20.'",
    ],
    timeoutMs: 30_000,
  },
  /*
    Handed to Windows, not spawned from here.

    A detached `spawn` was the obvious approach and it did not work: the child
    was created — the ops log records the exact command — and then did nothing
    at all, writing neither its own log nor a single line of output, every
    time. Whatever ends it, the answer is not to keep guessing at process
    flags for the one action that has to outlive the process starting it.

    A scheduled task is owned by Windows and has no relationship to this
    server, which is the property actually needed. The same mechanism already
    runs the tunnel and the watchdog here, and both survive the app dying.

    `Start-ScheduledTask` returns as soon as the task is handed over, so this
    is a normal short command rather than a detached one.
  */
  "restart-app": {
    exe: "powershell",
    args: () => [
      ...PS_CMD,
      "Start-ScheduledTask -TaskName 'TownReporter Restart'; " +
        "'Handed to Windows. The paper stops and starts again within about 20 seconds.'",
    ],
    timeoutMs: 30_000,
  },
  "rotate-logs": {
    exe: "powershell",
    args: (root) => [...PS, join(root, "ops", "rotate-logs.ps1")],
    timeoutMs: 60_000,
  },
  migrate: {
    exe: "node",
    args: (root) => [join(root, "scripts", "migrate.mjs")],
    timeoutMs: 120_000,
  },
  "refresh-fonts": {
    exe: "node",
    args: (root) => [join(root, "scripts", "fetch-fonts.mjs")],
    timeoutMs: 180_000,
  },
};

export type OpsActionResult = {
  ok: boolean;
  id: string;
  output: string;
};

export async function runOpsActionById(
  id: OpsActionId,
  root = process.cwd(),
): Promise<OpsActionResult> {
  const action = findOpsAction(id);
  const spec = SPECS[id];
  if (!action || !spec) return { ok: false, id, output: "Unknown action." };

  const exe = spec.exe === "node" ? process.execPath : "powershell.exe";
  const args = spec.args(root);

  try {
    const { stdout, stderr } = await run(exe, args, {
      cwd: root,
      timeout: spec.timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
    return { ok: true, id, output: output || "Done. Nothing to report." };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const output = [e.stdout?.trim(), e.stderr?.trim(), e.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      ok: false,
      id,
      output: (e.killed ? "Timed out.\n" : "") + (output || "Failed with no output."),
    };
  }
}
