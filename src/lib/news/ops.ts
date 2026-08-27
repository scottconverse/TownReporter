import { getSql } from "@/lib/db";

const HOURLY: Record<string, number> = {
  scan: 10,
  draft: 20,
  dark: 8,
  pull: 40,
};

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
  const rows = await sql<{ c: number }>`
    select count(*)::int as c from desk_rate
    where user_id = ${userId} and action = ${action}
      and created_at > now() - interval '1 hour'
  `;
  if ((rows[0]?.c ?? 0) >= cap) {
    throw new Error(`Rate limit: ${action} is capped at ${cap} per hour.`);
  }
  await sql`
    insert into desk_rate (user_id, action) values (${userId}, ${action})
  `;
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
