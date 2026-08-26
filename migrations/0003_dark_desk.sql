create table if not exists dark_runs (
  id serial primary key,
  user_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary text,
  error text
);
create index if not exists dark_runs_user_idx on dark_runs (user_id, started_at desc);

create table if not exists dark_signals (
  id serial primary key,
  user_id text not null,
  run_id integer references dark_runs(id) on delete set null,
  name text not null,
  posture text not null,
  signal_type text not null,
  strength integer not null default 3,
  confidence numeric not null default 0.3,
  observation text not null default '',
  pattern text not null default '',
  linkage_map text not null default '',
  alternatives text not null default '',
  counter_narrative text not null default '',
  what_would_kill text not null default '',
  pathway text not null default '',
  privacy_review text not null default '',
  handoff text not null default 'HOLD FOR PATTERN',
  created_at timestamptz not null default now()
);
create index if not exists dark_signals_user_idx on dark_signals (user_id, created_at desc);

create table if not exists dark_promises (
  id serial primary key,
  user_id text not null,
  who_promised text not null,
  what text not null,
  when_due text,
  source_cite text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists dark_promises_user_idx on dark_promises (user_id, created_at desc);
