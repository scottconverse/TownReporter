-- Structured job progress (redesign phase 3, unit BE).
--
-- `desk_jobs` has carried a single free-text `stage` since 0013, and a
-- heartbeat (`updated_at`) since the reclaim window was introduced. That is
-- enough for a spinner and a sentence, and not enough for the thing the owner
-- actually asked for: a bar that moves, a named list of stages, a one-line
-- "now" step, a "no activity for 1:14" stall state, a Cancel button, and an
-- Open button that knows where the result landed.
--
-- WHY COLUMNS AND NOT A SIDE TABLE. Progress is a property of one running job
-- row and every reader of it already selects that row; a second table would
-- mean every screen joins to learn something the row should have carried, and
-- would have to answer what happens when the job ends (the progress table
-- becomes a tombstone). Nullable columns answer that for free: a finished job
-- keeps its last stage list and index, which is exactly what the Done card
-- wants to show.
--
-- `stages_json` is the ordered list of labels as a JSON array of strings, kept
-- as text to match `result_json`'s existing convention on this table (no
-- jsonb, no cast in the read path). Nullable: a job that never reported a
-- stage list renders its single `stage` sentence, as it does today.
--
-- `stage_index` is the position of the current stage in that list. Null means
-- "no list" rather than 0, so a job that has not started a stage is not
-- mistaken for one sitting on the first.
--
-- `pct` is 0-100 or null. Null is the honest value for a stage whose length
-- nobody knows (a model call), and the client draws the indeterminate bar for
-- it rather than inventing a number.
--
-- `step_text` is the one-line "now" step ("Reading packet 2 of 3 (41 pages)").
-- It is deliberately separate from `stage`: `stage` is transient and gets
-- overwritten by "Done" at completion (see 0032), `step_text` is the last
-- thing a worker said while it was working and is never rewritten afterwards.
--
-- `beat_at` is the last sign of life from the WORKER, distinct from
-- `updated_at`, which the reclaim window uses and which a queue tick or a
-- reclaim also writes. The stall rule the design asks for is
-- `now - beat_at >= 60s`, and only the worker's own progress reports move it.
--
-- `cancel_requested` is a flag, not a status: the editor asks, and the worker
-- stops at its next stage boundary with the reason "Cancelled by the editor".
-- A worker that has already died never sees it, which is why the client also
-- offers the existing retry-on-next-model path rather than waiting forever.
-- Default false, not null, so no read path has to distinguish.
--
-- `result_href` is where the finished job's result lives, so the Done card's
-- Open button is a link the server chose rather than a URL the client guesses
-- from the job's kind.
--
-- Additive and nullable-only except for `cancel_requested`'s default: nothing
-- existing is rewritten and no read path is required to change. Every row
-- written before this migration reads as "no structured progress", which is
-- exactly true, and `stage` keeps the sentence those rows already show.
alter table desk_jobs add column if not exists stages_json text;
alter table desk_jobs add column if not exists stage_index integer;
alter table desk_jobs add column if not exists pct integer;
alter table desk_jobs add column if not exists step_text text;
alter table desk_jobs add column if not exists beat_at timestamptz;
alter table desk_jobs add column if not exists cancel_requested boolean not null default false;
alter table desk_jobs add column if not exists result_href text;

comment on column desk_jobs.stages_json is
  'The ordered stage labels for this job, as a JSON array of strings. Null means the job never reported a stage list.';
comment on column desk_jobs.stage_index is
  'Position of the current stage in stages_json. Null means no stage list, not "stage zero".';
comment on column desk_jobs.pct is
  'Progress 0-100, or null when the length of the current stage is unknown (a model call). Null draws an indeterminate bar.';
comment on column desk_jobs.step_text is
  'The last one-line "now" step the worker reported. Unlike stage, nothing overwrites it at completion.';
comment on column desk_jobs.beat_at is
  'Last sign of life from the worker itself. The client calls a job stalled when now - beat_at >= 60s.';
comment on column desk_jobs.cancel_requested is
  'The editor asked this job to stop. The worker checks it between steps and stops with "Cancelled by the editor".';
comment on column desk_jobs.result_href is
  'Where the finished result lives, so the Done card can link to it without guessing from the job kind.';

-- The desk polls for whatever is open in one newsroom and orders by recency,
-- which is the same access path the existing open index serves for a single
-- (kind, subject) triple. This one covers the whole-newsroom list the Running
-- panel reads.
create index if not exists desk_jobs_running_idx
  on desk_jobs (newsroom_id, id desc)
  where status in ('queued', 'running');
