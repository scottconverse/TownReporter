-- G24-S3-2 (Oct 26 2026). Make the Story page's "Find evidence" search fast on
-- repeat use. Two indexes on artifact_chunks, both added only:
--   1. a pg_trgm GIN index on excerpt, for the exact-words list;
--   2. a btree on (newsroom_id, md5(excerpt)), for the close-in-meaning list's
--      candidate-row query, which looked up md5(excerpt) = any(...) by reading
--      every excerpt of the newsroom (about 0.2 s).
--
-- The exact-words list runs `artifact_chunks.excerpt ilike '%words%'` for one
-- newsroom (src/lib/news/evidence-search.server.ts, exactRows). A leading
-- wildcard cannot use a btree index, so every search read every excerpt of the
-- newsroom (about 0.43 s on "recovery"). A pg_trgm GIN index keeps the search
-- exactly as it is -- same substring rule, same rows -- and makes it
-- index-backed. Added only; nothing is changed or removed.
--
-- Guarded the same way as 0018_search_index.sql: if pg_trgm cannot be installed
-- (not a superuser, or PGLite, which does not ship it) this logs a notice and
-- goes on, and the search is as slow as before.
--
-- Locking: CREATE INDEX (not CONCURRENTLY: the migration runner applies each
-- file in one transaction, where CONCURRENTLY is not allowed) takes a SHARE lock
-- on artifact_chunks while it builds. Reads are not blocked; inserts, updates
-- and deletes on artifact_chunks wait until it finishes. lock_timeout is five
-- seconds, so a long writer already holding the table makes this skip the index
-- with a notice instead of queueing every other writer behind it. A skipped
-- index is not retried; create it by hand from the statements below.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable (%). Evidence exact-words search stays unindexed.', SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    PERFORM set_config('lock_timeout', '5s', true);
    -- Partial on purpose: the search never reads a blank excerpt (takedowns
    -- blank them), so the index only carries what a search can reach.
    CREATE INDEX IF NOT EXISTS artifact_chunks_excerpt_trgm
      ON artifact_chunks USING gin (excerpt gin_trgm_ops) WHERE excerpt <> '';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'evidence exact-words index not created (%). Search stays unindexed.', SQLERRM;
END
$$;

DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  CREATE INDEX IF NOT EXISTS artifact_chunks_excerpt_md5
    ON artifact_chunks (newsroom_id, md5(excerpt)) WHERE excerpt <> '';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'evidence md5 index not created (%). Search stays unindexed.', SQLERRM;
END
$$;

-- Put the lock wait back to the session's own setting for the rest of the transaction.
SELECT set_config('lock_timeout', '0', true);
