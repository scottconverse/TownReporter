-- Dark Desk F4: stop the same dead end from being inserted over and over
-- (one hypothesis reproduced 18x on prod) and stop a revived dead end from
-- resurfacing forever (42 open "revived-dead-end" rows crowding out real
-- leads).
--
-- `confirmation_count` tracks how many times the model re-asserted the same
-- (investigation_id, dedup_key) dead end; `settled` flips true once that
-- crosses DEAD_END_CONFIRMATION_CAP (src/lib/news/investigate.ts, currently
-- 3). `matchDeadEnds` excludes settled rows, so a dead end stops resurfacing
-- once it's been confirmed enough times to be sure it's genuinely a repeat.
-- `dedup_key` is `lower(trim(hypothesis))`, computed the same way at write
-- time in persistPlan -- a stored column rather than a functional unique
-- index on lower(hypothesis) directly, because de-colliding a pre-existing
-- duplicate below needs to change ONLY the dedup key, never the hypothesis
-- text itself (see the note on de-collision vs deletion).
--
-- As with 0038, this DE-COLLIDES existing duplicate (investigation_id,
-- dedup_key) rows before adding the unique index the upsert relies on --
-- it does not delete them. This repo's migration runner refuses any
-- statement matching DELETE FROM/TRUNCATE/DROP TABLE (see
-- scripts/no-destructive-migrate.test.mjs), so every row except the one
-- kept as the confirmation target has its `dedup_key` suffixed with its own
-- id, folding its confirmation_count into the row that's kept (summed, so a
-- hypothesis already inserted 18x starts out correctly as "confirmed many
-- times", not reset to 1) rather than folding it away. Idempotent: a second
-- run finds every duplicate already uniquified.

alter table dead_ends add column if not exists confirmation_count integer not null default 1;
alter table dead_ends add column if not exists settled boolean not null default false;
alter table dead_ends add column if not exists dedup_key text;

update dead_ends set dedup_key = lower(trim(hypothesis)) where dedup_key is null;

alter table dead_ends alter column dedup_key set not null;
alter table dead_ends alter column dedup_key set default '';

-- Fold the duplicate count into the row we keep (highest existing
-- confirmation_count, lowest id as tiebreaker). Two separate CTEs on
-- purpose: `totals` is a plain GROUP BY aggregate; `ranked` is a per-row
-- window function with no GROUP BY -- mixing a raw column reference with a
-- window function inside one GROUP BY query is not valid SQL, so this
-- keeps them apart and joins the results in the UPDATE.
with totals as (
  select investigation_id, dedup_key,
    sum(confirmation_count) as total_confirmations
  from dead_ends
  where investigation_id is not null
  group by investigation_id, dedup_key
),
ranked as (
  select id, investigation_id, dedup_key,
    row_number() over (
      partition by investigation_id, dedup_key
      order by confirmation_count desc, id asc
    ) as rn
  from dead_ends
  where investigation_id is not null
)
update dead_ends d
set confirmation_count = totals.total_confirmations,
    settled = totals.total_confirmations >= 3
from ranked
join totals
  on totals.investigation_id = ranked.investigation_id
  and totals.dedup_key = ranked.dedup_key
where d.id = ranked.id
  and ranked.rn = 1;

-- Every OTHER row in the group (rn > 1) keeps its own confirmation_count
-- (already folded into the kept row above) but gets a de-collided
-- dedup_key so the unique index below can be created without touching its
-- hypothesis text. Recomputed fresh rather than reusing the CTE above: the
-- kept row's confirmation_count is now the group total, which is always >=
-- any individual duplicate's own count (all counts are positive), so it
-- still ranks first here -- same row, same order.
with ranked as (
  select id,
    row_number() over (
      partition by investigation_id, dedup_key
      order by confirmation_count desc, id asc
    ) as rn
  from dead_ends
  where investigation_id is not null
)
update dead_ends d
set dedup_key = d.dedup_key || '#dup-' || d.id::text
from ranked
where d.id = ranked.id and ranked.rn > 1;

create unique index if not exists dead_ends_investigation_dedup_key
  on dead_ends (investigation_id, dedup_key);
