import path from "node:path";

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

/**
 * A CLI path that means the same file from ANY working directory.
 *
 * An operator writes `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH` relative to the
 * checkout more naturally than absolutely — `scripts/fakes/fake-codex-cli.mjs`,
 * `./bin/codex` — and the finders check that path with `access()`, which
 * resolves it against THIS process's cwd. The call itself is then spawned with
 * a different `cwd` on purpose (`tmpdir()`, so Codex cannot read the repo while
 * reporting; the Claude adapter uses TMPDIR/TEMP for the same reason). A
 * relative path therefore passed the existence check and then pointed somewhere
 * else entirely: Node looked for
 * `<temp>/scripts/fakes/fake-codex-cli.mjs`, found nothing, and exited 1 with
 * "Cannot find module" — which no failure classifier reads as an auth lapse, so
 * an Automatic draft that should have failed over to the next rung died on the
 * generic "could not complete this draft" instead. Two CI browser jobs
 * (failover, story-quota-failover) were red for exactly that.
 *
 * So resolve it here, while a copy of the operator's own value is still in
 * hand, rather than at each spawn site — the finder, the probe that vouches for
 * the CLI and the draft that uses it must all name the same file. A bare
 * command name (`codex`, `claude`) is deliberately left alone: it is a PATH
 * lookup, and resolving it would invent a path that is not meant to exist.
 */
export function resolveCliPath(bin: string): string {
  const trimmed = bin.trim();
  if (!trimmed || path.isAbsolute(trimmed)) return trimmed;
  if (!/[/\\]/.test(trimmed)) return trimmed;
  return path.resolve(trimmed);
}

export type SpawnPlan = { command: string; args: string[] };

/** What to spawn, and with which arguments, for a resolved CLI path. */
export function spawnPlan(bin: string, args: string[]): SpawnPlan {
  return isNodeScript(bin)
    ? { command: process.execPath, args: [bin, ...args] }
    : { command: bin, args };
}
