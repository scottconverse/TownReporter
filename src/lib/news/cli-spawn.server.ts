/**
 * How to actually start a CLI whose path an operator gave us — **server-only**.
 *
 * `CLAUDE_CLI_PATH` and `CODEX_CLI_PATH` are operator-set, and the thing an
 * operator most naturally points them at is the JavaScript entry point the npm
 * package ships (`.../@anthropic-ai/claude-code/cli.js`) rather than the
 * platform binary sitting next to it. Windows cannot exec a `.js` file: Node's
 * spawn hands it to CreateProcess, which refuses anything that is not a real
 * executable, and the desk reports the CLI as missing on a machine where it is
 * plainly installed.
 *
 * So: a path that is obviously a Node script is run BY Node, with the script as
 * its first argument. Everything else is spawned exactly as before. This is one
 * decision in one place because three call sites need it to agree — a probe
 * that resolves the CLI differently from the call it is vouching for is a green
 * light in front of a broken road.
 *
 * `.cmd` and `.bat` are deliberately NOT handled here. Node refuses to spawn
 * them without a shell (EINVAL, since the 2024 argument-injection fix), and
 * going through a shell breaks the empty-string arguments the Claude adapter
 * depends on. The npm shim is a `.cmd`; the real binary beside it is what these
 * finders look for.
 */

/** A path this process should hand to Node rather than to the OS. */
export function isNodeScript(bin: string): boolean {
  return /\.(?:mjs|cjs|js)$/i.test(bin.trim());
}

export type SpawnPlan = { command: string; args: string[] };

/** What to spawn, and with which arguments, for a resolved CLI path. */
export function spawnPlan(bin: string, args: string[]): SpawnPlan {
  return isNodeScript(bin)
    ? { command: process.execPath, args: [bin, ...args] }
    : { command: bin, args };
}
