-- Meeting-capture N-2: manual run control and forced re-capture.
-- Additive only; existing rows keep their meaning.
--
-- scan_runs already has execution_origin (default 'manual') and daily_reservation_id
-- (nullable). N-2 uses those for provenance: manual runs are execution_origin='manual'
-- with daily_reservation_id IS NULL.
alter table scan_runs add column if not exists forced_recapture boolean not null default false;

-- A forced re-capture is recorded on the capture record so the overwrite is visible.
alter table meeting_capture_records add column if not exists forced_recapture boolean not null default false;
alter table meeting_capture_records add column if not exists forced_recapture_at timestamptz;
alter table meeting_capture_records add column if not exists prior_caption_sha256 text;
