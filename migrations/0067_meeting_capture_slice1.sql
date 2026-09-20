-- Meeting-capture Slice 1: step-zero awareness and the authoritative capture record.
-- Additive only. Unconfigured newsrooms get no rows and no changed scan behavior.
create table if not exists meeting_channel_priority (
  id serial primary key,
  newsroom_id integer not null,
  channel_url text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (newsroom_id, channel_url)
);

create table if not exists meeting_capture_records (
  id serial primary key,
  newsroom_id integer not null,
  video_id text not null,
  channel_url text not null,
  title text not null,
  published text not null default '',
  captured_at timestamptz,
  status text not null default 'not-captured',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, video_id)
);

create index if not exists meeting_capture_records_newsroom_idx
  on meeting_capture_records (newsroom_id);
create index if not exists meeting_capture_records_status_idx
  on meeting_capture_records (newsroom_id, status);

alter table scan_runs add column if not exists meetings_found integer not null default 0;
alter table scan_runs add column if not exists meetings_captured integer not null default 0;
alter table scan_runs add column if not exists meetings_failed integer not null default 0;
alter table scan_runs add column if not exists meeting_failures text;