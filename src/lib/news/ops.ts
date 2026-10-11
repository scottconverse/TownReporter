import { ensureSchemaOnce, getSql, type Sql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { editorWarning, type EditorWarningResult } from "./editor-override.ts";

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
  // Insert-before-count keeps the ceiling safe under a concurrent burst (see
  // above). But a REJECTED attempt must not leave the row it just inserted
  // behind: the row would count against the editor's own budget, so a held-down
  // Reddit button could burn the whole hour's allowance in rejected presses. The
  // insert is undone on the over-cap path, so only runs that proceed consume it.
  const [row] = await sql<{ id: number }>`
    insert into desk_rate (user_id, action, newsroom_id)
    values (${userId}, ${action}, ${newsroomId})
    returning id
  `;
  const rows = await sql<{ c: number }>`
    select count(*)::int as c from desk_rate
    where user_id = ${userId} and action = ${action}
      and created_at > now() - interval '1 hour'
  `;
  if ((rows[0]?.c ?? 0) > cap) {
    if (row) await sql`delete from desk_rate where id = ${row.id}`;
    throw new Error(`Rate limit: ${action} is capped at ${cap} per hour.`);
  }
}

/**
 * The hourly cap, as a WARNING rather than a throw (item 25, Scott's rule).
 *
 * `checkRate` is `assertRate`'s shape for the scoped desk actions -- a scan, a
 * draft, a Dark run, a pull, a brief -- with two differences that matter for a
 * rule that says "warn, never block":
 *
 *   - at the cap it returns the structured warning instead of throwing, so the
 *     UI can offer the second press;
 *   - it records a unit ONLY when the action will run. A refused press inserts
 *     nothing (so it does not extend its own hour), and the second press, its
 *     `override` naming `rate:<action>` exactly, records the unit and the audit
 *     and returns null.
 *
 * `assertRate` stays a hard throw for the unscoped consumers (reporting, Dark's
 * own Reddit fetch, provider login/test, ops actions): those have no editor
 * press to second-guess, and Reddit's budget is the provider's, not ours.
 */
export async function checkRate(
  userId: string,
  action: string,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  override?: readonly string[],
  options: { amount?: number; record?: boolean } = {},
): Promise<EditorWarningResult | null> {
  const sql = await getSql();
  await ensureDeskRateSchema();
  const [rows] = await sql<{ c: number }>`
    select count(*)::int as c from desk_rate
    where user_id = ${userId} and action = ${action} and newsroom_id = ${newsroomId}
      and created_at > now() - interval '1 hour'
  `;
  const cap = HOURLY[action] ?? 20;
  const used = rows?.c ?? 0;
  const amount = options.amount ?? 1;
  if (used + amount > cap) {
    const sentence = `You have run ${action} ${used} times this hour; the cap is ${cap}. It may cost more.`;
    const warning = await editorWarning(
      { userId, newsroomId },
      override,
      `rate-${action}`,
      sentence,
      { kind: `rate:${action}`, id: newsroomId },
    );
    if (warning) return warning;
  }
  if (options.record !== false) await sql`
    insert into desk_rate (user_id, action, newsroom_id) values (${userId}, ${action}, ${newsroomId})
  `;
  return null;
}

/**
 * The source "Check now" cooldown, as a WARNING rather than a throw (item 26).
 * Same shape as `checkRate`: it records the attempt only when it runs, so a
 * refused press does not extend its own window; the second press, `override`
 * naming `source-check-cooldown`, records the attempt and the audit.
 */
export async function checkCooldown(
  userId: string,
  action: string,
  seconds: number,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
  override?: readonly string[],
): Promise<EditorWarningResult | null> {
  const sql = await getSql();
  await ensureDeskRateSchema();
  const [last] = await sql<{ at: string | Date }>`
    select created_at as at from desk_rate
    where user_id = ${userId} and action = ${action} and newsroom_id = ${newsroomId}
    order by created_at desc limit 1
  `;
  if (last) {
    const ageMs = Date.now() - new Date(last.at).getTime();
    if (Number.isFinite(ageMs) && ageMs < seconds * 1000) {
      const wait = Math.max(1, Math.ceil((seconds * 1000 - ageMs) / 1000));
      const warning = await editorWarning(
        { userId, newsroomId },
        override,
        "source-check-cooldown",
        `That was checked a moment ago. Try again in ${wait}s.`,
        { kind: `cooldown:${action}`, id: newsroomId },
      );
      if (warning) return warning;
    }
  }
  await sql`
    insert into desk_rate (user_id, action, newsroom_id) values (${userId}, ${action}, ${newsroomId})
  `;
  return null;
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

/**
 * `audit_events`, once per database. See `audit` and `AUDIT_EVENTS_SCHEMA`.
 *
 * Accepts an optional handle. A full `Sql` (the desk's `getSql()`, a
 * transaction) is ensured directly. A tag-only `SqlTag` -- the shape
 * `lead-lifecycle.ts` and its PGlite tests pass around, which has no `.query()`
 * for the DDL batch to run through -- is left alone: such a caller owns its
 * schema, and the audit write it then makes is a plain insert the tag can
 * carry.
 */
export async function ensureAuditEventsSchema(sql?: AuditSqlTag): Promise<void> {
  const handle = (sql ?? (await getSql())) as unknown as Sql;
  if (typeof (handle as { query?: unknown }).query !== "function") return;
  await ensureSchemaOnce(handle, "audit-events", AUDIT_EVENTS_SCHEMA);
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
 * The tagged-template half of a SQL handle, satisfied by both `Sql` (which also
 * has `.query()`) and the lighter `SqlTag` that `lead-lifecycle.ts` and its
 * tests pass around. Anything that only issues parameterized statements --
 * `auditWithSql`, the override write -- needs no more than this.
 */
export interface AuditSqlTag {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
}

/**
 * `audit()`, writing through a caller-supplied handle -- for a caller that is
 * already inside a transaction and needs the event to commit, or roll back,
 * with the rest of its work (Unit CR, 0.6.81: redeeming a recovery code), or
 * for a caller that holds only a tagged-template handle (`SqlTag`).
 * `audit()` itself cannot join such a transaction: it resolves its own
 * `getSql()`, which on the PGlite backend is a different connection, so its
 * insert would survive a rollback of the caller's. Callers using this must
 * have ensured the schema themselves (`ensureAuditEventsSchema()`), which
 * cannot run inside the transaction -- it is DDL.
 */
export async function auditWithSql(
  sql: AuditSqlTag,
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

/** Record admitted work after enqueue succeeds; warning presses never spend a unit. */
export async function recordDeskRun(userId: string, action: string, newsroomId: number) {
  await ensureDeskRateSchema();
  await (await getSql()).query("insert into desk_rate(user_id,action,newsroom_id) values($1,$2,$3)", [userId, action, newsroomId]);
}
