-- A transcript revision is new evidence for the same newsroom assignment, not
-- a second story lead. Preserve one transcript-story lead per meeting video
-- and update that lead to the newest immutable artifact.
drop index if exists leads_meeting_artifact_purpose_uidx;

create unique index if not exists leads_meeting_video_purpose_uidx
  on leads (newsroom_id, meeting_video_id, meeting_lead_purpose)
  where meeting_video_id is not null
    and meeting_artifact_id is not null
    and meeting_lead_purpose is not null;
