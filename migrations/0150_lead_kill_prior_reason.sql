-- Release H (walk D2, DHD2-3): remember the kill reason a lead held before its
-- first kill, so Undo puts that reason back. Null when the lead had no reason
-- before the kill, and on leads killed before this migration; the restore keeps
-- whatever reason the lead has then.
alter table leads
  add column if not exists kill_prior_reason text;
