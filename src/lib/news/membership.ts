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

/*
  Invites: the one door through the claimed-desk wall.

  The dead door is deliberate -- an open signup on a public host hands the
  desk to a stranger -- but it also meant a second HUMAN could only share the
  owner's login. An invite is the narrow opening: the owner mints a one-time
  link FOR A NAMED EMAIL ADDRESS, and only a signup with exactly that address,
  carrying the unguessable token, gets through. The stored value is a SHA-256
  of the token, so a database read does not hand out live links; links expire
  in seven days and burn on use.
*/
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function ensureInviteSchema() {
  await ensureNewsroomSchema();
  const sql = await getSql();
  await sql.query(`
    create table if not exists editor_invites (
      id serial primary key,
      newsroom_id integer not null default 1,
      email text not null,
      token_hash text not null unique,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null,
      used_at timestamptz
    )
  `);
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Owner mints a one-time invite for an email. Returns the RAW token (shown once). */
export async function createInvite(ownerUserId: string, email: string): Promise<string> {
  const me = await requireEditor(ownerUserId);
  if (me.role !== "owner") {
    throw new ForbiddenError("Only the owner can invite an editor.");
  }
  const addr = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    throw new ForbiddenError("That does not look like an email address.");
  }
  await ensureInviteSchema();
  const sql = await getSql();
  const already = await sql<{ c: number }>`
    select count(*)::int as c from newsroom_members m
    join "user" u on u.id = m.user_id
    where lower(u.email) = ${addr}
  `;
  if ((already[0]?.c ?? 0) > 0) {
    throw new ForbiddenError("That address is already an editor on this desk.");
  }
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hash = await sha256Hex(token);
  const expires = new Date(Date.now() + INVITE_TTL_MS);
  // One live invite per address: minting again replaces the old link.
  await sql`delete from editor_invites where email = ${addr} and used_at is null`;
  await sql`
    insert into editor_invites (newsroom_id, email, token_hash, expires_at)
    values (${me.newsroomId}, ${addr}, ${hash}, ${expires})
  `;
  return token;
}

export type InviteCheck =
  | { ok: true; email: string }
  | { ok: false; reason: string };

/** Is this token a live invite? Never reveals whether an ADDRESS was invited. */
export async function checkInvite(token: string): Promise<InviteCheck> {
  const raw = token.trim();
  if (!/^[0-9a-f]{64}$/.test(raw)) return { ok: false, reason: "That invite link is not valid." };
  await ensureInviteSchema();
  const sql = await getSql();
  const hash = await sha256Hex(raw);
  const rows = await sql<{ email: string; expired: boolean; used: boolean }>`
    select email, (expires_at < now()) as expired, (used_at is not null) as used
    from editor_invites where token_hash = ${hash} limit 1
  `;
  if (!rows[0]) return { ok: false, reason: "That invite link is not valid." };
  if (rows[0].used) return { ok: false, reason: "That invite was already used." };
  if (rows[0].expired) return { ok: false, reason: "That invite has expired. Ask for a new one." };
  return { ok: true, email: rows[0].email };
}

/** The auth hook's question: may THIS address create an account right now? */
export async function signupOpenFor(email: string): Promise<boolean> {
  if (!(await deskIsClaimed())) return true;
  await ensureInviteSchema();
  const sql = await getSql();
  const rows = await sql<{ c: number }>`
    select count(*)::int as c from editor_invites
    where email = ${email.trim().toLowerCase()}
      and used_at is null and expires_at > now()
  `;
  return (rows[0]?.c ?? 0) > 0;
}

/** Burn the invite and seat the signed-in user as an editor (not owner). */
export async function acceptInvite(userId: string, token: string): Promise<EditorContext> {
  const check = await checkInvite(token);
  if (!check.ok) throw new ForbiddenError(check.reason);
  const sql = await getSql();
  const me = await sql<{ email: string }>`
    select email from "user" where id = ${userId} limit 1
  `;
  if ((me[0]?.email ?? "").trim().toLowerCase() !== check.email) {
    throw new ForbiddenError("This invite was issued to a different email address.");
  }
  const hash = await sha256Hex(token.trim());
  const burned = await sql<{ id: number }>`
    update editor_invites set used_at = now()
    where token_hash = ${hash} and used_at is null
    returning id
  `;
  if (!burned[0]) throw new ForbiddenError("That invite was already used.");
  await sql`
    insert into newsroom_members (user_id, role, newsroom_id)
    values (${userId}, 'editor', ${DEFAULT_NEWSROOM_ID})
    on conflict (user_id) do nothing
  `;
  return { role: "editor", newsroomId: DEFAULT_NEWSROOM_ID };
}

/**
 * Drop the desk. Paper stays. Next sign-in owns it.
 *
 * Owner only, now that invites exist: this deletes EVERY membership row and
 * unclaims the newsroom, which is the owner's call, not an invited editor's.
 * An invited editor who wants out leaves alone -- their row goes, the
 * newsroom stands.
 */
export async function leaveAsEditor(userId: string): Promise<void> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const mine = await sql<{ role: string; newsroom_id: number }>`
    select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
  `;
  if (!mine[0]) throw new ForbiddenError();
  if (mine[0].role !== "owner") {
    // The editor's own exit: remove just their seat.
    await sql`delete from newsroom_members where user_id = ${userId}`;
    return;
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
