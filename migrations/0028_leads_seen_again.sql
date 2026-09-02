-- A killed lead the scanner rediscovers gets stamped, not refiled (0.6.1).
--
-- Nothing about a lead is ever hidden or deleted -- see AGENTS.project.md /
-- dark.ts: "a killed story might be important in the future if it surfaces
-- again." Today performScanWork inserts every AI-returned lead as a brand
-- new row with no check against what already exists, so a killed lead comes
-- back every scan and the editor kills it again and again. The fix is a
-- deterministic code-side matcher (src/lib/news/lead-match.ts, no AI tokens
-- spent) that, on a match, stamps the existing row instead of inserting a
-- duplicate.
--
-- No PGLite ensure-function counterpart is needed: leads has none (grepped
-- src/lib/news/desk.ts for an ensure* function guarding the leads table and
-- found none), and the PGLite fallback in src/lib/db.ts applies every file
-- under migrations/*.sql itself at startup (see scripts/migrate.mjs's own
-- comment: "the PGLite fallback applies the same files at startup instead").
-- This migration file is the single schema source for both paths.
alter table leads add column if not exists resurfaced_count integer not null default 0;
alter table leads add column if not exists last_resurfaced_at timestamptz;
alter table leads add column if not exists last_resurfaced_scan_run_id integer;
