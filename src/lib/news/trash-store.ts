import type { Sql } from "../db.ts";

/**
 * Taking a copy of something before it is deleted, and putting it back.
 *
 * Split from `trash.ts` (which holds the server functions) so the parts that
 * only touch the database can be tested under `node --test`, which has no path
 * aliases and cannot load `@tanstack/react-start`.
 */

/** How long a deleted thing waits before it is really gone. */
export const TRASH_DAYS = 30;

export type TrashKind = "lead" | "draft" | "article";

export type TrashRow = {
  id: number;
  kind: TrashKind;
  ref_id: number;
  label: string;
  deleted_at: string;
  /** What restoring it would bring back besides the row itself. */
  extra: string;
};

export type Snapshot = {
  row: Record<string, unknown>;
  drafts?: Record<string, unknown>[];
  corrections?: Record<string, unknown>[];
  extras?: Record<string, unknown> | null;
  /**
   * The Opinion desk rows that pointed at this draft.
   *
   * `editorial_requests.draft_id` is a plain integer with no foreign key, and
   * deleting the draft nulls it. Restoring the draft alone put the piece back
   * in the database and left it invisible on the desk, because that list is
   * driven by the pointer, not by the draft. Caught by clicking Undo and
   * watching the piece not come back.
   */
  requestIds?: number[];
};

/** One row, as JSON, or null when it is not there. */
async function rowAsJson(
  sql: Sql,
  table: "leads" | "drafts" | "articles" | "editorial_extras",
  where: string,
  value: number,
): Promise<Record<string, unknown> | null> {
  /*
    A missing table is a real state, not a failure. `editorial_extras` is
    created by `ensureEditorialSchema()` on first use, not by a migration, so on
    a newsroom that has never written an editorial it does not exist — and a
    delete must not throw because the side table for a thing that never
    happened is absent.
  */
  const rows = await sql
    .query<{ row: Record<string, unknown> }>(
      `select to_jsonb(t) as row from ${table} t where t.${where} = $1 limit 1`,
      [value],
    )
    .catch(() => []);
  return rows[0]?.row ?? null;
}

async function rowsAsJson(
  sql: Sql,
  table: "drafts" | "corrections",
  where: string,
  value: number,
): Promise<Record<string, unknown>[]> {
  const rows = await sql
    .query<{ row: Record<string, unknown> }>(
      `select to_jsonb(t) as row from ${table} t where t.${where} = $1`,
      [value],
    )
    .catch(() => []);
  return rows.map((r) => r.row);
}

/**
 * Put a row back exactly as it was, id included.
 *
 * The id matters: an article's corrections point at it, an editorial request
 * points at its draft. Serial sequences only ever move forward, so the id it
 * had was never handed to anything else while it sat in the trash.
 *
 * Column names come from the snapshot, which came from the database — but they
 * are still checked against the live table before they reach the statement,
 * because a name from a JSON blob has no business being concatenated into SQL
 * on trust alone. A column the table no longer has is dropped rather than
 * failing the whole restore.
 */
export async function reinsert(sql: Sql, table: string, row: Record<string, unknown>): Promise<void> {
  const live = await sql.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = $1`,
    [table],
  );
  const allowed = new Set(live.map((c) => c.column_name));
  const cols = Object.keys(row).filter((c) => allowed.has(c));
  if (!cols.length) return;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  await sql.query(
    `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${placeholders})
     on conflict do nothing`,
    cols.map((c) => row[c]),
  );
}

/** Keep a copy, then let the caller delete the original. */
export async function keepACopy(input: {
  sql: Sql;
  newsroomId: number;
  userId: string;
  kind: TrashKind;
  refId: number;
  label: string;
  snapshot: Snapshot;
}): Promise<number> {
  const rows = await input.sql<{ id: number }>`
    insert into deleted_items (newsroom_id, kind, ref_id, label, payload, deleted_by)
    values (${input.newsroomId}, ${input.kind}, ${input.refId},
            ${input.label.slice(0, 200)}, ${JSON.stringify(input.snapshot)}, ${input.userId})
    returning id
  `;
  return rows[0]!.id;
}

/** Everything a lead takes with it. */
export async function snapshotLead(sql: Sql, leadId: number): Promise<Snapshot | null> {
  const row = await rowAsJson(sql, "leads", "id", leadId);
  if (!row) return null;
  return { row, drafts: await rowsAsJson(sql, "drafts", "lead_id", leadId) };
}

/** An article and the corrections that hang off it. */
export async function snapshotArticle(sql: Sql, articleId: number): Promise<Snapshot | null> {
  const row = await rowAsJson(sql, "articles", "id", articleId);
  if (!row) return null;
  return { row, corrections: await rowsAsJson(sql, "corrections", "article_id", articleId) };
}

/** An editorial draft, the desk-only material beside it, and who pointed at it. */
export async function snapshotDraft(sql: Sql, draftId: number): Promise<Snapshot | null> {
  const row = await rowAsJson(sql, "drafts", "id", draftId);
  if (!row) return null;
  // Taken before the delete, which is the only moment the pointers still exist.
  const requests = await sql
    .query<{ id: number }>(`select id from editorial_requests where draft_id = $1`, [draftId])
    .catch(() => []);
  return {
    row,
    extras: await rowAsJson(sql, "editorial_extras", "draft_id", draftId),
    requestIds: requests.map((r) => r.id),
  };
}

/**
 * Point the Opinion desk back at a restored draft.
 *
 * Separate from `reinsert` because this is an update to a row that never went
 * away, not a row coming back.
 */
export async function repointRequests(
  sql: Sql,
  draftId: number,
  requestIds: number[],
): Promise<void> {
  for (const id of requestIds) {
    await sql
      .query(`update editorial_requests set draft_id = $1, error = null where id = $2`, [
        draftId,
        id,
      ])
      .catch(() => undefined);
  }
}

/**
 * One sweep tick can remove at most this many rows.
 *
 * The sweep runs unattended, every five minutes, off a server clock nobody is
 * watching. If that clock ever jumped forward — a bad NTP sync, a VM host
 * hiccup, a manual `Set-Date` slip — a single unbounded DELETE would treat
 * everything as overdue and empty the table in one tick, with no chance to
 * notice before it was gone. Capping the batch turns that failure mode into
 * "the operator has a few extra minutes to notice a suspiciously large purge
 * count in the audit log," instead of "everything from every newsroom is
 * gone before anyone could react." A clock that is merely slow just delays
 * expiry, which is the safe direction and needs no guard.
 */
const PURGE_BATCH_LIMIT = 500;

/**
 * Sweep every newsroom's trash past the window, not just the one whose list
 * happens to be open.
 *
 * This is the fix for ENG-106: the only DELETE that ever ran against
 * `deleted_items` was a side effect of `listTrash` (see `trash.ts`), which
 * means a desk that never opens the Trash panel keeps every deleted lead,
 * draft and article forever, and all of it rides into every backup taken
 * meanwhile. Called from the five-minute cron tick (`monitors-cron.ts`),
 * which already exists, already fails closed without `CRON_SECRET`, and
 * already isolates one failing step from the rest — reusing it means there
 * is no *second* scheduled task for the next audit to find missing.
 *
 * Deliberately newsroom-independent: a per-newsroom `WHERE` clause would
 * require enumerating newsrooms here and would silently stop expiring a
 * newsroom added after this was written.
 *
 * A single `DELETE ... RETURNING` is one statement, so Postgres runs it in
 * one implicit transaction: if the process dies mid-sweep the database still
 * has either all of this batch's rows gone or none of them, never half. What
 * this can NOT protect against is a migration that renames or drops a column
 * this statement depends on — that turns into a thrown error, which is
 * deliberately NOT swallowed here (contrast the lazy purge in `trash.ts`,
 * which is best-effort because it rides along on a page load). The caller
 * logs a thrown error to `audit_events` so a broken sweep is visible to
 * whoever looks, rather than disappearing the way this bug did originally.
 */
export async function purgeAllOldTrash(sql: Sql): Promise<number> {
  const gone = await sql<{ id: number }>`
    delete from deleted_items
    where id in (
      select id from deleted_items
      where deleted_at < now() - make_interval(days => ${TRASH_DAYS})
      order by deleted_at asc
      limit ${PURGE_BATCH_LIMIT}
    )
    returning id
  `;
  return gone.length;
}

/**
 * Take the Opinion desk's record away with a purged editorial.
 *
 * An editorial draft is pointed at by the `editorial_requests` row that asked
 * for it. Deleting the draft nulls that pointer -- this snapshot keeps the ids
 * so `repointRequests` can put them back on a restore -- but PURGING meant the
 * writing was gone for good while the request stayed on the Opinion desk,
 * showing a subject and a finished time with no piece and no error. It read as
 * work still running that had actually been thrown away on purpose, and the
 * desk's Delete was keyed on the draft, so it could not be removed at all.
 *
 * Found on the live paper: an editorial purged at 10:44 one morning left a row
 * that could not be cleared for the rest of the day.
 *
 * Only rows whose pointer is already null are removed, so a request that has
 * since been repointed at a live draft is never touched.
 */
export async function forgetPurgedRequests(
  sql: Sql,
  newsroomId: number,
  requestIds: readonly number[],
): Promise<number> {
  const ids = requestIds.filter((n) => Number.isFinite(n));
  if (!ids.length) return 0;
  const gone = await sql<{ id: number }>`
    delete from editorial_requests
    where id = any(${ids}) and newsroom_id = ${newsroomId} and draft_id is null
    returning id
  `;
  return gone.length;
}
