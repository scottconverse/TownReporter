-- Forensic investigative schema. Authoritative history for Dark Desk.
-- Capture events are the chronology. Content versions are the unique documents.
-- Watch list remains a starting point, never a boundary.

create table if not exists artifact_versions (
  id serial primary key,
  user_id text not null,
  url text not null,
  content_hash text not null,
  title text not null default '',
  full_text text not null default '',
  fetch_status integer,
  fetch_outcome text not null default 'fetched',
  content_type text not null default 'html',
  extraction_method text not null default '',
  page_count integer,
  raw_ref text,
  captured_at timestamptz not null default now(),
  unique (user_id, url, content_hash)
);
create index if not exists artifact_versions_url_idx on artifact_versions (user_id, url, captured_at desc);

create table if not exists capture_events (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  source_url text not null,
  observed_at timestamptz not null default now(),
  http_status integer,
  fetch_outcome text not null,
  redirect_chain text not null default '[]',
  version_id integer,
  disappearance boolean not null default false,
  soft_404 boolean not null default false,
  trigger_kind text not null default 'investigation',
  monitor_id integer,
  headers_json text not null default '{}',
  content_hash text,
  content_type text not null default '',
  extraction_method text not null default ''
);
create index if not exists capture_events_url_idx on capture_events (user_id, source_url, observed_at);
create index if not exists capture_events_inv_idx on capture_events (investigation_id, observed_at);

create table if not exists artifact_chunks (
  id serial primary key,
  version_id integer not null,
  user_id text not null,
  chunk_index integer not null,
  page_number integer,
  section text not null default '',
  excerpt text not null,
  locator text not null default ''
);
create index if not exists artifact_chunks_version_idx on artifact_chunks (version_id, chunk_index);
create index if not exists artifact_chunks_user_idx on artifact_chunks (user_id, version_id);

create table if not exists investigation_entities (
  id serial primary key,
  user_id text not null,
  investigation_id integer not null,
  entity_id integer not null,
  first_seen_version_id integer,
  first_seen_capture_id integer,
  first_seen_url text,
  relevance text not null default 'direct',
  status text not null default 'active',
  unique (investigation_id, entity_id)
);
create index if not exists investigation_entities_inv_idx on investigation_entities (investigation_id);
create index if not exists investigation_entities_user_idx on investigation_entities (user_id, entity_id);

create table if not exists entity_aliases (
  id serial primary key,
  user_id text not null,
  canonical text not null,
  alias text not null,
  verdict text not null default 'unresolved',
  evidence text not null default '',
  unique (user_id, canonical, alias)
);

create table if not exists entity_matches (
  id serial primary key,
  user_id text not null,
  left_canonical text not null,
  right_canonical text not null,
  verdict text not null default 'unresolved',
  evidence text not null default '',
  capture_event_id integer,
  investigation_id integer,
  unique (user_id, left_canonical, right_canonical)
);
create index if not exists entity_matches_user_idx on entity_matches (user_id, verdict);

create table if not exists source_monitors (
  id serial primary key,
  user_id text not null,
  url text not null,
  title text not null default '',
  enabled boolean not null default true,
  cadence_hours integer not null default 24,
  next_check_at timestamptz not null default now(),
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_outcome text,
  last_version_id integer,
  expected_cadence_days integer,
  importance integer not null default 5,
  disappearance_sensitive boolean not null default true,
  investigation_id integer,
  typical_structure text not null default '',
  unique (user_id, url)
);
create index if not exists source_monitors_due_idx on source_monitors (user_id, enabled, next_check_at);

create table if not exists search_attempts (
  id serial primary key,
  user_id text not null,
  investigation_id integer,
  search_log_id integer,
  frontier_id integer,
  query text not null,
  provider text not null,
  state text not null,
  hits_json text not null default '[]',
  error text,
  created_at timestamptz not null default now()
);
create index if not exists search_attempts_inv_idx on search_attempts (investigation_id, created_at);

alter table artifacts add column if not exists version_id integer;
alter table artifacts add column if not exists fetch_outcome text;
alter table artifacts add column if not exists capture_event_id integer;
alter table artifacts add column if not exists extraction_method text;

alter table claims add column if not exists version_id integer;
alter table claims add column if not exists excerpt text;
alter table claims add column if not exists capture_hash text;
alter table claims add column if not exists capture_event_id integer;
alter table claims add column if not exists provenance_status text;
alter table claims add column if not exists locator text;
alter table claims add column if not exists captured_at timestamptz;

alter table relationships add column if not exists version_id integer;
alter table relationships add column if not exists excerpt text;
alter table relationships add column if not exists capture_event_id integer;
alter table relationships add column if not exists capture_hash text;
alter table relationships add column if not exists provenance_status text;
alter table relationships add column if not exists locator text;

alter table frontier_items add column if not exists closed_reason text;
alter table frontier_items add column if not exists strategies_tried text;
alter table frontier_items add column if not exists strategies_budget text;
alter table frontier_items add column if not exists search_zero_count integer;

alter table hypotheses add column if not exists transition_note text;

alter table search_log add column if not exists provider text;
alter table search_log add column if not exists state text;
alter table search_log add column if not exists caused_by text;
alter table search_log add column if not exists frontier_id integer;
alter table search_log add column if not exists hypothesis_id integer;
alter table search_log add column if not exists research_question text;
alter table search_log add column if not exists strategy text;
alter table search_log add column if not exists selected_json text;
alter table search_log add column if not exists fetched_json text;
alter table search_log add column if not exists generated_json text;
alter table search_log add column if not exists query_fingerprint text;

alter table recurring_baselines add column if not exists sightings integer;
alter table recurring_baselines add column if not exists usual_weekday text;
alter table recurring_baselines add column if not exists usual_nth_weekday text;
alter table recurring_baselines add column if not exists usual_lead_hours integer;
alter table recurring_baselines add column if not exists usual_attachment_count integer;
alter table recurring_baselines add column if not exists typical_structure_json text;

alter table artifact_versions add column if not exists extraction_method text;
alter table artifact_versions add column if not exists page_count integer;
alter table artifact_versions add column if not exists raw_ref text;
alter table artifact_versions add column if not exists content_type text;

alter table entity_aliases add column if not exists evidence text;
alter table entity_aliases add column if not exists verdict text;
