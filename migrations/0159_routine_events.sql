-- EVENTS-PR3 (Scott, Oct 29 2026: "local area events"). The event readers now
-- keep a durable row per (newsroom, source, reader event, local date) so a good
-- read can safely remove only that source's disappeared events. A skipped or
-- partial read removes nothing. The story collapses rows that share a match key,
-- which is how the same event on two sites prints as one line.
--
-- Additive only: one new table, no foreign key (so this migration takes no lock
-- on sources or the routine-notice tables). The deploy applier wraps a file in a
-- transaction; a busy catalog wait fails in three seconds and can be retried.

set local lock_timeout = '3s';

create table if not exists routine_events (
  id bigserial primary key,
  newsroom_id integer not null,
  source_id integer not null,
  event_key text not null,
  candidate_key text not null,
  match_key text not null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  local_date date not null,
  start_minutes integer,
  all_day boolean not null default false,
  place text not null default '',
  town text not null default '',
  area text not null check (area in ('longmont', 'nearby', 'county', 'colorado')),
  source_url text not null,
  link text,
  source_issuer text not null default '',
  source_title text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (newsroom_id, source_id, event_key, local_date)
);

create index if not exists routine_events_newsroom_date_idx
  on routine_events (newsroom_id, local_date);

comment on table routine_events is
  'One row per newsroom, source, stable reader event key and local date. Full reads replace only their own source rows inside the reader window; Today in town collapses rows by match_key.';
