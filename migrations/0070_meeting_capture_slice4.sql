-- Meeting-capture Slice 4: provisional status, revision history, and draft links.
-- Additive only. The DB row remains authoritative; prior transcript artifacts are
-- retained on revision instead of being overwritten.
alter table meeting_capture_records add column if not exists ended_at timestamptz;
alter table meeting_capture_records add column if not exists capture_disposition text not null default 'final'
  check (capture_disposition in ('provisional','final'));
alter table meeting_capture_records add column if not exists consecutive_unchanged integer not null default 0;
alter table meeting_capture_records add column if not exists last_checked_at timestamptz;
alter table meeting_capture_records add column if not exists settled_under_churn boolean not null default false;
alter table meeting_capture_records add column if not exists revision_count integer not null default 0;
alter table meeting_capture_records add column if not exists last_revision_at timestamptz;
alter table meeting_capture_records add column if not exists caption_revision_timestamp bigint;
alter table meeting_capture_records add column if not exists duration_seconds integer;

create table if not exists meeting_transcript_revisions (
  id serial primary key,
  newsroom_id integer not null,
  video_id text not null,
  artifact_id integer not null references meeting_transcript_artifacts(id) on delete cascade,
  prior_artifact_id integer references meeting_transcript_artifacts(id) on delete set null,
  revision_signal text not null check (revision_signal in ('hash','revision-timestamp','duration')),
  prior_sha256 text,
  new_sha256 text,
  recorded_at timestamptz not null default now()
);

create index if not exists meeting_transcript_revisions_video_idx
  on meeting_transcript_revisions (newsroom_id, video_id, recorded_at desc);

-- The future drafting path writes here. No drafting path exists in this slice;
-- this table defines exactly where it will link a draft to its transcript.
create table if not exists meeting_draft_transcript_links (
  id serial primary key,
  newsroom_id integer not null,
  draft_id integer not null,
  artifact_id integer not null references meeting_transcript_artifacts(id) on delete cascade,
  citation_snapshot text not null default '[]',
  revision_notice text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, draft_id, artifact_id)
);

create index if not exists meeting_draft_transcript_links_draft_idx
  on meeting_draft_transcript_links (newsroom_id, draft_id);
