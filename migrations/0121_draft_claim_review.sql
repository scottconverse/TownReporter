-- WR1 phase 2: the editor's review mark on a checked claim.
--
-- WHY THIS EXISTS. 0120 gave the story page a claims list -- every figure,
-- date, quote and vote word the whole-meeting writer checked, marked `found` in
-- the meeting record or `flagged` for review. That list is worth nothing if the
-- editor who read a row cannot record that they read it: the next person to
-- open the draft cannot tell a claim nobody has looked at from one an editor
-- checked and accepted. This column is that mark.
--
-- It is nullable on purpose. NULL means "not reviewed yet", which is a real
-- state and not the same as "reviewed": a claim written before this migration
-- reads as unreviewed, and an editor un-checking a row sets it back to NULL.
-- The timestamp is the moment of the check, so the panel can say when, and no
-- separate boolean is needed -- the presence of the timestamp IS the mark.
--
-- Additive and migration-only, like 0120's tables: no runtime ensure writes
-- this column (see the migrations-only note in schema-parity.test.ts).

alter table draft_claims add column if not exists reviewed_at timestamptz;
comment on column draft_claims.reviewed_at is
  'When an editor marked this checked claim reviewed, or NULL for not yet reviewed. The presence of the timestamp is the mark.';
