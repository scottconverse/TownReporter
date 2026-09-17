-- Dark Desk F4: dedupe frontier_items and enforce it going forward.
--
-- Live symptom: the same municode Code-of-Ordinances page was saved 7 ways
-- (?nodeId=..., path/case variants) because persistDiscovery's dedup lookup
-- (src/lib/news/investigate.ts) compared raw, uncanonicalized labels. The
-- app now canonicalizes URL-kind labels (canonicalFrontierUrl -- strips www/
-- hash/tracking params/trailing slash AND document-viewer nav params like
-- municode's nodeId) and lowercase/whitespace-normalizes everything else
-- into a new `label_norm` column before every lookup and insert. This
-- migration adds that column, backfills it for existing rows, and DE-COLLIDES
-- existing duplicates (app-level dedup alone cannot fix rows written before
-- this fix shipped) before adding the unique index the app relies on.
--
-- De-collides rather than deletes: this repo's migration runner refuses any
-- statement matching DELETE FROM/TRUNCATE/DROP TABLE (see
-- scripts/no-destructive-migrate.test.mjs -- migrations/ is applied
-- automatically on every build, with no human present, after an earlier
-- incident where a build-time script emptied live tables). So instead of
-- removing duplicate rows, every row EXCEPT the one kept as canonical has
-- its `label_norm` rewritten to a value that includes its own id
-- (`<norm>#dup-<id>`), which can never collide with anything -- the
-- duplicate stays in the table (no data lost, no editor history erased),
-- it simply stops being the dedup target: the kept row is what
-- persistDiscovery's lookup finds from here on. Idempotent: a second run
-- finds every duplicate row already uniquified (its own id is already in
-- its label_norm), so no group has more than one row left to touch.
--
-- Mirrored by the `ensureInvestigateSchema` statement list in
-- src/lib/news/investigate.ts (search "frontier_items_investigation_label_norm"),
-- which does NOT redo this de-collision -- see that file's comment for why
-- (a database reached only through that path is fresh/empty in practice,
-- and the index-creation statement there is best-effort/non-fatal so it
-- never blocks app startup even if it runs before this migration does).

alter table frontier_items add column if not exists label_norm text;

-- Backfill: lower(trim(label)) for every row that doesn't have it yet. This
-- is the same normalization applied to non-URL labels at write time; URL
-- labels written before this migration keep their raw (uncanonicalized)
-- backfilled value here -- they will not all collapse retroactively to the
-- exact canonical form a URL relabel would produce, but this backfill still
-- collapses plain case/whitespace duplicates, and the de-collision step
-- below resolves whatever the backfill does bring together. Going forward
-- every write goes through canonicalFrontierUrl, so new URL variants
-- collapse immediately.
update frontier_items set label_norm = lower(trim(label)) where label_norm is null;

alter table frontier_items alter column label_norm set not null;
alter table frontier_items alter column label_norm set default '';

-- Within each (investigation_id, label_norm) group, keep exactly one row as
-- the dedup target -- preferring a row that has already made progress
-- (reopened/investigating/resolved) over a plain 'open' or already-closed
-- duplicate, and the lowest id as the final tiebreaker. Every OTHER row in
-- the group gets its label_norm suffixed with its own id so it can never
-- collide again.
with ranked as (
  select
    id,
    row_number() over (
      partition by investigation_id, label_norm
      order by
        case status
          when 'reopened' then 0
          when 'investigating' then 1
          when 'resolved' then 2
          when 'exhausted' then 3
          when 'dead-end' then 4
          when 'deferred' then 5
          when 'open' then 6
          else 7
        end,
        id asc
    ) as rn
  from frontier_items
)
update frontier_items f
set label_norm = f.label_norm || '#dup-' || f.id::text
from ranked
where f.id = ranked.id and ranked.rn > 1;

create unique index if not exists frontier_items_investigation_label_norm
  on frontier_items (investigation_id, label_norm);
