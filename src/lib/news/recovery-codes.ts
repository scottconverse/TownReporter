/*
  Owner recovery codes (Unit CJ, 0.6.80).

  Owner decision, 2026-09-27: "a set of 'i lost this setup code' codes after
  the owner is done and set up (like civiccast creates for the admin)."

  Pattern copied from CivicCast's admin recovery codes (see the report for the
  file:line search): 10 one-time codes, shown once, stored only as SHA-256
  hashes, each usable exactly once, and regenerating invalidates every code
  that came before it.

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
  no plaintext password or code is ever logged -- `logRecoveryCodeUse` records
  only who and when.
*/

import { hashPassword } from "better-auth/crypto";
import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

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

/** One recovery code: two groups of four, e.g. "K7QP-3M9X". 40 bits each. */
export function randomRecoveryCode(): string {
  const g = randomGroup();
  return `${g.slice(0, 4)}-${g.slice(4, 8)}`;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalize(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
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

/** Defensive fallback: migrations/0105 is the real schema source (see db.ts). */
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
  const sql = await getSql();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomRecoveryCode());
  const hashes = await Promise.all(codes.map((c) => sha256Hex(normalize(c))));
  // Regenerating invalidates the old set outright, not just "new codes also work".
  await sql.query(`delete from owner_recovery_code where newsroom_id = $1`, [newsroomId]);
  for (const hash of hashes) {
    await sql.query(
      `insert into owner_recovery_code (newsroom_id, code_hash) values ($1, $2)`,
      [newsroomId, hash],
    );
  }
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
  | { ok: true; tempPassword: string; ownerUserId: string }
  | { ok: false; reason: string };

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
  const hash = await sha256Hex(normalize(rawCode ?? ""));
  const row = await sql.query<{ id: number; newsroom_id: number }>(
    `select id, newsroom_id from owner_recovery_code where code_hash = $1 and used_at is null`,
    [hash],
  );
  const match = row[0];
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
  // Burn first: if two requests race the same code, only the winner of this
  // UPDATE proceeds to actually change the password.
  const burned = await sql.query<{ id: number }>(
    `update owner_recovery_code set used_at = now(), used_by = $2
     where id = $1 and used_at is null returning id`,
    [match.id, ownerUserId],
  );
  if (!burned[0]) return { ok: false, reason: "That recovery code was already used." };
  await sql.query(
    `update "account" set "password" = $1, "updatedAt" = now() where id = $2`,
    [newHash, account[0].id],
  );
  return { ok: true, tempPassword, ownerUserId };
}
