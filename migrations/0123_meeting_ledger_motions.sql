-- WR1 fixes round 2: every vote an item holds, not just the first.
--
-- WHY THIS EXISTS. Round 1 stored one vote_result and one vote_tally per ledger
-- item -- the FIRST result phrase the scan found under it. On the real Sept. 29,
-- 2026 run that lost the shape of the meeting: the airport noise-abatement
-- presentation (agenda item 6A) carries three separate unanimous votes, and the
-- item that held them could only ever report one. The story's strength is how
-- many decisions the meeting made, and the ranking that chooses the lead has to
-- count them, so an item keeps a LIST of its motions, each with its own result
-- and tally.
--
-- ONE ADDITIVE COLUMN ON `meeting_ledger_items` (migrations-only table; no
-- ensure counterpart, see the note in schema-parity.test.ts):
--
--   motions  the vote results the scan found under this item, in tape order, as
--            an array of { result, tally, unanimous, seconds }. `vote_result`
--            and `vote_tally` (migration 0122) stay as the first motion, so
--            older readers and the claims check are unchanged. Empty for an
--            item the tape recorded no vote for.
--
-- No other column moves. The grouping that feeds this -- by the agenda id the
-- reading pass tags each line with -- is code, not schema: see `buildLedger`
-- and `mergeNearDuplicates` in meeting-whole.ts.

alter table meeting_ledger_items
  add column if not exists motions jsonb not null default '[]'::jsonb;
comment on column meeting_ledger_items.motions is
  'Every vote result the scan found under this item, in tape order, as JSON array of {result,tally,unanimous,seconds}. vote_result/vote_tally hold the first motion for older readers. Empty when the tape recorded no vote.';
