create table if not exists desk_jobs (
  id serial primary key,
  newsroom_id integer not null default 1,
  user_id text not null,
  kind text not null,
  subject_id integer not null default 0,
  status text not null default 'queued',
  stage text not null default '',
  error text,
  result_json text not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists desk_jobs_open_idx
  on desk_jobs (newsroom_id, kind, subject_id, status, id desc);

alter table frontier_items add column if not exists newsroom_id integer not null default 1;
alter table entities add column if not exists newsroom_id integer not null default 1;
alter table relationships add column if not exists newsroom_id integer not null default 1;
alter table claims add column if not exists newsroom_id integer not null default 1;
alter table hypotheses add column if not exists newsroom_id integer not null default 1;
alter table anomalies add column if not exists newsroom_id integer not null default 1;
alter table dead_ends add column if not exists newsroom_id integer not null default 1;
alter table search_log add column if not exists newsroom_id integer not null default 1;
alter table recurring_baselines add column if not exists newsroom_id integer not null default 1;
alter table entity_aliases add column if not exists newsroom_id integer not null default 1;
alter table investigation_entities add column if not exists newsroom_id integer not null default 1;
alter table entity_matches add column if not exists newsroom_id integer not null default 1;
alter table search_attempts add column if not exists newsroom_id integer not null default 1;
