import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
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
  // migrations/0005_ops.sql names this index `desk_rate_lookup`; this list
  // used to create the identical index under the name `desk_rate_window_idx`,
  // so a runtime-created database carried an index the migrated one did not
  // (and lacked the migrated name). Same columns, same order, same `desc` --
  // only the name differed. Create the migrations' name first, then drop the
  // old one, so a database never goes without a covering index in between.
  `create index if not exists desk_rate_lookup on desk_rate (user_id, action, created_at desc)`,
  `drop index if exists desk_rate_window_idx`,
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
/** `desk_rate`, once per database. See `assertRate` and `DESK_RATE_SCHEMA` above. */
export async function ensureDeskRateSchema(): Promise<void> {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "desk-rate", DESK_RATE_SCHEMA);
}

export async function assertRate(
  userId: string,
  action: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
) {
  const cap = HOURLY[action] ?? 20;
  const sql = await getSql();
  await ensureDeskRateSchema();
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

/**
 * Refuse a repeat of `action` on `key` inside `seconds`, or record it (unit
 * U24b).
 *
 * WHY THIS IS NOT `assertRate`. `assertRate` bounds an HOURLY BUDGET for a
 * thing that costs money -- a scan, a model round, a login attempt -- and its
 * window is fixed at an hour with the cap coming from a table. What a source
 * row's "Retry" needs is the other shape: a short, fixed pause so one press
 * cannot be mashed into a burst of requests at somebody else's web server. A
 * minute-long budget would be no protection at all; an hour would be useless
 * to the editor who is trying to fix a source.
 *
 * The row lives in the same `desk_rate` table, because that is where "this
 * person did this thing at this time" already lives. The key is per EDITOR and
 * per action (`check-source:<id>`), which is both what a spam guard is for --
 * one editor pressing Retry over and over -- and what the table's
 * `desk_rate_lookup (user_id, action, created_at desc)` index can serve. Two
 * editors checking the same source a second apart is not a burst, and is not
 * refused.
 *
 * The attempt is recorded only when it is allowed, so a refused press does not
 * extend its own window.
 */
export async function assertCooldown(
  userId: string,
  action: string,
  seconds: number,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<void> {
  const sql = await getSql();
  await ensureDeskRateSchema();
  const [last] = await sql<{ at: string | Date }>`
    select created_at as at from desk_rate
    where user_id = ${userId} and action = ${action}
    order by created_at desc limit 1
  `;
  if (last) {
    const ageMs = Date.now() - new Date(last.at).getTime();
    if (Number.isFinite(ageMs) && ageMs < seconds * 1000) {
      const wait = Math.max(1, Math.ceil((seconds * 1000 - ageMs) / 1000));
      throw new Error(`That was checked a moment ago. Try again in ${wait}s.`);
    }
  }
  await sql`
    insert into desk_rate (user_id, action, newsroom_id) values (${userId}, ${action}, ${newsroomId})
  `;
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

/** `audit_events`, once per database. See `audit` and `AUDIT_EVENTS_SCHEMA` above. */
export async function ensureAuditEventsSchema(): Promise<void> {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "audit-events", AUDIT_EVENTS_SCHEMA);
}

export async function audit(
  userId: string,
  action: string,
  detail: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  subject?: { kind: string; id: number },
) {
  const sql = await getSql();
  await ensureAuditEventsSchema();
  await auditWithSql(sql, userId, action, detail, newsroomId, subject);
}

/**
 * `audit()`, writing through a caller-supplied `Sql` -- for a caller that is
 * already inside a transaction and needs the event to commit, or roll back,
 * with the rest of its work (Unit CR, 0.6.81: redeeming a recovery code).
 * `audit()` itself cannot join such a transaction: it resolves its own
 * `getSql()`, which on the PGlite backend is a different connection, so its
 * insert would survive a rollback of the caller's. Callers using this must
 * have ensured the schema themselves (`ensureAuditEventsSchema()`), which
 * cannot run inside the transaction -- it is DDL.
 */
export async function auditWithSql(
  sql: Sql,
  userId: string,
  action: string,
  detail: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  subject?: { kind: string; id: number },
) {
  await sql`
    insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
    values (${userId}, ${action}, ${detail.slice(0, 500)}, ${newsroomId}, ${subject?.kind ?? null}, ${subject?.id ?? null})
  `;
}
