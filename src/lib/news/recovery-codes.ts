/*
  Owner recovery codes (Unit CJ, 0.6.80).

  Owner decision, 2026-09-27: "a set of 'i lost this setup code' codes after
  the owner is done and set up (like civiccast creates for the admin)."

  Pattern matched to CivicCast's admin recovery codes
  (civiccast/installer/station_state.py:57,661,1033,1267-1287,1375-1376 in
  the civiccast-native checkout): one-time codes, stored only as salted
  hashes, consumed by removing the matched hash from the list (never a
  separate "used" flag), and a redeemed code replaces the admin/owner
  password rather than signing anyone in directly. One deliberate
  difference: CivicCast prints 8 codes (`_RECOVERY_CODE_COUNT = 8`); this
  uses 10, per the task's own explicit fallback count ("10 codes, shown
  once...") rather than matching CivicCast's number exactly.

  Smallest safe path for what redeeming a code actually DOES, chosen after
  reading `src/lib/auth/server.ts` and `src/lib/auth/account-lockout.server.ts`:
  this app runs its own Better Auth with `emailAndPassword` and no built-in
  password-reset flow. Better Auth exports its own password hasher at
  `better-auth/crypto` (`hashPassword`) -- the exact function it uses itself
  for `emailAndPassword` sign-up -- so redeeming a code sets a fresh, random,
  one-time TEMPORARY PASSWORD on the owner's own `account` row (provider
  "credential") using that same hasher, burns the code, and hands the
  temporary password back once. The owner signs in with it and is expected to
  change their password from the desk afterward (the existing account
  settings already have a change-password control; this does not add a new
  one). Nothing here touches Better Auth's session or cookie machinery, and
  no plaintext password or code is ever logged -- the audit event records only
  who and when, in the same transaction as the burn and the password change
  (review finding 2; see `redeemRecoveryCode`).
*/

import { hashPassword, verifyPassword } from "better-auth/crypto";
import { getSql, withTransaction } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { auditWithSql, ensureAuditEventsSchema } from "./ops.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomGroup(): string {
  const bytes = new Uint8Array(5); // 40 bits -> 8 chars
  crypto.getRandomValues(bytes);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += CROCKFORD[Number.parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

/** One recovery code: two groups of four, e.g. "K7QP-3M9X". 40 bits in total. */
export function randomRecoveryCode(): string {
  const g = randomGroup();
  return `${g.slice(0, 4)}-${g.slice(4, 8)}`;
}

/**
 * The stored form of a code: the same salted, slow hash Better Auth uses for
 * passwords (`hashPassword` from `better-auth/crypto` -- scrypt, N=16384,
 * r=16, p=1, a random 16-byte salt per hash, written as `salt:key`).
 *
 * Review finding 3 (Unit CR, 0.6.81). These were a bare, unsalted SHA-256 of
 * the code, and a code is 40 bits. Two groups of four Crockford characters is
 * a comfortable thing to read off a printed sheet, but it is 2^40 guesses --
 * and against an unsalted SHA-256 that is a trivial offline sweep from any
 * stolen copy of the database, no rate limit and no server involved. The
 * salted slow hash makes each guess cost a full scrypt, so a database copy is
 * no longer a cheaper attack than the live, throttled endpoint (5 attempts /
 * 15 min per IP). The 40-bit code length is kept deliberately: it is the
 * entropy the format was specified with, and the hash is what the finding is
 * about. Verification stays constant-time per candidate (see below).
 */
async function hashCode(raw: string): Promise<string> {
  return hashPassword(normalize(raw));
}

/**
 * Constant-time-in-shape verification: every unused row is verified, the match
 * is remembered rather than returned, and there is no early exit -- so the
 * work does not depend on which code (if any) matched, and the loop cannot
 * become an oracle for a row's position.
 *
 * A row whose hash is not in `salt:key` form (Better Auth's verifier throws on
 * those; an install that briefly ran the reverted 0.6.80 build may hold old
 * SHA-256 rows) is treated as a non-match instead of failing the whole call.
 */
async function matchesAny(
  candidates: { id: number; newsroom_id: number; code_hash: string }[],
  raw: string,
) {
  const normalized = normalize(raw);
  let match: { id: number; newsroom_id: number } | undefined;
  for (const row of candidates) {
    let ok = false;
    try {
      ok = await verifyPassword({ hash: row.code_hash, password: normalized });
    } catch {
      ok = false;
    }
    if (ok && !match) match = { id: row.id, newsroom_id: row.newsroom_id };
  }
  return match;
}

function normalize(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

const RECOVERY_CODE_DDL = `
  create table if not exists owner_recovery_code (
    id serial primary key,
    newsroom_id integer not null default 1,
    code_hash text not null unique,
    created_at timestamptz not null default now(),
    used_at timestamptz,
    used_by text
  )
`;

/** Defensive fallback: migrations/0107 is the real schema source (see db.ts). */
async function ensureRecoveryCodeTable() {
  const sql = await getSql();
  await sql.query(RECOVERY_CODE_DDL).catch(() => {});
}

export const RECOVERY_CODE_COUNT = 10;

/**
 * Generate a fresh set of 10 codes for `newsroomId`, replacing (invalidating)
 * whatever set existed before. Returns the RAW codes -- shown exactly once;
 * the database only ever holds their hashes.
 *
 * Caller (recovery-codes-api.ts) is responsible for checking the requester is
 * this newsroom's owner before calling this.
 */
export async function generateRecoveryCodes(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<string[]> {
  await ensureRecoveryCodeTable();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
  // One at a time: scrypt at these parameters wants ~32 MB while it runs, and
  // ten at once is ten of those (the Node thread pool would queue them
  // anyway). This is a once-in-an-install button, not a hot path.
  const hashes: string[] = [];
  for (const code of codes) hashes.push(await hashCode(code));
  // Regenerating invalidates the old set outright, not just "new codes also work".
  // Delete and inserts are one transaction: if any insert fails, the old set
  // stays valid instead of the owner losing every code and receiving none.
  await withTransaction(async (tx) => {
    await tx.query(`delete from owner_recovery_code where newsroom_id = $1`, [newsroomId]);
    for (const hash of hashes) {
      await tx.query(`insert into owner_recovery_code (newsroom_id, code_hash) values ($1, $2)`, [
        newsroomId,
        hash,
      ]);
    }
  });
  return codes;
}

export async function recoveryCodesRemaining(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<number> {
  await ensureRecoveryCodeTable();
  const sql = await getSql();
  const rows = await sql.query<{ c: number }>(
    `select count(*)::int as c from owner_recovery_code where newsroom_id = $1 and used_at is null`,
    [newsroomId],
  );
  return rows[0]?.c ?? 0;
}

export type RecoveryRedemption =
  { ok: true; tempPassword: string; ownerUserId: string } | { ok: false; reason: string };

/**
 * Redeem a recovery code: find the owner it belongs to, set a fresh random
 * temporary password on their "credential" account row, burn the code, and
 * log the use (who + when, never the code). Callers must rate-limit before
 * calling this (see `recovery-codes-api.ts`) -- this function trusts that a
 * throttle already ran.
 */
export async function redeemRecoveryCode(rawCode: string): Promise<RecoveryRedemption> {
  await ensureRecoveryCodeTable();
  const sql = await getSql();
  // The salted hash cannot be looked up by value, so the code is verified
  // against each unused row in turn -- at most ten of them.
  const candidates = await sql.query<{ id: number; newsroom_id: number; code_hash: string }>(
    `select id, newsroom_id, code_hash from owner_recovery_code where used_at is null`,
  );
  const match = await matchesAny(candidates, rawCode ?? "");
  if (!match) return { ok: false, reason: "That recovery code is not valid, or was already used." };
  const owner = await sql.query<{ user_id: string }>(
    `select user_id from newsroom_members where newsroom_id = $1 and role = 'owner' limit 1`,
    [match.newsroom_id],
  );
  const ownerUserId = owner[0]?.user_id;
  if (!ownerUserId) return { ok: false, reason: "This desk has no owner to recover." };
  const account = await sql.query<{ id: string }>(
    `select id from "account" where "userId" = $1 and "providerId" = 'credential' limit 1`,
    [ownerUserId],
  );
  if (!account[0]) {
    return { ok: false, reason: "This owner has no password sign-in to recover." };
  }
  const tempPassword = `${randomGroup()}${randomGroup()}`.toLowerCase();
  const newHash = await hashPassword(tempPassword);

  /*
    Review finding 2 (P1), Unit CR 0.6.81. Burning the code, replacing the
    password, and writing the audit event are one unit of work. They used to be
    three: the burn and the password here, the audit in the caller afterwards.
    An audit that threw then left the owner with a consumed code, a password
    they were never shown, and no way back in -- a lost desk, the exact failure
    this feature exists to prevent. Now a failure anywhere rolls back all three
    and the caller gets `ok: false`, so the code is still live and the old
    password still works.

    The reads above stay outside the transaction: they are lookups, and the
    only race that matters is the burn, which the UPDATE's `used_at is null`
    guard decides inside it. `ensureAuditEventsSchema()` is DDL and runs before
    the transaction; the event itself is written through the transaction's own
    connection (see `auditWithSql`).
  */
  await ensureAuditEventsSchema();

  let burned = false;
  try {
    burned = await withTransaction(async (tx) => {
      const burnedRow = await tx.query<{ id: number }>(
        `update owner_recovery_code set used_at = now(), used_by = $2
         where id = $1 and used_at is null returning id`,
        [match.id, ownerUserId],
      );
      // Lost the race for this code: nothing else has happened yet, so there is
      // nothing to undo and the transaction commits empty.
      if (!burnedRow[0]) return false;
      await tx.query(`update "account" set "password" = $1, "updatedAt" = now() where id = $2`, [
        newHash,
        account[0].id,
      ]);
      await auditWithSql(
        tx,
        ownerUserId,
        "recovery-code-used",
        "owner recovery code redeemed; temporary password issued",
        match.newsroom_id,
      );
      return true;
    });
  } catch (err) {
    console.error(
      "[recovery-codes] redemption rolled back; the code is still unused and the old password still works:",
      err,
    );
    return {
      ok: false,
      reason:
        "Could not complete the recovery just now. Nothing was changed -- your code still works and your old password still works.",
    };
  }
  if (!burned) return { ok: false, reason: "That recovery code was already used." };
  return { ok: true, tempPassword, ownerUserId };
}
