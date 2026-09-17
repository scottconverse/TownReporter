-- One open job per (newsroom, kind, subject). Enforced here, not in a check.
--
-- enqueueJob ran findOpenJob and then a separate insert, with no transaction
-- and no conflict target. Under concurrency every caller looks, sees nothing,
-- and inserts its own row. An audit fired twenty simultaneous enqueues for one
-- tuple and got twenty distinct jobs.
--
-- The worker's claim token and heartbeat stop two workers running the SAME
-- row. They cannot coalesce duplicate rows. So a double click, a retry, two
-- open tabs, or two monitor ticks arriving together bought twenty scans or
-- twenty drafts, each paying full model price and writing conflicting output.
--
-- A partial unique index is the only thing that holds under concurrency: the
-- second inserter loses at the database, whatever the application believed it
-- saw a millisecond earlier. Partial, because a finished job must never block
-- the next one for the same subject.

-- Existing duplicates would make the index creation fail, so they have to
-- leave the index's WHERE clause first.
--
-- They are RETIRED, not deleted. The first version of this file used DELETE
-- FROM and was caught by scripts/no-destructive-migrate.test.mjs — the gate
-- written earlier today after a migration was found that could TRUNCATE the
-- newsroom. The gate was right to stop it: migrations run unattended against
-- production on every build, and "it's only queue rows" is exactly the
-- reasoning that makes the next deletion easy to wave through.
--
-- An UPDATE does the same job better. The row survives with its history, an
-- operator can see what happened, and status 'superseded' falls outside the
-- partial index. The oldest open job per tuple is kept — it is the one callers
-- were already handed and the one a worker may already be running.
update desk_jobs d
set status = 'superseded',
    error = coalesce(nullif(d.error, ''), 'Superseded by an earlier job for the same subject (migration 0017).'),
    finished_at = coalesce(d.finished_at, now()),
    updated_at = now()
from desk_jobs keep
where d.status in ('queued', 'running')
  and keep.status in ('queued', 'running')
  and d.newsroom_id = keep.newsroom_id
  and d.kind = keep.kind
  and d.subject_id = keep.subject_id
  and d.id > keep.id;

create unique index if not exists desk_jobs_one_open_per_subject
  on desk_jobs (newsroom_id, kind, subject_id)
  where status in ('queued', 'running');
