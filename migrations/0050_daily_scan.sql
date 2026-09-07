create table if not exists daily_scan_policies (
  newsroom_id integer primary key references newsrooms(id),
  enabled boolean not null default false,
  paused boolean not null default false,
  pause_reason text,
  local_time text not null default '06:00',
  runtime text not null default 'local',
  source_cap integer not null default 12,
  selected_source_ids jsonb not null default '[]'::jsonb,
  revision integer not null default 0,
  configured_by_user_id text not null,
  updated_at timestamptz not null default now(),
  check (source_cap between 1 and 12)
);
create table if not exists daily_scan_reservations (
  id serial primary key,
  newsroom_id integer not null references newsrooms(id),
  local_day date not null,
  status text not null default 'queued',
  policy_revision integer not null,
  policy_snapshot jsonb not null,
  source_snapshot jsonb not null,
  model_snapshot jsonb not null,
  scan_run_id integer unique,
  desk_job_id integer unique,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(newsroom_id, local_day)
);
alter table scan_runs add column if not exists source_snapshot text;
alter table scan_runs add column if not exists policy_snapshot text;
alter table scan_runs add column if not exists model_snapshot text;
alter table scan_runs add column if not exists execution_origin text not null default 'manual';
alter table scan_runs add column if not exists daily_reservation_id integer references daily_scan_reservations(id);
create unique index if not exists daily_scan_one_open_per_newsroom
  on daily_scan_reservations(newsroom_id) where status in ('queued', 'running');
