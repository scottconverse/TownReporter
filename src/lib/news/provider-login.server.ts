/**
 * Sign in to the writing models from inside the desk — **server-only**.
 *
 * The desk drafts through two locally installed CLIs on the operator's own
 * subscriptions (see ai-claude-code.server.ts and ai-codex.server.ts). When a
 * login lapses the paper stops, and until now the only cure was a terminal.
 * This operator is point-and-click; a login that needs a terminal is a login
 * that does not happen.
 *
 * ## What the CLIs actually do headless (measured on this machine,
 * artifacts/signin-spike-2026-09-02/)
 *
 * - `claude auth login --claudeai` needs no TTY. Spawned detached with stdin
 *   closed it prints its authorize URL to STDOUT and opens its own random-port
 *   loopback listener; Anthropic's hosted callback completes the flow. There is
 *   no device-code mode. The URL's real lifetime is not documented, so this
 *   module treats ten minutes as the limit and says so on screen.
 * - `codex login --device-auth` prints a URL and a one-time code to STDOUT and
 *   opens no local port; the code expires in fifteen minutes. Plain
 *   `codex login` binds a FIXED localhost:1455 and prints to STDERR — it is
 *   never used here, because two operators (or one operator twice) would
 *   collide on that port.
 *
 * ## What this module never does
 *
 * It never reads, stores, or logs a credential. The CLI writes its own file and
 * owns its own refresh; all that crosses this boundary is a URL, a one-time
 * code the human is meant to read, and an exit status. `detail` is redacted
 * before it is stored, because a CLI's last stderr line is not a place anyone
 * has promised not to print a token.
 *
 * MUST keep the `.server` suffix and be reached by dynamic import only.
 */
import { spawn } from "node:child_process";
import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { spawnPlan } from "./cli-spawn.server.ts";

export type ProviderId = "claude" | "codex";

export type ProviderLoginStatus =
  | "starting"
  | "awaiting_user"
  | "done"
  | "failed"
  | "expired"
  | "cancelled";

export type ProviderLogin = {
  id: number;
  newsroom_id: number;
  provider: ProviderId;
  status: ProviderLoginStatus;
  /** The authorize URL the human must open. Null until the CLI prints it. */
  url: string | null;
  /** Codex's one-time device code. Claude has none. */
  code: string | null;
  /** Redacted last word from the CLI, kept so an operator can see the detail. */
  detail: string;
  pid: number | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  /** Seconds left before this attempt is abandoned. Computed, not stored. */
  expiresInSeconds: number;
};

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/**
 * How long an attempt may sit unanswered.
 *
 * Codex states its own fifteen minutes on screen. Claude's authorize URL does
 * not say, so ten minutes is a decision, not a measurement — short enough that
 * a forgotten browser tab cannot hold a spawned CLI open all afternoon.
 */
export const LOGIN_LIMIT_MS: Record<ProviderId, number> = {
  claude: 10 * 60_000,
  codex: 15 * 60_000,
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === "claude" || value === "codex";
}

/* ── Parsing what the CLIs print ────────────────────────────────────────── */

// eslint-disable-next-line no-control-regex -- ANSI colour codes are control characters by definition.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Codex colours its URL and its code. Strip that before matching anything. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * The first https URL in the output.
 *
 * Trailing punctuation is trimmed because a CLI may print the URL inside a
 * sentence, and a URL with a stray full stop on the end is a dead link the
 * operator would have to notice and fix by hand.
 */
export function firstHttpsUrl(text: string): string | null {
  const match = stripAnsi(text).match(/https:\/\/[^\s"'<>`]+/);
  if (!match) return null;
  return match[0].replace(/[.,;:)\]]+$/, "");
}

/** `claude auth login --claudeai` prints one URL and then waits. */
export function parseClaudeLogin(text: string): { url: string | null } {
  return { url: firstHttpsUrl(text) };
}

/**
 * `codex login --device-auth` prints a URL and, two lines later, the code.
 *
 * The code is read POSITIONALLY — the line after the one that announces it —
 * rather than by guessing its alphabet. Device codes are short and
 * unpredictable, and a shape-matching regex would happily return the version
 * number from the banner. The regex below is only the fallback for a future
 * layout where the announcement line changes wording.
 */
export function parseCodexLogin(text: string): { url: string | null; code: string | null } {
  const clean = stripAnsi(text);
  const lines = clean.split(/\r?\n/);
  const url = firstHttpsUrl(clean);
  let code: string | null = null;
  const announced = lines.findIndex((l) => /one-time code/i.test(l));
  if (announced >= 0) {
    for (const line of lines.slice(announced + 1)) {
      const trimmed = line.trim();
      if (trimmed) {
        code = trimmed;
        break;
      }
    }
  }
  if (!code) {
    const shaped = clean.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/);
    code = shaped ? shaped[0] : null;
  }
  return { url, code };
}

/**
 * Take anything that could be a secret out of a line before it is stored.
 *
 * The one-time code is deliberately included: it is shown live on the page
 * while the login is open, and it has no business surviving in a `detail`
 * column afterwards.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .replace(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/g, "[redacted]")
    .replace(/(token|secret|password|credential)\s*[:=]\s*\S+/gi, "$1: [redacted]");
}

/** Last non-empty line of a stream, redacted and clipped. Exported for tests. */
export function lastLine(text: string, max = 200): string {
  const lines = stripAnsi(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return redactSecrets(lines[lines.length - 1] ?? "").slice(0, max);
}

/* ── Schema ─────────────────────────────────────────────────────────────── */

/**
 * The same table as migrations/0027_provider_logins.sql.
 *
 * Declared twice for the reason every other ensure in this codebase is (see
 * ensureJobsSchema in jobs.ts): the migration covers a real Postgres, this
 * covers the embedded PGLite path where migrations never run. A test asserts
 * the two agree.
 */
export async function ensureProviderLoginsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists provider_logins (
      id serial primary key,
      newsroom_id integer not null default 1,
      provider text not null,
      status text not null default 'starting',
      url text,
      code text,
      detail text not null default '',
      pid integer,
      started_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      finished_at timestamptz
    )
  `);
  await sql.query(`
    create index if not exists provider_logins_open_idx
      on provider_logins (newsroom_id, provider, status, id desc)
  `);
  await sweepStaleProviderLoginsOnStartup();
}

/**
 * Once per process, retire any row this server left `starting`/`awaiting_user`
 * the last time it ran. A restarted process owns nothing in `live` yet — every
 * PID any of those rows remember belongs, if it belongs to anything at all, to
 * whatever Windows has since recycled that number to. Retiring never spawns
 * `taskkill`; see killTree's callers for why that matters.
 */
let startupSweepDone = false;

async function sweepStaleProviderLoginsOnStartup() {
  if (startupSweepDone) return;
  startupSweepDone = true;
  const sql = await getSql();
  await sql.query(
    `update provider_logins
        set status = 'expired',
            detail = $1,
            updated_at = now(),
            finished_at = now()
      where status in ('starting','awaiting_user')`,
    ["This process restarted while that sign-in was open."],
  );
}

/** Reset the one-time startup-sweep latch. Tests only. */
export function resetProviderLoginStartupSweepForTest() {
  startupSweepDone = false;
}

const OPEN: ProviderLoginStatus[] = ["starting", "awaiting_user"];

type Row = Omit<ProviderLogin, "expiresInSeconds">;

function shape(row: Row): ProviderLogin {
  const limit = LOGIN_LIMIT_MS[row.provider] ?? LOGIN_LIMIT_MS.claude;
  const started = Date.parse(row.started_at);
  const left = Number.isFinite(started) ? limit - (Date.now() - started) : 0;
  return {
    ...row,
    detail: row.detail ?? "",
    expiresInSeconds: OPEN.includes(row.status) ? Math.max(0, Math.round(left / 1000)) : 0,
  };
}

const COLUMNS = `id, newsroom_id, provider, status, url, code, detail, pid,
  started_at, updated_at, finished_at`;

export async function getProviderLogin(
  id: number,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderLogin | null> {
  await ensureProviderLoginsSchema();
  const sql = await getSql();
  const rows = await sql.query<Row>(
    `select ${COLUMNS} from provider_logins where id = $1 and newsroom_id = $2 limit 1`,
    [id, newsroomId],
  );
  return rows[0] ? shape(rows[0]) : null;
}

export async function latestProviderLogin(
  provider: ProviderId,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderLogin | null> {
  await ensureProviderLoginsSchema();
  const sql = await getSql();
  const rows = await sql.query<Row>(
    `select ${COLUMNS} from provider_logins
     where newsroom_id = $1 and provider = $2 order by id desc limit 1`,
    [newsroomId, provider],
  );
  return rows[0] ? shape(rows[0]) : null;
}

async function patch(id: number, fields: Record<string, unknown>, finished = false) {
  const sql = await getSql();
  const keys = Object.keys(fields);
  const params: unknown[] = [id];
  const sets = keys.map((k) => {
    params.push(fields[k]);
    return `${k} = $${params.length}`;
  });
  sets.push("updated_at = now()");
  if (finished) sets.push("finished_at = now()");
  await sql.query(`update provider_logins set ${sets.join(", ")} where id = $1`, params);
}

/* ── Running the CLI ────────────────────────────────────────────────────── */

type Live = { child: ReturnType<typeof spawn>; timer: NodeJS.Timeout };

/**
 * The children this process started. Cancel/expire/poll kill ONLY through
 * this map — never through a PID read back out of the database. A row's
 * `pid` column is not proof of ownership: after a restart this map is empty
 * and every open row's `pid` is just a number Windows is free to have handed
 * to something else entirely (ENG-06). A row with no entry here is retired
 * without ever spawning `taskkill`.
 */
const live = new Map<number, Live>();

/** End a spawned CLI and everything it started. Same shape as the adapters'. */
function killTree(pid: number | undefined, child?: { kill: () => boolean }) {
  if (pid && process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => {
        try {
          child?.kill();
        } catch {
          /* already gone */
        }
      });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    if (child) child.kill();
    else if (pid) process.kill(pid);
  } catch {
    /* already gone */
  }
}

function forget(id: number) {
  const entry = live.get(id);
  if (entry) clearTimeout(entry.timer);
  live.delete(id);
}

async function findBinary(provider: ProviderId): Promise<string | null> {
  if (provider === "claude") {
    const { findClaudeCli } = await import("./ai-claude-code.server.ts");
    return findClaudeCli();
  }
  const { findCodexCli } = await import("./ai-codex.server.ts");
  return findCodexCli();
}

function loginArgs(provider: ProviderId): string[] {
  return provider === "claude" ? ["auth", "login", "--claudeai"] : ["login", "--device-auth"];
}

/**
 * The Codex adapter's env handling, kept identical here.
 *
 * A login spawned with a different HOME or CODEX_HOME than the drafting calls
 * use would write its credentials somewhere the desk never looks — a sign-in
 * that reports success and changes nothing.
 */
function childEnv(): NodeJS.ProcessEnv {
  const appData = process.env.APPDATA?.trim();
  const userRoot =
    process.env.USERPROFILE?.trim() ||
    (appData ? appData.replace(/[\\/]AppData[\\/]Roaming[\\/]?$/i, "") : undefined);
  return {
    ...process.env,
    ...(userRoot && !process.env.USERPROFILE ? { USERPROFILE: userRoot } : {}),
    ...(userRoot && !process.env.HOME ? { HOME: userRoot } : {}),
    ...(userRoot && !process.env.CODEX_HOME ? { CODEX_HOME: `${userRoot}\\.codex` } : {}),
  };
}

export async function probeProviderLogin(provider: ProviderId): Promise<boolean> {
  if (provider === "claude") {
    const { probeClaudeCode } = await import("./ai-claude-code.server.ts");
    return (await probeClaudeCode()).ok;
  }
  const { probeCodex } = await import("./ai-codex.server.ts");
  return (await probeCodex()).ok;
}

/**
 * Start a sign-in, or hand back the one already waiting.
 *
 * Refusing a second attempt is not tidiness. Two Codex device flows at once
 * print two codes and only one of them works; an operator staring at a stale
 * code has no way to tell which. One open attempt per provider, and the page
 * shows that one.
 */
export async function startProviderLogin(
  provider: ProviderId,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderLogin> {
  await ensureProviderLoginsSchema();
  const sql = await getSql();

  const open = await sql.query<Row>(
    `select ${COLUMNS} from provider_logins
     where newsroom_id = $1 and provider = $2 and status in ('starting','awaiting_user')
     order by id desc limit 1`,
    [newsroomId, provider],
  );
  if (open[0]) {
    const existing = shape(open[0]);
    // Still inside its own window? That is the attempt the operator is looking
    // at. Past it, the sweeper below retires it and a fresh one starts.
    if (existing.expiresInSeconds > 0) return existing;
    await expire(existing.id);
  }

  const bin = await findBinary(provider);
  const inserted = await sql.query<{ id: number }>(
    `insert into provider_logins (newsroom_id, provider, status) values ($1, $2, 'starting')
     returning id`,
    [newsroomId, provider],
  );
  const id = inserted[0]!.id;

  if (!bin) {
    await patch(
      id,
      {
        status: "failed",
        detail: `${PROVIDER_LABEL[provider]} is not installed on this machine.`,
      },
      true,
    );
    return (await getProviderLogin(id, newsroomId))!;
  }

  let child: ReturnType<typeof spawn>;
  try {
    const plan = spawnPlan(bin, loginArgs(provider));
    child = spawn(plan.command, plan.args, {
      // Detached with stdin closed is the whole trick: the CLI sees no TTY,
      // gives up on prompting, and prints the URL it would otherwise have
      // opened a browser for.
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv(),
    });
  } catch {
    await patch(id, { status: "failed", detail: "That command would not start." }, true);
    return (await getProviderLogin(id, newsroomId))!;
  }

  await patch(id, { pid: child.pid ?? null });

  let stdout = "";
  let stderr = "";
  let announced = false;

  /*
    Parse stdout AND stderr.

    Claude prints to stdout and Codex's device flow prints to stdout, which is
    what the spike measured. Plain `codex login` prints the same shape to
    stderr, and a CLI that changes which stream it uses would otherwise turn
    this whole feature off silently. Reading both costs nothing.
  */
  const consider = () => {
    if (announced) return;
    const text = `${stdout}\n${stderr}`;
    const found =
      provider === "codex" ? parseCodexLogin(text) : { ...parseClaudeLogin(text), code: null };
    if (!found.url) return;
    if (provider === "codex" && !found.code) return;
    announced = true;
    void patch(id, { status: "awaiting_user", url: found.url, code: found.code });
  };

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
    consider();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
    consider();
  });

  child.on("error", () => {
    forget(id);
    void patch(id, { status: "failed", detail: "That command would not start." }, true);
  });

  child.on("close", (code) => {
    forget(id);
    void (async () => {
      // The CLI exiting is not the answer; being signed in afterwards is.
      const signedIn = await probeProviderLogin(provider);
      if (signedIn) {
        await patch(id, { status: "done", detail: "" }, true);
        return;
      }
      const current = await getProviderLogin(id, newsroomId);
      // Cancel and expiry already wrote their own verdict; do not overwrite it.
      if (current && !OPEN.includes(current.status)) return;
      const said = lastLine(stderr) || lastLine(stdout);
      await patch(
        id,
        {
          status: "failed",
          detail: said || `That sign-in ended without completing (exit ${code}).`,
        },
        true,
      );
    })();
  });

  const timer = setTimeout(() => {
    void expire(id);
  }, LOGIN_LIMIT_MS[provider]);
  timer.unref?.();
  live.set(id, { child, timer });

  // Detached from this process's event loop; the listeners above still fire.
  child.unref?.();

  return (await getProviderLogin(id, newsroomId))!;
}

async function expire(id: number) {
  // Only ever kill a child THIS process still holds. A PID read back out of
  // the row is not proof of ownership — after a restart it is just a number,
  // and Windows recycles numbers. See killTree's callers, and ENG-06.
  const entry = live.get(id);
  forget(id);
  if (entry) killTree(entry.child.pid, entry.child);
  await patch(
    id,
    {
      status: "expired",
      detail: "That link ran out of time before anyone finished the sign-in.",
    },
    true,
  );
}

export async function cancelProviderLogin(
  id: number,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderLogin | null> {
  const row = await getProviderLogin(id, newsroomId);
  if (!row) return null;
  if (!OPEN.includes(row.status)) return row;
  // Same rule as expire(): kill only a child this process actually started.
  const entry = live.get(id);
  forget(id);
  if (entry) killTree(entry.child.pid, entry.child);
  await patch(id, { status: "cancelled", detail: "Stopped from the Server page." }, true);
  return getProviderLogin(id, newsroomId);
}

/**
 * Where an open attempt stands right now.
 *
 * A login can complete without the spawned CLI exiting — Claude's own loopback
 * listener may keep the process alive after the callback lands — so an open row
 * is re-probed rather than waited on. The probe is a process spawn, so it runs
 * at most once every three seconds per row.
 */
const lastPoll = new Map<number, number>();

export async function pollProviderLogin(
  id: number,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderLogin | null> {
  const row = await getProviderLogin(id, newsroomId);
  if (!row || !OPEN.includes(row.status)) return row;
  if (row.expiresInSeconds <= 0) {
    await expire(id);
    return getProviderLogin(id, newsroomId);
  }
  const now = Date.now();
  if (now - (lastPoll.get(id) ?? 0) < 3_000) return row;
  lastPoll.set(id, now);
  if (await probeProviderLogin(row.provider)) {
    // Same rule again: kill only a child this process actually started.
    const entry = live.get(id);
    forget(id);
    if (entry) killTree(entry.child.pid, entry.child);
    await patch(id, { status: "done", detail: "" }, true);
    return getProviderLogin(id, newsroomId);
  }
  return row;
}

/* ── Status, and the only check that proves anything ────────────────────── */

export type ProviderTest = { ok: boolean; ms: number; detail: string; at: string };

export type ProviderStatus = {
  provider: ProviderId;
  name: string;
  installed: boolean;
  /** Where the binary was found. Small print on the page, not a promise. */
  path: string | null;
  signedIn: boolean;
  /** Claude reports an email and a plan; Codex reports nothing but success. */
  account: string | null;
  /** TOWNREPORTER_CLAUDE_CODE=0 / TOWNREPORTER_CODEX=0. */
  disabledByOperator: boolean;
  /** The provider's own words when it is not signed in. */
  detail: string;
  lastChecked: string;
  lastTest: ProviderTest | null;
  /** The attempt in flight, if there is one. */
  login: ProviderLogin | null;
};

/** Last Test result per provider. In memory on purpose: it is not a record. */
const lastTests = new Map<ProviderId, ProviderTest>();

function disabled(provider: ProviderId): boolean {
  const key = provider === "claude" ? "TOWNREPORTER_CLAUDE_CODE" : "TOWNREPORTER_CODEX";
  return process.env[key]?.trim() === "0";
}

/** `claude auth status --json`, for the account line. Never throws. */
async function claudeAccount(bin: string): Promise<{ signedIn: boolean; account: string | null }> {
  const out = await new Promise<string>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      const plan = spawnPlan(bin, ["auth", "status", "--json"]);
      child = spawn(plan.command, plan.args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve("");
      return;
    }
    let text = "";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };
    const timer = setTimeout(() => {
      killTree(child.pid, child);
      done();
    }, 10_000);
    timer.unref?.();
    child.stdout?.on("data", (c) => (text += String(c)));
    child.on("error", done);
    child.on("close", done);
  });
  try {
    const parsed = JSON.parse(out) as {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
    };
    if (!parsed.loggedIn) return { signedIn: false, account: null };
    const plan = parsed.subscriptionType?.trim();
    const email = parsed.email?.trim();
    const account = [email, plan ? `${plan} plan` : ""].filter(Boolean).join(" · ") || null;
    return { signedIn: true, account };
  } catch {
    return { signedIn: false, account: null };
  }
}

export async function providerStatuses(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<ProviderStatus[]> {
  const at = new Date().toISOString();
  const out: ProviderStatus[] = [];
  for (const provider of ["claude", "codex"] as ProviderId[]) {
    const off = disabled(provider);
    const bin = off ? null : await findBinary(provider);
    /*
      `findCodexCli()` falls back to the bare string "codex" — a PATH lookup,
      not a file it found. Treating that as installed would print a path that
      may not exist, so it counts as installed only once a probe agrees.
    */
    const resolved = bin && bin !== "codex" ? bin : null;
    let signedIn = false;
    let account: string | null = null;
    let detail = "";
    if (off) {
      detail = `Turned off with ${provider === "claude" ? "TOWNREPORTER_CLAUDE_CODE" : "TOWNREPORTER_CODEX"}=0.`;
    } else if (!bin) {
      detail = `${PROVIDER_LABEL[provider]} was not found on this machine.`;
    } else if (provider === "claude") {
      const seen = await claudeAccount(bin);
      signedIn = seen.signedIn;
      account = seen.account;
      if (!signedIn) detail = "Signed out. Sign in below and the desk can draft again.";
    } else {
      const { probeCodex } = await import("./ai-codex.server.ts");
      const probe = await probeCodex();
      signedIn = probe.ok;
      account = probe.ok ? "signed in" : null;
      if (!probe.ok) detail = probe.error;
    }
    out.push({
      provider,
      name: PROVIDER_LABEL[provider],
      installed: Boolean(resolved) || signedIn,
      path: resolved,
      signedIn,
      account,
      disabledByOperator: off,
      detail,
      lastChecked: at,
      lastTest: lastTests.get(provider) ?? null,
      login: off ? null : await latestProviderLogin(provider, newsroomId),
    });
  }
  return out;
}

/**
 * One tiny real call, which is the only thing that proves the desk will draft.
 *
 * "Installed" and "signed in" are both true of a login whose refresh token the
 * server has since rejected — that is exactly the live 401 this feature was
 * built for. Nothing but a real round trip tells them apart.
 */
export async function testProvider(provider: ProviderId): Promise<ProviderTest> {
  const started = Date.now();
  const system = "Reply with the single word ok.";
  const user = "ok";
  let result: { ok: true; text: string } | { ok: false; error: string };
  if (provider === "claude") {
    const { claudeCodeChat } = await import("./ai-claude-code.server.ts");
    result = await claudeCodeChat({
      system,
      user,
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5",
      timeoutMs: 30_000,
    });
  } else {
    const { codexChat } = await import("./ai-codex.server.ts");
    result = await codexChat({
      system,
      user,
      model: process.env.TOWNREPORTER_CODEX_TERRA_MODEL?.trim() || "gpt-5.6-terra",
      timeoutMs: 30_000,
    });
  }
  const ms = Date.now() - started;
  const test: ProviderTest = {
    ok: result.ok,
    ms,
    detail: result.ok ? result.text.slice(0, 80) : redactSecrets(result.error).slice(0, 300),
    at: new Date().toISOString(),
  };
  lastTests.set(provider, test);
  return test;
}

/** Drop the remembered Test results. Tests only. */
export function resetProviderTestsForTest() {
  lastTests.clear();
  lastPoll.clear();
}
