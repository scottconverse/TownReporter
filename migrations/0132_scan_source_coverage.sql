alter table scan_runs
  add column if not exists source_coverage jsonb not null default '[]'::jsonb;
