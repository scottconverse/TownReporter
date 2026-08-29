import type { Sql } from "../db.ts";

/**
 * Taking a copy of something before it is deleted, and putting it back.
 *
 * Split from `trash.ts` (which holds the server functions) so the parts that
 * only touch the database can be tested under `node --test`, which has no path
 * aliases and cannot load `@tanstack/react-start`.
 */

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

/** An editorial draft and the desk-only material beside it. */
export async function snapshotDraft(sql: Sql, draftId: number): Promise<Snapshot | null> {
  const row = await rowAsJson(sql, "drafts", "id", draftId);
  if (!row) return null;
  return { row, extras: await rowAsJson(sql, "editorial_extras", "draft_id", draftId) };
}

