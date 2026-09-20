-- Meeting-capture M-1: audio-required fallback artifact + trigger reason.
-- Additive only. Audio is captured ONLY when captions are missing or rejected.
-- The DB row remains authoritative; the audio file is a first-class artifact.
alter table meeting_capture_records add column if not exists audio_path text;
alter table meeting_capture_records add column if not exists audio_format text;
alter table meeting_capture_records add column if not exists audio_sha256 text;
alter table meeting_capture_records add column if not exists audio_bytes bigint;
alter table meeting_capture_records add column if not exists audio_captured_at timestamptz;
alter table meeting_capture_records add column if not exists audio_trigger_reason text;

-- Allow audio artifacts alongside transcripts without touching transcript rows.
alter table meeting_transcript_artifacts drop constraint if exists meeting_transcript_artifacts_artifact_type_check;
alter table meeting_transcript_artifacts add constraint meeting_transcript_artifacts_artifact_type_check
  check (artifact_type in ('transcript','audio'));
alter table meeting_transcript_artifacts add column if not exists byte_size bigint;
