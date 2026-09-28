/*
  Unit CJ (0.6.80): behavior tests for owner recovery codes.

  Same shared PGlite as the other membership tests. Every test resets
  `newsroom_members`, the `account` credential row, and `owner_recovery_code`.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  recoveryCodesRemaining,
  redeemRecoveryCode,
} from "./recovery-codes.ts";

const OWNER_ID = "recovery-owner-1";
const OTHER_NEWSROOM = 7;

async function reset() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql.query(`create table if not exists owner_recovery_code (
    id serial primary key, newsroom_id integer not null default 1,
    code_hash text not null unique, created_at timestamptz not null default now(),
    used_at timestamptz, used_by text
  )`);
  await sql`delete from newsroom_members`;
  await sql.query(`delete from owner_recovery_code`);
  // Auth's "user"/"account" tables live under migrations/auth/, which
  // `ensureNewsroomSchema()` never touches (see invites.test.ts for the same
  // pattern) -- create the minimal shape this module actually reads/writes.
  await sql.query(`create table if not exists "user" (id text primary key, email text not null)`);
  await sql.query(
    `create table if not exists "account" (
       id text primary key, "accountId" text not null, "providerId" text not null,
       "userId" text not null, "password" text, "updatedAt" timestamptz not null default now()
     )`,
  );
  await sql.query(`delete from "account" where "userId" like 'recovery-%'`);
  await sql.query(`delete from "user" where id like 'recovery-%'`);
  await sql.query(
    `insert into "user" (id, email) values ($1, 'recovery-owner@example.test') on conflict (id) do nothing`,
    [OWNER_ID],
  );
  await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${OWNER_ID}, ${"owner"}, ${1})`;
  await sql.query(
    `insert into "account" (id, "accountId", "providerId", "userId", "password", "updatedAt")
     values ($1, $2, 'credential', $2, 'placeholder-hash', now())`,
    [`${OWNER_ID}-account`, OWNER_ID],
  );
}

/** `audit_events` in the shape `audit()` writes to, so the module's own ensure is a no-op. */
const AUDIT_TABLE = `
  create table if not exists audit_events (
    id serial primary key,
    user_id text not null,
    action text not null,
    detail text not null default '',
    created_at timestamptz not null default now(),
    newsroom_id integer not null default 1,
    subject_kind text,
    subject_id integer
  )
`;

/**
 * Rebuild `audit_events` so that the redemption event cannot be written, the
 * way an unwritable audit table behaves in production (a check constraint here
 * because it is the one failure the rest of the schema tolerates).
 */
async function unmakeAuditTable() {
  const sql = await getSql();
  await sql.query(`drop table if exists audit_events`);
  await sql.query(
    `create table audit_events (
       id serial primary key,
       user_id text not null,
       action text not null check (action <> 'recovery-code-used'),
       detail text not null default '',
       created_at timestamptz not null default now(),
       newsroom_id integer not null default 1,
       subject_kind text,
       subject_id integer
     )`,
  );
}

async function restoreAuditTable() {
  const sql = await getSql();
  await sql.query(`drop table if exists audit_events`);
  await sql.query(AUDIT_TABLE);
}

async function ownerPassword(): Promise<string | undefined> {
  const sql = await getSql();
  const rows = await sql.query<{ password: string }>(
    `select password from "account" where "userId" = $1 and "providerId" = 'credential'`,
    [OWNER_ID],
  );
  return rows[0]?.password;
}

describe("owner recovery codes", () => {
  it("generates 10 codes, stores only hashes, and reports the right remaining count", async () => {
    await reset();
    const codes = await generateRecoveryCodes(1);
    assert.equal(codes.length, RECOVERY_CODE_COUNT);
    assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT, "codes must be distinct");
    const sql = await getSql();
    const rows = await sql.query<{ code_hash: string }>(
      `select code_hash from owner_recovery_code where newsroom_id = 1`,
    );
    assert.equal(rows.length, RECOVERY_CODE_COUNT);
    for (const row of rows) {
      assert.ok(!codes.includes(row.code_hash), "the raw code must never be stored");
    }
    assert.equal(await recoveryCodesRemaining(1), RECOVERY_CODE_COUNT);
  });

  it("a code works once: redeeming it issues a temp password and burns it", async () => {
    await reset();
    const [code] = await generateRecoveryCodes(1);
    const first = await redeemRecoveryCode(code);
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.ownerUserId, OWNER_ID);
      assert.match(first.tempPassword, /^[0-9a-z]+$/);
    }
    assert.equal(await recoveryCodesRemaining(1), RECOVERY_CODE_COUNT - 1);
    const second = await redeemRecoveryCode(code);
    assert.equal(second.ok, false);
  });

  /*
    Review finding 2 (P1). The redemption used to burn the code and replace the
    password first and audit afterwards, in the caller. When the audit failed
    the request errored -- so the owner never saw the temporary password, the
    old password was already gone, and the code read as used: a lost desk.

    The contract asserted here is the one the review asked for: if the audit
    cannot be written, NOTHING changed -- the code is still live and the old
    password still works.
  */
  it("an unwritable audit row rolls the whole redemption back", async () => {
    await reset();
    const [code] = await generateRecoveryCodes(1);
    const before = await ownerPassword();

    await unmakeAuditTable();
    let result: Awaited<ReturnType<typeof redeemRecoveryCode>>;
    try {
      result = await redeemRecoveryCode(code);
    } finally {
      await restoreAuditTable();
    }

    assert.equal(
      result.ok,
      false,
      "the redemption must not report success when the audit row it promises cannot be written",
    );
    assert.equal(await recoveryCodesRemaining(1), RECOVERY_CODE_COUNT, "the code must not be burned");
    assert.equal(await ownerPassword(), before, "the old password must still be the one that works");

    // And the code still redeems, for real, once the audit table is healthy.
    const retry = await redeemRecoveryCode(code);
    assert.equal(retry.ok, true, "the code must still be usable after the failed attempt");
    assert.notEqual(await ownerPassword(), before, "the retry did set the temporary password");
    const sql = await getSql();
    const audited = await sql.query<{ c: number }>(
      `select count(*)::int as c from audit_events where action = 'recovery-code-used' and user_id = $1`,
      [OWNER_ID],
    );
    assert.equal(audited[0]?.c, 1, "the successful redemption wrote its audit event");
  });

  it("regenerating invalidates every old code, not just adds new ones", async () => {
    await reset();
    const first = await generateRecoveryCodes(1);
    const second = await generateRecoveryCodes(1);
    assert.equal(await recoveryCodesRemaining(1), RECOVERY_CODE_COUNT, "still exactly one live set");
    // None of the first set redeems any more.
    for (const code of first.slice(0, 3)) {
      const result = await redeemRecoveryCode(code);
      assert.equal(result.ok, false, `old code ${code} should be dead`);
    }
    // The new set does.
    const result = await redeemRecoveryCode(second[0]);
    assert.equal(result.ok, true);
  });

  it("a wrong code is refused without touching the real set", async () => {
    await reset();
    await generateRecoveryCodes(1);
    const before = await recoveryCodesRemaining(1);
    const result = await redeemRecoveryCode("ZZZZ-ZZZZ");
    assert.equal(result.ok, false);
    assert.equal(await recoveryCodesRemaining(1), before);
  });

  it("redeeming actually changes the stored password hash", async () => {
    await reset();
    const sql = await getSql();
    const before = await sql.query<{ password: string }>(
      `select password from "account" where "userId" = $1 and "providerId" = 'credential'`,
      [OWNER_ID],
    );
    const [code] = await generateRecoveryCodes(1);
    await redeemRecoveryCode(code);
    const after = await sql.query<{ password: string }>(
      `select password from "account" where "userId" = $1 and "providerId" = 'credential'`,
      [OWNER_ID],
    );
    assert.notEqual(after[0]?.password, before[0]?.password);
  });

  it("codes are scoped per newsroom", async () => {
    await reset();
    const codesA = await generateRecoveryCodes(1);
    const codesB = await generateRecoveryCodes(OTHER_NEWSROOM);
    assert.equal(await recoveryCodesRemaining(1), RECOVERY_CODE_COUNT);
    assert.equal(await recoveryCodesRemaining(OTHER_NEWSROOM), RECOVERY_CODE_COUNT);
    assert.notDeepEqual(codesA, codesB);
  });
});
