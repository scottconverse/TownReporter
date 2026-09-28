/*
  The first-owner setup code (Unit CJ, 0.6.80).

  Owner decision, 2026-09-27: on a fresh install, only someone holding a
  one-time setup code may claim the desk. `membership.ts` still carries no
  shared secret and no `NEWSROOM_SETUP_TOKEN` -- this is a different object
  from the constant an earlier audit removed as a Critical (guessable, no
  throttling, no entropy floor). This code is generated fresh per install,
  never shipped with the product, stored only as a hash, rate-limited, and
  burned the moment it is used. Once any owner exists it is deleted and never
  regenerated -- an install that already has an owner (the live paper) is
  completely unaffected; see `setup-code.test.ts`.

  Deliberately its own module, not part of `membership.ts`: `membership.ts`
  and `membership.test.ts` assert (by grep) that the file carries no setup
  token and that `claimOwner(userId)` takes no second argument. This module
  is a one-directional dependency of `membership.ts` (via `isSetupCodeRequired`)
  so there is no import cycle, and it never imports back.
*/

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getSql } from "../db.ts";
import { createAccountLockout } from "../auth/account-lockout.server.ts";

/** Crockford base32: no I, L, O, U -- nothing a human can misread or mistype. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 16 characters from a 32-symbol alphabet is 80 bits of entropy -- 10 random
 * bytes, grouped 4-4-4-4 the way a phone activation code or a Windows product
 * key reads. Far past a guessing attack even before the 5-per-15-minute limit
 * in `verifySetupCode` below.
 */
export function randomSetupCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += CROCKFORD[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return (out.match(/.{1,4}/g) ?? [out]).join("-");
}

/** Same hashing shape membership.ts uses for invite tokens -- SHA-256 hex. */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalize what an operator types: trim, uppercase, dashes optional. */
function normalizeTyped(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function normalizeStored(code: string): string {
  return normalizeTyped(code);
}

const SETUP_CODE_DDL = `
  create table if not exists owner_setup_code (
    id integer primary key,
    code_hash text not null,
    created_at timestamptz not null default now(),
    consumed_at timestamptz
  )
`;

/** Defensive fallback: migrations/0105 is the real schema source (see db.ts). */
async function ensureSetupCodeTable() {
  const sql = await getSql();
  await sql.query(SETUP_CODE_DDL).catch(() => {});
}

/** Same data root the installer and stats-reports.server.ts already use. */
export function dataRoot(): string {
  return process.env.TOWNREPORTER_DATA_ROOT?.trim() || join(process.cwd(), ".townreporter-data");
}

export function setupCodeFilePath(): string {
  return join(dataRoot(), "logs", "SETUP-CODE.txt");
}

function deleteCodeFile() {
  try {
    const path = setupCodeFilePath();
    if (existsSync(path)) unlinkSync(path);
  } catch (err) {
    console.error(`[setup-code] could not delete ${setupCodeFilePath()}: ${String(err)}`);
  }
}

/**
 * Does any newsroom member row exist yet? Queried directly (not via
 * `membership.ts`) so this module has no import back into it -- a brand-new
 * database has no `newsroom_members` table at all, which reads as "no owner".
 */
async function anyOwnerExists(): Promise<boolean> {
  const sql = await getSql();
  try {
    const rows = await sql.query<{ c: number }>(
      `select count(*)::int as c from newsroom_members`,
    );
    return (rows[0]?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Boot-time (and ensure-on-read) idempotent setup.
 *
 * - An owner already exists: burn any stale row and delete the file. This is
 *   what keeps an existing install (the live paper) completely unaffected --
 *   it never had a pending code, so this is a silent no-op every time it runs.
 * - No owner, and a code is already pending: leave it alone. Regenerating on
 *   every restart would invalidate a code the operator has not typed in yet.
 * - No owner, no pending code: generate one, store its hash, write the file,
 *   and log it once.
 */
let loggedThisProcess = false;
export async function ensureOwnerSetupCode(): Promise<void> {
  await ensureSetupCodeTable();
  const sql = await getSql();
  if (await anyOwnerExists()) {
    await sql.query(`delete from owner_setup_code where id = 1`).catch(() => {});
    deleteCodeFile();
    return;
  }
  const existing = await sql.query<{ consumed_at: string | null }>(
    `select consumed_at from owner_setup_code where id = 1`,
  );
  if (existing[0] && !existing[0].consumed_at) {
    return; // already pending; keep it stable across restarts
  }
  const code = randomSetupCode();
  const hash = await sha256Hex(normalizeStored(code));
  await sql.query(
    `insert into owner_setup_code (id, code_hash, created_at, consumed_at)
     values (1, $1, now(), null)
     on conflict (id) do update set code_hash = excluded.code_hash, created_at = now(), consumed_at = null`,
    [hash],
  );
  const path = setupCodeFilePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${code}\n`, { mode: 0o600 });
  } catch (err) {
    console.error(`[setup-code] could not write ${path}: ${String(err)}`);
  }
  if (!loggedThisProcess) {
    loggedThisProcess = true;
    // Printed once so an operator watching the console at first boot sees it
    // without having to go find the file.
    console.log(
      `[setup-code] First-owner setup code (one time, also written to ${path}): ${code}`,
    );
  }
}

/**
 * Test-only escape hatch for suites that exercise `requireEditor`'s RACE and
 * INDEX behavior (`first-owner-race.test.ts`), which predates this feature
 * and is orthogonal to it -- those tests want a truly gate-free fresh desk,
 * but `isSetupCodeRequired`'s own ensure-on-read would otherwise regenerate a
 * pending code the instant it is asked on an ownerless desk, mid-race.
 *
 * No file under `src/routes`, `claim.ts`, `server/plugins`, or the installer
 * ever calls this setter -- production has no code path that reaches it,
 * with or without any environment variable, which is the proof this cannot
 * leak into a real deployment (see `setup-code.test.ts` /
 * `newsroom-security.test.mjs` for the check that nothing in `src/`
 * references it outside test files).
 */
let forcedSatisfied = false;
export function forceSetupCodeSatisfiedForTests(): void {
  forcedSatisfied = true;
}
export function clearSetupCodeOverrideForTests(): void {
  forcedSatisfied = false;
}

/**
 * True while a desk is unclaimed AND a setup code is pending for it.
 *
 * Calls `ensureOwnerSetupCode()` itself ("ensure-on-read") so the code can
 * never be missing when this is asked -- the boot-time Nitro plugin
 * (`server/plugins/setup-code.ts`) only runs in the BUILT server, so `npm
 * run dev` and every unit test that imports this module directly still get
 * a code generated the first time anything asks.
 */
export async function isSetupCodeRequired(): Promise<boolean> {
  if (forcedSatisfied) return false;
  await ensureOwnerSetupCode();
  if (await anyOwnerExists()) return false;
  const sql = await getSql();
  const rows = await sql.query<{ consumed_at: string | null }>(
    `select consumed_at from owner_setup_code where id = 1`,
  );
  return Boolean(rows[0] && !rows[0].consumed_at);
}

export type SetupCodeCheck = { ok: true } | { ok: false; reason: string };

/**
 * 5 attempts per 15 minutes per caller, the exact shape (and the exact
 * `createAccountLockout` helper) `account-lockout.server.ts` already proved
 * for the sign-in throttle -- an in-memory rolling window keyed on a string,
 * here the caller's IP address rather than an email address.
 */
const setupCodeAttempts = createAccountLockout({ maxAttempts: 5, windowSeconds: 900 });

/** Exposed for tests that need to reset the shared in-memory bucket. */
export function resetSetupCodeAttemptsForTests(ipKey: string): void {
  setupCodeAttempts.recordSuccess(ipKey);
}

/**
 * Check a typed code against the pending one. Rate-limited BEFORE the hash
 * comparison so a blocked caller cannot use timing or repeated tries to learn
 * anything about the stored hash.
 */
export async function verifySetupCode(rawCode: string, ipKey: string): Promise<SetupCodeCheck> {
  const decision = setupCodeAttempts.check(ipKey);
  if (decision.blocked) {
    const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
    return {
      ok: false,
      reason: `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }
  await ensureSetupCodeTable();
  const sql = await getSql();
  const rows = await sql.query<{ code_hash: string; consumed_at: string | null }>(
    `select code_hash, consumed_at from owner_setup_code where id = 1`,
  );
  const row = rows[0];
  if (!row || row.consumed_at) {
    setupCodeAttempts.recordFailure(ipKey);
    return { ok: false, reason: "No setup code is pending, or it was already used." };
  }
  const hash = await sha256Hex(normalizeTyped(rawCode ?? ""));
  if (hash !== row.code_hash) {
    setupCodeAttempts.recordFailure(ipKey);
    return { ok: false, reason: "Wrong setup code." };
  }
  setupCodeAttempts.recordSuccess(ipKey);
  return { ok: true };
}

/** Burn the pending code (the claim it gated has succeeded) and remove the file. */
export async function burnSetupCode(): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update owner_setup_code set consumed_at = now() where id = 1 and consumed_at is null`,
  );
  deleteCodeFile();
}
