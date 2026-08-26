import { getSql } from "@/lib/db";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super("Not a newsroom editor");
    this.name = "ForbiddenError";
  }
}

async function ensureMembersTable() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists newsroom_members (
      user_id text primary key,
      role text not null,
      created_at timestamptz not null default now()
    )
  `);
}

/** First signed-in user becomes owner. Everyone else must already be a member. */
export async function requireEditor(userId: string): Promise<"owner" | "editor"> {
  await ensureMembersTable();
  const sql = await getSql();
  const mine = await sql<{ role: string }>`
    select role from newsroom_members where user_id = ${userId} limit 1
  `;
  if (mine[0]?.role === "owner" || mine[0]?.role === "editor") {
    return mine[0].role;
  }
  const n = await sql<{ c: number }>`select count(*)::int as c from newsroom_members`;
  if ((n[0]?.c ?? 0) === 0) {
    await sql`
      insert into newsroom_members (user_id, role)
      values (${userId}, 'owner')
      on conflict (user_id) do nothing
    `;
    return "owner";
  }
  await sql`
    insert into newsroom_members (user_id, role)
    values (${userId}, 'editor')
    on conflict (user_id) do nothing
  `;
  return "editor";
}
