-- Meeting-capture sidecar storage: the info JSON is a first-class artifact.
-- Additive only. A missing sidecar is recorded explicitly, never silently ignored.
alter table meeting_transcript_artifacts add column if not exists info_path text;
alter table meeting_transcript_artifacts add column if not exists info_sha256 text;
alter table meeting_transcript_artifacts add column if not exists info_bytes integer;
alter table meeting_transcript_artifacts add column if not exists info_missing_reason text;
