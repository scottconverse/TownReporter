-- U30: which pages the desk captured for one editorial request.
--
-- The Opinion writers whose providers have no web tools (DeepSeek v4.1 Flash's
-- rung, the local model, a saved connection) are researched by the DESK: the
-- research pass searches, opens and captures pages with the same machinery the
-- Dark Desk uses (`rememberCapture` -> artifact_versions + capture_events), and
-- a no-tool model call plans the queries and reads the captures back as
-- findings. The writing pass then cites what was captured by URL and capture id.
--
-- `capture_events` is where every capture lands regardless of who asked for it,
-- and nothing on it said WHICH editorial a capture belonged to. This column is
-- that link, the same shape `story_documents.editorial_request_id` already has
-- (migrations/0058). Nullable, and written only by the editorial research pass,
-- so the Dark Desk's own captures and the name check's are untouched.
--
-- Mirrored statement for statement in `INVESTIGATE_SCHEMA_STATEMENTS`
-- (src/lib/news/investigate.ts), because `src/lib/news/schema-parity.test.ts`
-- diffs the runtime ensure* schema against the migration-built one table by
-- table and would report a difference if the two drifted.
alter table capture_events add column if not exists editorial_request_id integer;

create index if not exists capture_events_editorial_request_idx on capture_events (editorial_request_id);
