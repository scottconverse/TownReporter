-- Two lanes for desk_jobs, so a 40-minute editorial no longer starves a Scan
-- or a Draft queued behind it. Audit finding ENG-105.
--
-- Purely additive: one nullable-then-backfilled column, one index, one
-- UPDATE that only ever moves a row from NULL to a real lane value. Nothing
-- here drops, truncates or deletes -- scripts/no-destructive-migrate.test.mjs
-- is the gate that exists because a migration once did exactly that, and
-- this file was written to pass it without needing to think about it.

alter table desk_jobs add column if not exists lane text;

-- Existing rows (including any 'queued'/'running' row from before this
-- migration ran) have no lane yet. 'editorial' is the one kind that is slow
-- and singular; every other kind shares the 'default' lane. This is the same
-- rule jobs.ts's laneForKind() applies to every new job, so an old row and a
-- new row of the same kind always land in the same lane.
update desk_jobs
set lane = case when kind = 'editorial' then 'editorial' else 'default' end
where lane is null;

-- The drainer's per-lane claim query filters on (lane, status) and orders by
-- id; this index is that query's access path.
create index if not exists desk_jobs_lane_idx
  on desk_jobs (lane, status, id asc);
