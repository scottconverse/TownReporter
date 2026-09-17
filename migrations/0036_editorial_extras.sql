-- editorial_extras existed only in the runtime ensure list
-- (ensureEditorialSchema, src/lib/news/editorial.server.ts) and had no
-- migration at all -- a database built from migrations/ alone was missing
-- it (GauntletGate ENG-03's schema-parity capstone test).
--
-- Mirrored by the existing `create table if not exists editorial_extras`
-- in editorial.server.ts, which stays so the PGLite and unit-test paths
-- keep working without depending on the migration glob.
create table if not exists editorial_extras (
  draft_id integer primary key,
  newsroom_id integer not null default 1,
  fact_sheet text not null default '',
  image_prompt text not null default '',
  source_kind text not null default '',
  source_ref text not null default '',
  generated_at timestamptz not null default now()
);
