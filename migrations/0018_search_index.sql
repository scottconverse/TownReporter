-- Make the public archive search an indexed lookup instead of a table scan.
--
-- /?q= is open to anyone with no session and no rate limit, and the query was
-- `headline ilike '%q%' or dek ilike '%q%' or body ilike '%q%'`. A leading
-- wildcard cannot use a btree index, so every anonymous keystroke read every
-- published body end to end. An audit filed it as ENG-008: cheap to send,
-- unbounded to serve.
--
-- pg_trgm keeps the behaviour exactly as it is -- substring matching, so
-- "ouncil" still finds "council" -- and makes it index-backed. A tsvector
-- index would be smaller but would only match whole words, which is a
-- different search than the one the paper advertises.
--
-- The extension is wrapped because a self-hoster may not be a superuser. If it
-- cannot be installed the paper still works; the search is simply as slow as
-- it was before, and says so in the log rather than refusing to start.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  /*
    Every failure, not just a privilege one.

    This caught `insufficient_privilege` alone, on the assumption that the
    only way to fail is to lack superuser. PGLite -- the embedded database
    the README's zero-config quickstart uses when DATABASE_URL is unset --
    does not ship pg_trgm at all, and raises a different class entirely:
      extension "pg_trgm" is not available
    So the unhandled error aborted the migration, the bootstrap failed, and
    the documented five-minute quickstart died at boot. A gate lane found it
    on the first-run path, which is the only place it shows.

    Degrading is the right answer for all of them. The indexes below are
    skipped when the extension is absent, and the paper still works with the
    search it had before -- slower, but present. Refusing to start is never
    the better outcome for an optional index.
  */
  RAISE NOTICE 'pg_trgm unavailable (%). Archive search stays unindexed.', SQLERRM;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    -- Partial on purpose: drafts are never searched from the paper, so the
    -- index only carries what a reader can actually reach.
    CREATE INDEX IF NOT EXISTS articles_headline_trgm
      ON articles USING gin (headline gin_trgm_ops) WHERE status = 'published';
    CREATE INDEX IF NOT EXISTS articles_dek_trgm
      ON articles USING gin (dek gin_trgm_ops) WHERE status = 'published';
    CREATE INDEX IF NOT EXISTS articles_body_trgm
      ON articles USING gin (body gin_trgm_ops) WHERE status = 'published';
  END IF;
END
$$;
