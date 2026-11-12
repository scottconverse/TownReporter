-- Additive connector provenance. Existing sources, evidence and stories stay intact.
create table if not exists civic_connector_sources (
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  source_json jsonb not null,
  bounds_json jsonb not null default '{}',
  mode text not null default 'live' check (mode in ('live','saved')),
  write_enabled boolean not null default false,
  revision integer not null default 1,
  primary key (newsroom_id, source_id)
);
create table if not exists civic_connector_imports (
  id serial primary key,
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  bundle_key text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (newsroom_id, source_id, bundle_key)
);
create table if not exists civic_connector_evidence (
  id serial primary key,
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  import_id integer not null references civic_connector_imports(id),
  identity_key text not null,
  record_hash text not null,
  capture_sha256 text not null,
  record_json jsonb not null,
  version_id integer references artifact_versions(id),
  capture_event_id integer references capture_events(id),
  lead_id integer references leads(id),
  created_at timestamptz not null default now(),
  unique (newsroom_id, source_id, identity_key, record_hash)
);
create table if not exists civic_connector_runs (
  id serial primary key,
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  operation text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists civic_connector_plans (
  newsroom_id integer not null,
  source_id integer not null references sources(id) on delete cascade,
  plan_id text not null,
  plan_hash text not null,
  source_revision integer not null,
  result_json jsonb not null,
  receipt_json jsonb,
  created_at timestamptz not null default now(),
  primary key (newsroom_id, plan_id)
);
create index if not exists civic_connector_evidence_room_idx
  on civic_connector_evidence(newsroom_id, source_id, id desc);
