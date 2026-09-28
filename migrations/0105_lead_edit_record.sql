-- Who edited a lead's title, notes or section, and when (0.6.80, design
-- review note 2: "Edit the lead").
--
-- Additive, following 0094_lead_kill_record's precedent: a single action's
-- record lives directly on the row it describes rather than a new history
-- table, because this app has no per-lead edit-history table today and the
-- editor is the only writer (README: "one human editor"). Both columns are
-- nullable with no default -- "not recorded" is the honest answer for every
-- row written before this migration and for a lead nobody has edited since.
alter table leads add column if not exists edited_at timestamptz;
comment on column leads.edited_at is
  'When this lead''s title, notes or section was last changed through Edit the lead. Null = never edited (or edited before 0.6.80).';

alter table leads add column if not exists edited_by text;
comment on column leads.edited_by is
  'The user id that made the last edit through Edit the lead. Null = never edited (or edited before 0.6.80).';
