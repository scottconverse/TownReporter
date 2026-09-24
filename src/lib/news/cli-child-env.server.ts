/*
  The environment a spawned provider CLI is allowed to see -- SERVER ONLY.

  `spawn(..., { env: { ...process.env } })` handed every child the whole server
  environment: `BETTER_AUTH_SECRET`, `DATABASE_URL` with the paper's
  credentials in it, every configured provider key, the Grok client secret. A
  drafting CLI needs none of that, and an agent CLI is a program that reads its
  own environment while its input includes text fetched from the open web.

  So a child gets a named allow-list instead of a copy of everything. What the
  listed names have in common is that a CLI cannot work without them: how to
  start a process, the home directory that holds the sign-in it already has, a
  temp directory, proxy and TLS trust, the locale.
*/
import path from "node:path";

/** Names a provider CLI genuinely needs. Windows variable names are case-insensitive. */
const ALLOWED = [
  // Start a process at all.
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "OS",
  // The home the CLI keeps its own sign-in in. Dropping these is the "signed
  // in, changes nothing" failure: the child writes its credentials somewhere
  // the desk never looks.
  "USERPROFILE",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "USERDOMAIN",
  "LOGNAME",
  // Scratch space for the CLI's own working files.
  "TEMP",
  "TMP",
  "TMPDIR",
  // Locale and terminal shape, so the CLI behaves here as it does in a shell.
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  // Node itself: both CLIs are Node programs, and a `.js` entry point is run
  // by this Node rather than by the OS (see cli-spawn.server.ts).
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_NO_WARNINGS",
  // Egress through a corporate proxy, and TLS trust for a private CA.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Where the operator said each CLI is, and where it keeps its own config.
  "CODEX_CLI_PATH",
  "CLAUDE_CLI_PATH",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
];

/**
 * The Claude CLI's own credentials.
 *
 * `ANTHROPIC_API_KEY` is the one `*_API_KEY` that is allowed through, and it
 * is allowed only for the Claude child. It is the credential for the provider
 * whose CLI this is -- the desk's own signed-out message offers it as the
 * alternative to signing in -- so a Claude CLI that cannot see it cannot sign
 * in the way the product documents. It is never passed to Codex.
 */
export const CLAUDE_CREDENTIAL_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
];

/**
 * The hermetic CLI harness (`scripts/fakes/*.mjs`) steers a fake through
 * `FAKE_*` variables it reads from the environment, and CI drives the real
 * spawn path with them. They hold no secrets and are absent from an install;
 * passing them keeps the fakes exercising the same code production runs.
 */
const HARNESS_PREFIX = "FAKE_";

/** A copy of this process's environment reduced to the names above. */
export function cliChildEnv(extra: readonly string[] = []): NodeJS.ProcessEnv {
  const allow = new Set([...ALLOWED, ...extra].map((name) => name.toUpperCase()));
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!allow.has(upper) && !upper.startsWith(HARNESS_PREFIX)) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Add the home directory a Codex-family CLI needs, the way the desk derives it.
 *
 * A server launched by the Windows installer has no USERPROFILE of its own.
 * Without these defaults Codex cannot find the sign-in it already has, and a
 * login spawned with a different CODEX_HOME than the drafting calls use writes
 * its credentials somewhere the desk never looks -- a sign-in that reports
 * success and changes nothing.
 */
export function withCodexHome(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const appData = process.env.APPDATA?.trim();
  const userRoot =
    process.env.USERPROFILE?.trim() || (appData ? path.resolve(appData, "..", "..") : undefined);
  return {
    ...env,
    ...(userRoot && !process.env.USERPROFILE ? { USERPROFILE: userRoot } : {}),
    ...(userRoot && !process.env.HOME ? { HOME: userRoot } : {}),
    ...(userRoot && !process.env.CODEX_HOME ? { CODEX_HOME: path.join(userRoot, ".codex") } : {}),
  };
}

/** The environment for a Codex child: the allow-list plus the home defaults. */
export function codexChildEnv(): NodeJS.ProcessEnv {
  return withCodexHome(cliChildEnv());
}

/** The environment for a Claude child: the allow-list plus its own credentials. */
export function claudeChildEnv(): NodeJS.ProcessEnv {
  return cliChildEnv(CLAUDE_CREDENTIAL_ENV);
}
