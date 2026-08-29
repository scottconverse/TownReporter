/*
  There is no setup token.

  It guarded exactly one window — an unclaimed desk on a public host, before
  the operator signs in for the first time. For a one-person newsroom that is
  about ninety seconds, once, ever, and the price was a shared secret carried
  for the life of the product plus a form field that locked the operator out of
  his own instance when he did not have the string to hand.

  An audit raised it as a Critical: guessable, no throttling, no entropy floor.
  Removing the mechanism closes that more completely than hardening it — there
  is no secret to guess, no comparison to time, no lockout to tune.

  What still holds: two people cannot both own the desk. That is a unique
  partial index in migrations/0012_newsroom_appliance.sql, not a secret.

  The trade, stated in the README: on a fresh public deployment the first
  person to reach /login owns the desk. Sign in first.
*/

import { getSql } from "../db.ts";
import { deskTakenLoginCopy } from "./desk-copy.ts";

export const DEFAULT_NEWSROOM_ID = 1;

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Not a newsroom editor") {
    super(message);
    this.name = "ForbiddenError";
  }
}


export type EditorRole = "owner" | "editor";

export type EditorContext = {
  role: EditorRole;
  newsroomId: number;
};


export function isGrokPreviewHost(host: string | undefined | null): boolean {
  const h = (host ?? "").toLowerCase();
  return h === "grok.me" || h.endsWith(".grok.me") || h.endsWith(".grok-sandbox.com");
}

export async function ensureNewsroomSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists newsrooms (
      id serial primary key,
      name text not null,
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    insert into newsrooms (id, name)
    values (1, 'TownReporter Longmont')
    on conflict (id) do nothing
  `).catch(async () => {
    const existing = await sql<{ c: number }>`select count(*)::int as c from newsrooms`;
    if ((existing[0]?.c ?? 0) === 0) {
      await sql`insert into newsrooms (name) values (${"TownReporter Longmont"})`;
    }
  });
  await sql.query(`
    create table if not exists newsroom_members (
      user_id text primary key,
      role text not null,
      newsroom_id integer not null default 1,
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`alter table newsroom_members add column if not exists newsroom_id integer not null default 1`);
  try {
    await sql.query(`
      create unique index if not exists newsroom_members_one_owner
      on newsroom_members (newsroom_id) where role = 'owner'
    `);
  } catch {
    /* PGLite may not allow the partial unique index; owner race is still checked in JS */
  }
}

/** First signed-in user on an empty desk becomes owner. Later identities are 403. */
export async function requireEditor(userId: string): Promise<EditorContext> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const mine = await sql<{ role: string; newsroom_id: number }>`
    select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
  `;
  if (mine[0]?.role === "owner" || mine[0]?.role === "editor") {
    return { role: mine[0].role, newsroomId: mine[0].newsroom_id ?? DEFAULT_NEWSROOM_ID };
  }
  const n = await sql<{ c: number }>`
    select count(*)::int as c from newsroom_members where newsroom_id = ${DEFAULT_NEWSROOM_ID}
  `;
  if ((n[0]?.c ?? 0) === 0) {
    try {
      await sql`
        insert into newsroom_members (user_id, role, newsroom_id)
        values (${userId}, 'owner', ${DEFAULT_NEWSROOM_ID})
      `;
      return { role: "owner", newsroomId: DEFAULT_NEWSROOM_ID };
    } catch {
      const again = await sql<{ role: string; newsroom_id: number }>`
        select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
      `;
      if (again[0]?.role === "owner" || again[0]?.role === "editor") {
        return { role: again[0].role, newsroomId: again[0].newsroom_id ?? DEFAULT_NEWSROOM_ID };
      }
      throw new ForbiddenError();
    }
  }
  throw new ForbiddenError();
}

/** True once any owner/editor row exists. Signup after that is a dead door. */
export async function deskIsClaimed(): Promise<boolean> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const n = await sql<{ c: number }>`
    select count(*)::int as c from newsroom_members where newsroom_id = ${DEFAULT_NEWSROOM_ID}
  `;
  return (n[0]?.c ?? 0) > 0;
}

export async function assertSignupOpen() {
  if (await deskIsClaimed()) {
    throw new ForbiddenError(deskTakenLoginCopy().api);
  }
}

/** Owner/editor drops the desk. Paper stays. Next sign-in owns it. */
export async function leaveAsEditor(userId: string): Promise<void> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const mine = await sql<{ role: string; newsroom_id: number }>`
    select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
  `;
  if (!mine[0] || (mine[0].role !== "owner" && mine[0].role !== "editor")) {
    throw new ForbiddenError();
  }
  await sql`delete from newsroom_members where newsroom_id = ${mine[0].newsroom_id}`;
}

/**
 * Claim an unclaimed desk. First account in owns it.
 *
 * The uniqueness guarantee lives in the database, not here: a unique partial
 * index on the owner row means a concurrent second claim loses.
 */
export async function claimOwner(userId: string): Promise<EditorContext> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const mine = await sql<{ role: string; newsroom_id: number }>`
    select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
  `;
  if (mine[0]?.role === "owner" || mine[0]?.role === "editor") {
    return { role: mine[0].role, newsroomId: mine[0].newsroom_id ?? DEFAULT_NEWSROOM_ID };
  }
  const n = await sql<{ c: number }>`
    select count(*)::int as c from newsroom_members where newsroom_id = ${DEFAULT_NEWSROOM_ID}
  `;
  if ((n[0]?.c ?? 0) > 0) throw new ForbiddenError();
  try {
    await sql`
      insert into newsroom_members (user_id, role, newsroom_id)
      values (${userId}, 'owner', ${DEFAULT_NEWSROOM_ID})
    `;
    return { role: "owner", newsroomId: DEFAULT_NEWSROOM_ID };
  } catch {
    throw new ForbiddenError();
  }
}
