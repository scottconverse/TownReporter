#!/usr/bin/env node
// @ts-check
/**
 * Give the staging copy a sign-in nobody has to guess.
 *
 * `ops\stage.ps1` restores the newest REAL production backup into
 * `townreporter_dev` so the coordinator can walk the changed screens before a
 * promote. That backup carries only the real owner's account, whose password
 * only the operator knows — so nobody else can open the staged desk.
 *
 * This script upserts one editor account, `staging@townreporter.test`, with a
 * fixed password, directly into `townreporter_dev`'s Better Auth + newsroom
 * tables. It is meant to run ONLY against the disposable staging copy, never
 * against the live paper's database — see `assertStagingDatabase` below,
 * which is the one thing standing between this script and a real account.
 *
 * Idempotent: running it again updates the password and role in place. It
 * never creates a second row for the same account, and it never touches any
 * OTHER user or membership row already in the restored backup (including the
 * real owner's).
 *
 * Role: `editor`, not `owner`. `newsroom_members` has a unique partial index
 * on `role = 'owner'` (migrations/0012_newsroom_appliance.sql) — a desk can
 * only ever have one owner, and the restored backup's owner row already holds
 * it, so a second owner is not a policy choice here, it is a constraint this
 * script cannot satisfy even if it tried. An `editor` can open every desk
 * page, including /desk/ops (the Server page) — see src/routes/desk.ops.tsx,
 * where `me.data?.role !== "owner"` hides a handful of owner-only PANELS
 * (Writing models sign-in, Paper setup, Invite an editor) but the page itself
 * renders for any newsroom member. So `editor` is enough to view every page;
 * it just cannot use those three owner-only controls.
 *
 * Password hashing: uses Better Auth's own hasher (`better-auth/crypto`,
 * scrypt under the hood) rather than hand-rolling one, so the row this script
 * writes verifies through Better Auth's normal sign-in path with no special
 * casing on the read side.
 */
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

export const STAGING_DB_NAME = "townreporter_dev";
export const STAGING_EMAIL = "staging@townreporter.test";
export const STAGING_PASSWORD = "staging-walk-2026";
export const STAGING_USER_ID = "staging-editor";
export const STAGING_NEWSROOM_ID = 1;

/**
 * The one guard between this script and a real database. Refuses anything
 * whose database name is not exactly `townreporter_dev` — no prefix match, no
 * "contains townreporter_dev", no missing-URL default. A malformed URL is
 * also a refusal, not a crash with a stack trace.
 * @param {string | undefined} databaseUrl
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertStagingDatabase(databaseUrl) {
  if (!databaseUrl || !databaseUrl.trim()) {
    return { ok: false, reason: "DATABASE_URL is not set." };
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { ok: false, reason: `DATABASE_URL does not parse as a URL: ${databaseUrl}` };
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName !== STAGING_DB_NAME) {
    return {
      ok: false,
      reason:
        `DATABASE_URL names database '${dbName}', not '${STAGING_DB_NAME}'. ` +
        `This script only ever writes to the disposable staging copy — refusing.`,
    };
  }
  return { ok: true };
}

/**
 * Mirrors the table shapes `src/lib/news/membership.ts`'s
 * `ensureNewsroomSchema` creates. Restated here (not imported) so this script
 * has no dependency on the app's own db module / TanStack server runtime —
 * it only needs `pg`. Every statement is `IF NOT EXISTS`, so this is a no-op
 * against the restored backup, which already has these tables and the real
 * owner's row.
 * @param {pg.PoolClient} client
 */
async function ensureNewsroomSchema(client) {
  await client.query(`
    create table if not exists newsrooms (
      id serial primary key,
      name text not null,
      created_at timestamptz not null default now()
    )
  `);
  await client.query(`
    insert into newsrooms (id, name)
    values (1, 'TownReporter Longmont')
    on conflict (id) do nothing
  `);
  await client.query(`
    create table if not exists newsroom_members (
      user_id text primary key,
      role text not null,
      newsroom_id integer not null default 1,
      created_at timestamptz not null default now()
    )
  `);
  await client.query(`alter table newsroom_members add column if not exists newsroom_id integer not null default 1`);
}

/**
 * Does the actual writing, against an already-connected client. Split out
 * from `main()` so tests (and the verification run) can call it directly.
 * @param {pg.PoolClient} client
 * @returns {Promise<{ userId: string; created: boolean; role: string }>}
 */
export async function upsertStagingEditor(client) {
  for (const table of ["user", "account"]) {
    const { rows } = await client.query(
      `select to_regclass('public."${table}"') as reg`,
    );
    if (!rows[0]?.reg) {
      throw new Error(
        `Table "${table}" does not exist in this database. Expected the Better ` +
          `Auth schema (migrations/0001_auth.sql) to already be present from the ` +
          `restored backup.`,
      );
    }
  }

  await ensureNewsroomSchema(client);

  const passwordHash = await hashPassword(STAGING_PASSWORD);
  const now = new Date();

  // --- "user" row: upsert on email (the real unique constraint), so a
  // pre-existing row (from a prior run of this script) keeps ITS id instead
  // of forking a duplicate under a different one.
  const userResult = await client.query(
    `
      insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values ($1, $2, $3, true, $4, $4)
      on conflict (email) do update set
        name = excluded.name,
        "emailVerified" = true,
        "updatedAt" = excluded."updatedAt"
      returning id, ("createdAt" = "updatedAt") as just_created
    `,
    [STAGING_USER_ID, "Staging Editor", STAGING_EMAIL, now],
  );
  const userId = userResult.rows[0].id;
  const created = userResult.rows[0].just_created === true;

  // --- "account" row (Better Auth's email/password credential row). No
  // unique constraint covers (userId, providerId), so upsert by hand: update
  // if a credential account already exists for this user, insert otherwise.
  const existingAccount = await client.query(
    `select id from "account" where "userId" = $1 and "providerId" = 'credential' limit 1`,
    [userId],
  );
  if (existingAccount.rows[0]) {
    await client.query(
      `update "account" set password = $1, "updatedAt" = $2 where id = $3`,
      [passwordHash, now, existingAccount.rows[0].id],
    );
  } else {
    await client.query(
      `
        insert into "account"
          (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        values ($1, $2, 'credential', $2, $3, $4, $4)
      `,
      [`${userId}-credential`, userId, passwordHash, now],
    );
  }

  // --- newsroom_members row: editor, never owner (see module doc comment).
  await client.query(
    `
      insert into newsroom_members (user_id, role, newsroom_id)
      values ($1, 'editor', $2)
      on conflict (user_id) do update set role = 'editor', newsroom_id = excluded.newsroom_id
    `,
    [userId, STAGING_NEWSROOM_ID],
  );

  return { userId, created, role: "editor" };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const guard = assertStagingDatabase(databaseUrl);
  if (!guard.ok) {
    console.error(`[stage-editor] refusing: ${guard.reason}`);
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const { userId, created, role } = await upsertStagingEditor(client);
    console.log(
      `[stage-editor] ${created ? "created" : "updated"} staging editor ` +
        `(user id ${userId}, role ${role}) in ${STAGING_DB_NAME}`,
    );
    console.log(`[stage-editor] "user" row: id=${userId} email=${STAGING_EMAIL}`);
    console.log(`[stage-editor] "account" row: providerId=credential, userId=${userId}`);
    console.log(`[stage-editor] newsroom_members row: user_id=${userId} role=editor newsroom_id=${STAGING_NEWSROOM_ID}`);
    console.log("");
    console.log("[stage-editor] sign in at the staged server with:");
    console.log(`[stage-editor]   email:    ${STAGING_EMAIL}`);
    console.log(`[stage-editor]   password: ${STAGING_PASSWORD}`);
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run when invoked directly (`node scripts/stage-editor.mjs`), not when
// imported for its exports (tests import `assertStagingDatabase` and
// `upsertStagingEditor` directly). Windows paths make a strict
// `import.meta.url === file://<argv[1]>` comparison fragile (drive-letter
// casing, slash direction), so match on the basename instead.
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("/scripts/stage-editor.mjs")
  || process.argv[1] === "scripts/stage-editor.mjs"
  || process.argv[1] === "stage-editor.mjs";
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[stage-editor] failed:", err?.message || err);
    process.exit(1);
  });
}
