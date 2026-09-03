-- The provider-switch reason (src/lib/news/desk.ts's failOverAndRetry) used
-- to live only in the job's transient `stage` column, which "Done" then
-- overwrites -- so once a draft finished, the editor could no longer see
-- why it had moved models. This column is the durable copy: it is written
-- once, at the moment a job switches, and it survives past the job
-- finishing so the story view can show it.
alter table desk_jobs
  add column if not exists failover_note text not null default '';
