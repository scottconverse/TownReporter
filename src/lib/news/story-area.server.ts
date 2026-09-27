import { ensureSchemaOnce, getSql } from "../db.ts";

/**
 * Mirror migration 0098 for a database built by an `ensure*` helper rather than
 * by the migration files.
 *
 * Under `node --test` there is no Vite glob transform, so `getSql()` brings up
 * an empty PGLite and no migration is applied (see `db.ts`, the `catch` around
 * `import.meta.glob`). The public reader reads `articles.area`, so the read that
 * needs the column is the one that ensures it -- the same shape
 * `sections.server.ts` uses for the section tables.
 *
 * Column-for-column the migration's own DDL: one nullable text column and the
 * one partial index the pills read. `articles` is on
 * `schema-parity.test.ts`'s ALLOWLIST as a migrations-only table, so this
 * mirror is not diffed against the migration; it is here so a hand-built
 * database can read what the paper reads.
 */
export const STORY_AREA_SCHEMA = [
  `alter table articles add column if not exists area text`,
  `create index if not exists articles_area_published_idx
     on articles (newsroom_id, area, published_at desc)
     where status = 'published'`,
] as const;

export async function ensureStoryAreaSchema(): Promise<void> {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "story-area", STORY_AREA_SCHEMA);
}
