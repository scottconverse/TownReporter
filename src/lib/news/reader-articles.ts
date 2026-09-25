import { z } from "zod";
import type { ReaderStory } from "../reader.ts";

/**
 * The contract the public reader query is called through, kept apart from the
 * query itself so the client bundle can hold the schema and the types without
 * pulling in the database. `reader-articles.server.ts` is the query;
 * `reader-public.ts` is the server function the routes go through.
 */

/** How many the archive shows per page. Unchanged since the archive was written. */
export const PAGE_SIZE = 12;
/** The most the latest-stories river will hand back in one batch. */
export const MAX_BATCH = 24;

const cursorSchema = z.object({
  /** Postgres's own `published_at::text`, not a JavaScript Date -- see `after`. */
  publishedAt: z.string().max(64),
  id: z.number().int(),
});

export const readerArticlesInput = z.object({
  q: z.string().trim().max(80).optional(),
  topic: z.string().max(100).optional(),
  page: z.number().int().min(1).max(100000).default(1),
  oldest: z.boolean().default(false),
  saved: z.array(z.string().max(300)).max(500).optional(),
  /*
    The latest-stories river reads this same query, one batch at a time, BELOW
    A CURSOR rather than at a page offset: with 12-per-page offsets, a story
    published between two batches shifts every later page down by one, so the
    reader sees a story twice and never sees its neighbour. The cursor is a
    position in the fixed order `published_at desc, id desc`, so a new story
    lands above it and changes nothing below.

    A batch is the newest-first order only; `oldest` with a cursor is not a
    position any caller of this query asks for.
  */
  cursor: cursorSchema.optional(),
  /** Stories already printed further up the page, which the river must not repeat. */
  exclude: z.array(z.number().int()).max(200).optional(),
  /** Batch size for a cursor read. Capped at MAX_BATCH whatever the caller asks. */
  limit: z.number().int().min(1).max(MAX_BATCH).optional(),
});
export type ReaderArticlesInput = z.input<typeof readerArticlesInput>;
export type ReaderPage = {
  stories: ReaderStory[];
  /**
   * Published stories this query matches from here down -- with a cursor, the
   * ones still below it after the excluded ones. The river reads `hasMore`
   * instead; the archive reads `total` for its page count.
   */
  total: number;
  pageSize: number;
  hasMore: boolean;
  /** Where the next batch resumes, or null at the first story we published. */
  nextCursor: { publishedAt: string; id: number } | null;
};
