-- Meeting-capture N-5 Continue: a STOPPED capture is resumable.
--
-- Stop is delivered (the in-flight yt-dlp child is SIGKILLed and the record is
-- marked `stopped`). Continue was not: nothing recorded that a partial file was
-- left behind, so the desk could not tell
--   "stopped, nothing to resume"
-- from
--   "stopped, a partial is waiting"
-- and re-running started from zero.
--
-- Additive only. Existing rows get null, which reads as "no known partial" --
-- the honest value for a capture that stopped before this column existed.

alter table meeting_capture_records
  add column if not exists partial_path text;

alter table meeting_capture_records
  add column if not exists resumed_at timestamptz;