import { ensureSchemaOnce, getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

const HOURLY: Record<string, number> = {
  scan: 10,
  draft: 20,
  dark: 8,
  pull: 40,
  // Restarts and rebuilds. Cheap to ask for, expensive to repeat, and a stuck
  // finger on a restart button should not be able to hold the paper down.
  "ops-action": 30,
  // Reddit's budget, not ours: ~10 requests a minute per IP, shared with
  // everything else on this machine. Three feeds a run, a few runs an hour.
  reddit: 6,
  // One model call, and an editor may reasonably re-read a file.
  brief: 40,
  // Fifteen minutes and a few dollars each. A slip of the finger should not
  // start six of them.
  editorial: 6,
  // Each one spawns a CLI that holds a loopback listener until it is answered
  // or times out. A page left open on a broken machine must not be able to
  // start a queue of them.
  "provider-login": 10,
  // One tiny real model call each. Cheap, but it is still spending.
  "provider-test": 20,
};

/**
 * `desk_rate` and the index and the column that `0012` added later, in the
 * order they were run before this list existed. Every one of the three used to
 * be issued on every desk action -- including the two `alter`s, which take
 * ACCESS EXCLUSIVE and so queue behind the nightly `pg_dump`. They now run
 * once per database: see `ensureSchemaOnce` in `src/lib/db.ts` and
 * `paper-settings-read-lock.test.ts`.
 */
const DESK_RATE_SCHEMA = [
  `
    create table if not exists desk_rate (
      id serial primary key,
      user_id text not null,
      action text not null,
      created_at timestamptz not null default now()
    )
  `,
  `
    create index if not exists desk_rate_window_idx
      on desk_rate (user_id, action, created_at desc)
  `,
  // Mirrors migrations/0012_newsroom_appliance.sql -- was missing from this
  // ensure list (GauntletGate ENG-03).
  `alter table desk_rate add column if not exists newsroom_id integer not null default 1`,
];

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
export async function assertRate(
  userId: string,
  action: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const cap = HOURLY[action] ?? 20;
  const sql = await getSql();
  await ensureSchemaOnce(sql, "desk-rate", DESK_RATE_SCHEMA);
  await sql`
    insert into desk_rate (user_id, action, newsroom_id) values (${userId}, ${action}, ${newsroomId})
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

/** `audit_events` as `audit()` needs it: 0005, then 0012's column, then the two subject columns. */
const AUDIT_EVENTS_SCHEMA = [
  `
    create table if not exists audit_events (
      id serial primary key,
      user_id text not null,
      action text not null,
      detail text not null default '',
      created_at timestamptz not null default now()
    )
  `,
  // Mirrors migrations/0012_newsroom_appliance.sql -- was missing from this
  // ensure list (GauntletGate ENG-03).
  `alter table audit_events add column if not exists newsroom_id integer not null default 1`,
  "alter table audit_events add column if not exists subject_kind text",
  "alter table audit_events add column if not exists subject_id integer",
];

export async function audit(
  userId: string,
  action: string,
  detail: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  subject?: { kind: string; id: number },
) {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "audit-events", AUDIT_EVENTS_SCHEMA);
  await sql`
    insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
    values (${userId}, ${action}, ${detail.slice(0, 500)}, ${newsroomId}, ${subject?.kind ?? null}, ${subject?.id ?? null})
  `;
}
