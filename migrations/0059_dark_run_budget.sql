-- Durable, backward-compatible accounting for bounded Dark Desk runs.
-- Existing rows keep empty usage and a null reason; new code fills these
-- incrementally so the existing two-second job poll can show live progress.
alter table dark_runs add column if not exists investigation_id integer;
alter table dark_runs add column if not exists stop_reason text;
alter table dark_runs add column if not exists usage_totals_json text not null default '{}';
alter table dark_runs add column if not exists usage_ledger_json text not null default '[]';

create index if not exists dark_runs_investigation_idx
  on dark_runs (newsroom_id, investigation_id, started_at desc);
