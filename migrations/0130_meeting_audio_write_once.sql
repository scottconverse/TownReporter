-- Audio recaptures are separate evidence, even when the saved bytes have the same hash.
alter table meeting_transcript_artifacts
  drop constraint if exists meeting_transcript_artifacts_newsroom_id_video_id_artifact__key;

create unique index if not exists meeting_transcript_artifacts_transcript_hash_idx
  on meeting_transcript_artifacts(newsroom_id,video_id,artifact_type,sha256)
  where artifact_type='transcript';
