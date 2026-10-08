create table if not exists investigation_challenges (
  id serial primary key,
  newsroom_id integer not null,
  investigation_id integer not null,
  job_id integer not null,
  run_id integer,
  summary text not null default '',
  result_json text not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists investigation_challenges_job_idx
  on investigation_challenges (newsroom_id, job_id);

create index if not exists investigation_challenges_file_idx
  on investigation_challenges (newsroom_id, investigation_id, id desc);
