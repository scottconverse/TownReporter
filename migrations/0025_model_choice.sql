-- The editor may choose a model for one run. Persist the choice with the job
-- so the background worker uses the same model after the request has ended.
alter table desk_jobs
  add column if not exists model_choice text not null default 'auto';

-- Opinion historically created this table lazily on first visit rather than
-- in a migration. A fresh install therefore reaches 0025 before the table
-- exists. Define the same table here so clean-database bootstrap is valid;
-- the ALTER below upgrades installations where Opinion already created it.
create table if not exists editorial_requests (
  id serial primary key,
  user_id text not null,
  newsroom_id integer not null default 1,
  subject text not null,
  source_kind text not null default 'paste',
  source_ref text not null default '',
  asked_for text not null default '',
  pointers_json text not null default '[]',
  our_story_json text,
  draft_id integer,
  error text,
  model_choice text not null default 'auto',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table editorial_requests
  add column if not exists model_choice text not null default 'auto';
