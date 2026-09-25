import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { isOnboarded } from "./paper-settings.ts";
import { resolveSectionKey } from "./sections.server.ts";
import { stripReporterNotebook } from "./strip-draft.ts";
import { unpackStoredDraft } from "./coerce-draft.ts";
import {
  MAX_BATCH,
  PAGE_SIZE,
  type ReaderArticlesInput,
  type ReaderPage,
} from "./reader-articles.ts";
import type { ReaderStory } from "../reader.ts";

/**
 * The public reader query, as a plain function so a `node --test` file can
 * drive it directly -- a `createServerFn` cannot be called outside the server
 * runtime ("No Start context found in AsyncStorage"). `readerArticles` in
 * `reader-public.ts` is the thin wrapper a route goes through.
 *
 * This file reaches the database and a `.server.*` module, so nothing that is
 * bundled for the browser may import it: the server function's handler is the
 * only caller, and the bundler drops its imports with the handler.
 */
export async function listReaderArticles(data: ReaderArticlesInput): Promise<ReaderPage> {
  if (!(await isOnboarded(DEFAULT_NEWSROOM_ID)))
    return { stories: [], total: 0, pageSize: PAGE_SIZE, hasMore: false, nextCursor: null };
  const sql = await getSql();
  const page = data.page ?? 1;
  const oldest = data.oldest ?? false;
  const topic = data.topic ? await resolveSectionKey(DEFAULT_NEWSROOM_ID, data.topic) : "";
  const q = data.q || "";
  // Treat punctuation literally. Short searches stay on headline and dek.
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const saved = JSON.stringify(data.saved ?? []);
  /* A cursor read is the river: newest first, below a cursor, at most one batch. */
  const river = data.cursor !== undefined || data.exclude !== undefined || data.limit !== undefined;
  const batch = Math.min(data.limit ?? PAGE_SIZE, MAX_BATCH);
  /*
    The guarded OR does NOT let Postgres skip the other side, so the values on
    the unused side still have to be legal operands. `''::timestamptz` would
    raise, so an absent cursor compares against 1970 (older than every story,
    and `articles.published_at` is NOT NULL, so the tuple comparison is a total
    order); an absent exclusion is the empty array, the same idiom `saved` uses.

    `after` is Postgres's own text for the column it came from. The column
    itself parses to a JavaScript Date, which drops microseconds: a cursor
    rounded to whole milliseconds is `>` the row 400 µs behind it, and that row
    is silently dropped from the paper. Transport the server's text, never a
    Date.
  */
  const after = data.cursor?.publishedAt ?? "1970-01-01T00:00:00Z";
  const afterId = data.cursor?.id ?? 0;
  const exclude = JSON.stringify(data.exclude ?? []);
  /*
    The count and the rows share one predicate list, added to together: the
    count is "how many this query still has", which is what tells the river
    whether to keep going and the archive how many pages it has.
  */
  const where = () => sql<{
    count: string;
  }>`select count(*)::text as count from articles where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published'
    and (${topic}='' or topic=${topic})
    and (${q}='' or headline ilike ${like} or dek ilike ${like} or (${q.length >= 3} and body ilike ${like}))
    and (${data.saved === undefined} or slug in (select jsonb_array_elements_text(${saved}::jsonb)))
    and (${data.cursor === undefined} or (published_at, id) < (${after}::timestamptz, ${afterId}::int))
    and (${data.exclude === undefined} or id not in (select (jsonb_array_elements_text(${exclude}::jsonb))::int))`;
  const counts = await where();
  const rows =
    await sql<ReaderStory & { published_at_text: string }>`select id,slug,headline,dek,body,topic,published_at,published_at::text as published_at_text from articles where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published'
    and (${topic}='' or topic=${topic})
    and (${q}='' or headline ilike ${like} or dek ilike ${like} or (${q.length >= 3} and body ilike ${like}))
    and (${data.saved === undefined} or slug in (select jsonb_array_elements_text(${saved}::jsonb)))
    and (${data.cursor === undefined} or (published_at, id) < (${after}::timestamptz, ${afterId}::int))
    and (${data.exclude === undefined} or id not in (select (jsonb_array_elements_text(${exclude}::jsonb))::int))
    order by case when ${oldest} then published_at end asc, case when ${!oldest} then published_at end desc, id desc
    limit ${river ? batch + 1 : PAGE_SIZE} offset ${river ? 0 : (page - 1) * PAGE_SIZE}`;
  /*
    One row past the batch, so `hasMore` is answered by the database rather
    than guessed from the count (a count over a 30-row table and a count over a
    real paper's are the same query, but only the extra row is exact).
  */
  const shown = rows.slice(0, batch);
  const total = Number(counts[0]?.count ?? 0);
  const hasMore = river ? rows.length > batch : page * PAGE_SIZE < total;
  const last = shown.at(-1);
  return {
    stories: shown.map((row) => {
      const u = unpackStoredDraft(row);
      return {
        id: row.id,
        slug: row.slug,
        headline: u.headline,
        dek: u.dek,
        body: stripReporterNotebook(u.body),
        topic: u.topic,
        published_at: row.published_at,
      };
    }),
    total,
    pageSize: PAGE_SIZE,
    hasMore,
    nextCursor:
      river && hasMore && last ? { publishedAt: last.published_at_text, id: last.id } : null,
  };
}
