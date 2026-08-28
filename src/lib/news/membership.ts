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

export class SetupRequiredError extends Error {
  readonly status = 403;
  constructor() {
    super(
      "This desk is not claimed. Set NEWSROOM_SETUP_TOKEN and pass it when creating the first editor.",
    );
    this.name = "SetupRequiredError";
  }
}

export type EditorRole = "owner" | "editor";

export type EditorContext = {
  role: EditorRole;
  newsroomId: number;
};

export function newsroomSetupToken(): string {
  return (process.env.NEWSROOM_SETUP_TOKEN ?? process.env.SETUP_TOKEN ?? "").trim();
}

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
  const n = await sql<{ c: number }>`select count(*)::int as c from newsroom_members`;
  if ((n[0]?.c ?? 0) === 0) {
    if (newsroomSetupToken()) {
      throw new SetupRequiredError();
    }
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
  const n = await sql<{ c: number }>`select count(*)::int as c from newsroom_members`;
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
  const mine = await sql<{ role: string }>`
    select role from newsroom_members where user_id = ${userId} limit 1
  `;
  if (!mine[0] || (mine[0].role !== "owner" && mine[0].role !== "editor")) {
    throw new ForbiddenError();
  }
  await sql`delete from newsroom_members`;
}

/**
 * Claim an unclaimed desk with the operator's setup token.
 * Preview (no token in env) still uses requireEditor's first-user-owns path.
 * When NEWSROOM_SETUP_TOKEN is set, the token must match.
 */
export async function claimOwner(userId: string, providedToken: string): Promise<EditorContext> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const mine = await sql<{ role: string; newsroom_id: number }>`
    select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
  `;
  if (mine[0]?.role === "owner" || mine[0]?.role === "editor") {
    return { role: mine[0].role, newsroomId: mine[0].newsroom_id ?? DEFAULT_NEWSROOM_ID };
  }
  const n = await sql<{ c: number }>`select count(*)::int as c from newsroom_members`;
  if ((n[0]?.c ?? 0) > 0) throw new ForbiddenError();
  const expected = newsroomSetupToken();
  if (expected) {
    if (providedToken.trim() !== expected) throw new ForbiddenError("Setup token does not match.");
  } else {
    // Preview / local without a token: first-user-owns is requireEditor's job.
    if (!providedToken.trim()) throw new SetupRequiredError();
  }
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
