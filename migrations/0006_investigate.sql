-- Investigative engine. Watch list is a starting point, not a boundary.
-- Snapshots/artifacts are never pruned.

alter table snapshots add column if not exists url text;
alter table snapshots add column if not exists fetch_status integer;
alter table leads add column if not exists investigation_id integer;

create table if not exists investigations (
  id serial primary key,
  user_id text not null,
  title text not null,
  status text not null default 'open',
  summary text not null default '',
  hops integer not null default 0,
  budget integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists investigations_user_idx on investigations (user_id, updated_at desc);

create table if not exists frontier_items (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null references investigations(id) on delete cascade,
  kind text not null,
  label text not null,
  why text not null default '',
  evidence text not null default '',
  priority integer not null default 5,
  queries_tried text not null default '[]',
  next_steps text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists frontier_inv_idx on frontier_items (investigation_id, status, priority desc);

create table if not exists artifacts (
  id serial primary key,
  user_id text not null,
  investigation_id integer references investigations(id) on delete set null,
  url text not null,
  referrer_url text,
  query text,
  title text not null default '',
  content_type text not null default 'html',
  content_hash text not null,
  full_text text not null default '',
  classification text not null default 'discovered',
  fetch_status integer,
  created_at timestamptz not null default now()
);
create index if not exists artifacts_url_idx on artifacts (user_id, url, created_at desc);
create index if not exists artifacts_inv_idx on artifacts (investigation_id);

create table if not exists entities (
  id serial primary key,
  user_id text not null,
  canonical text not null,
  name text not null,
  kind text not null,
  why text not null default '',
  unique (user_id, canonical)
);

create table if not exists relationships (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  from_name text not null,
  to_name text not null,
  kind text not null,
  evidence text not null default '',
  source_url text,
  created_at timestamptz not null default now()
);

create table if not exists claims (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  body text not null,
  kind text not null,
  evidence text not null default '',
  source_url text,
  confidence numeric,
  created_at timestamptz not null default now()
);

create table if not exists hypotheses (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  body text not null,
  supporting text not null default '',
  contradicting text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists anomalies (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  kind text not null,
  summary text not null,
  url text,
  details text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists dead_ends (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  hypothesis text not null,
  why_interesting text not null default '',
  searches text not null default '',
  entities text not null default '',
  dismissed_because text not null default '',
  unresolved text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists dead_ends_user_idx on dead_ends (user_id, created_at desc);

create table if not exists search_log (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  hop integer not null,
  query text not null,
  results_json text not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists recurring_baselines (
  id serial primary key,
  user_id text not null,
  key text not null,
  kind text not null,
  cadence_days integer not null default 30,
  last_seen timestamptz,
  typical_title text not null default '',
  typical_url text not null default '',
  unique (user_id, key)
);
