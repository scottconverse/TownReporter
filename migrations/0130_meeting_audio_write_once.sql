-- Keep the previous artifact table's unique constraint intact for rollback compatibility.
-- New audio files get a separate record identity, even when their bytes hash the same.
create table if not exists meeting_audio_captures (
  id integer primary key default nextval('meeting_transcript_artifacts_id_seq'::regclass),
  newsroom_id integer not null,
  video_id text not null,
  storage_path text not null,
  format text not null,
  sha256 text not null,
  captured_at timestamptz not null default now(),
  source_method text not null,
  retention_mode text not null check (retention_mode in ('media','audio-only','transcript-only')),
  byte_size bigint,
  info_path text,
  info_sha256 text,
  info_bytes integer,
  info_missing_reason text,
  integrity_status text not null default 'unchecked'
    check (integrity_status in ('unchecked','valid','missing','hash-mismatch','sidecar-missing','sidecar-hash-mismatch','outside-root','ambiguous-path')),
  integrity_detail text,
  integrity_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_audio_captures_newsroom_video_idx
  on meeting_audio_captures (newsroom_id, video_id, captured_at desc, id desc);

-- Older audio records remain in meeting_transcript_artifacts. The view gives readers
-- one inventory while keeping writes to the old table backward-compatible.
create or replace view meeting_audio_artifact_inventory as
  select id, newsroom_id, video_id, storage_path, format, sha256, captured_at,
         source_method, retention_mode, byte_size, info_path, info_sha256, info_bytes,
         info_missing_reason, integrity_status, integrity_detail, integrity_checked_at,
         true as is_legacy
    from meeting_transcript_artifacts
   where artifact_type = 'audio'
  union all
  select id, newsroom_id, video_id, storage_path, format, sha256, captured_at,
         source_method, retention_mode, byte_size, info_path, info_sha256, info_bytes,
         info_missing_reason, integrity_status, integrity_detail, integrity_checked_at,
         false as is_legacy
    from meeting_audio_captures;
