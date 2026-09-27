-- Unit BS (hotfix on 0.6.74): the Queue's batch panel could not be put away.
--
-- The panel always loads the newsroom's latest batch, so once a batch was
-- started it sat under "Draft selected" for good -- listing rows for stories
-- that had since been printed. The per-item filter (published and killed
-- stories drop out) answers the rows; this column answers the panel.
--
-- Set once by the Dismiss button and never cleared: it is per batch, so the
-- next batch an editor starts is a new row and shows normally.
alter table draft_batches
  add column if not exists dismissed_at timestamptz;
