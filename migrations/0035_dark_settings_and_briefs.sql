-- dark_settings and investigation_briefs existed only in the runtime ensure
-- list (DARK_SCHEMA_STATEMENTS, src/lib/news/dark.ts) and had no migration
-- at all -- a database built from migrations/ alone was missing both tables
-- (GauntletGate ENG-03's schema-parity capstone test, which found this
-- while proving the fix for the two columns the audit had already named).
-- Both worked today only because `ensureDarkSchema()` is called at the top
-- of every Dark Desk handler on every backend, so the table always exists
-- before it is used -- but that is a runtime guarantee, not a migrations/
-- guarantee, and this repo's own migration headers claim migrations/ is the
-- single schema source.
--
-- Mirrored by the existing `create table if not exists investigation_briefs`
-- / `create table if not exists dark_settings` entries in
-- DARK_SCHEMA_STATEMENTS, which stay so the PGLite and unit-test paths keep
-- working without depending on the migration glob.
create table if not exists investigation_briefs (
  investigation_id integer primary key,
  newsroom_id integer not null default 1,
  brief_json text not null default '{}',
  generated_at timestamptz not null default now()
);
create table if not exists dark_settings (
  newsroom_id integer primary key,
  dig integer not null default 4,
  nerve integer not null default 5,
  scope text not null default 'city',
  updated_at timestamptz not null default now()
);
