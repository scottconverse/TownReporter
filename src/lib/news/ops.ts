import { getSql } from "@/lib/db";

const HOURLY: Record<string, number> = {
  scan: 10,
  draft: 20,
  dark: 8,
  pull: 40,
};

/**
 * Spend one unit of the hourly budget for `action`, or throw.
 *
 * Records the attempt BEFORE counting. The old order — count, decide, then
 * insert — let two concurrent requests both read `count = cap - 1` and both
 * proceed, so a double-clicked "Run scan" (or any retry) overran the cap that
 * exists to bound model spend. Counting our own row means concurrent callers
 * all see each other; at the boundary that can reject a request one early,
 * which is the safe direction for a cost ceiling.
 */
export async function assertRate(userId: string, action: string) {
  const cap = HOURLY[action] ?? 20;
  const sql = await getSql();
  await sql.query(`
    create table if not exists desk_rate (
      id serial primary key,
      user_id text not null,
      action text not null,
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create index if not exists desk_rate_window_idx
      on desk_rate (user_id, action, created_at desc)
  `);
  await sql`
    insert into desk_rate (user_id, action) values (${userId}, ${action})
  `;
  const rows = await sql<{ c: number }>`
    select count(*)::int as c from desk_rate
    where user_id = ${userId} and action = ${action}
      and created_at > now() - interval '1 hour'
  `;
  if ((rows[0]?.c ?? 0) > cap) {
    throw new Error(`Rate limit: ${action} is capped at ${cap} per hour.`);
  }
}

export async function audit(
  userId: string,
  action: string,
  detail: string,
) {
  const sql = await getSql();
  await sql.query(`
    create table if not exists audit_events (
      id serial primary key,
      user_id text not null,
      action text not null,
      detail text not null default '',
      created_at timestamptz not null default now()
    )
  `);
  await sql`
    insert into audit_events (user_id, action, detail)
    values (${userId}, ${action}, ${detail.slice(0, 500)})
  `;
}
