-- Meeting-capture Slice 3: durable transcript artifacts, segments, and operator settings.
-- Additive only. Meeting transcript artifacts are separate from Dark web artifacts.
create table if not exists meeting_capture_settings (
  newsroom_id integer primary key,
  storage_root text,
  retention_mode text not null default 'transcript-only'
    check (retention_mode in ('media','audio-only','transcript-only')),
  deletion_policy text not null default 'explicit',
  updated_at timestamptz not null default now()
);

create table if not exists meeting_transcript_artifacts (
  id serial primary key,
  newsroom_id integer not null,
  video_id text not null,
  artifact_type text not null default 'transcript'
    check (artifact_type in ('transcript')),
  storage_path text not null,
  format text not null,
  sha256 text not null,
  captured_at timestamptz not null default now(),
  source_method text not null,
  retention_mode text not null
    check (retention_mode in ('media','audio-only','transcript-only')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, video_id, artifact_type, sha256)
);

create index if not exists meeting_transcript_artifacts_newsroom_idx
  on meeting_transcript_artifacts (newsroom_id, video_id);

create table if not exists meeting_transcript_segments (
  id serial primary key,
  artifact_id integer not null references meeting_transcript_artifacts(id) on delete cascade,
  segment_index integer not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  item text,
  excerpt text not null,
  caption_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (artifact_id, segment_index)
);

create index if not exists meeting_transcript_segments_artifact_idx
  on meeting_transcript_segments (artifact_id, segment_index);
