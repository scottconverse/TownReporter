-- Truthful scan coverage accounting. The run row previously recorded only
-- sources_fetched/leads_created/sources_proposed, so an editor could not tell a
-- clean zero-lead pass from a provider failure, a partially-analyzed run, or a
-- batch that was dropped. These columns record what was selected, what was
-- attempted, what actually fetched, what failed, how much reached the model,
-- and how many analysis batches succeeded or failed. All are additive and
-- default to 0 so existing rows keep their meaning.
alter table scan_runs
  add column if not exists sources_selected integer not null default 0;
alter table scan_runs
  add column if not exists sources_attempted integer not null default 0;
alter table scan_runs
  add column if not exists sources_failed integer not null default 0;
alter table scan_runs
  add column if not exists sources_analyzed integer not null default 0;
alter table scan_runs
  add column if not exists model_batches_used integer not null default 0;
alter table scan_runs
  add column if not exists model_batches_failed integer not null default 0;
-- Which sources failed and why, so the editor can see the set, not just a count.
alter table scan_runs
  add column if not exists failed_sources text;