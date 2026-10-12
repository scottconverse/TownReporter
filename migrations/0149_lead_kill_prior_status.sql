-- Release H (walk C, DHC06): remember the status a lead held when it was killed,
-- so Undo and "Bring back" restore it (drafted stays drafted, held stays held).
-- Null on every lead that was never killed, and on leads killed before this
-- migration; the restore falls back to `new` for those.
alter table leads
  add column if not exists kill_prior_status text;
