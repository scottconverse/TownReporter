-- WR1 fixes round 3: rank by explained resident impact, not by count.
--
-- WHY THIS EXISTS. The first ranking chose the lead by how many votes an item
-- held, then by dollars mentioned, then by tape seconds. That made the meeting
-- a vote-count contest: a routine item with three roll-call votes could outrank
-- the one decision that actually changes residents' lives, and a dollar figure
-- mentioned in passing could drag an unrelated item into its own section. The
-- editor needs worthwhile news and understandable evidence, so the lead and the
-- secondary sections are now chosen by the civic-scanner editorial control:
-- four dimensions scored 1-5 each -- immediacy, local impact, conflict, novelty
-- -- totalling 4-20, with the reason kept for every dimension.
--
-- ONE ADDITIVE COLUMN ON `meeting_ledger_items` (migrations-only table; no
-- ensure counterpart, see the note in schema-parity.test.ts):
--
--   impact  the model's explanation of why this item matters to residents, as
--           {"immediacy","impact","conflict","novelty","*Reason","total"}. NULL
--           when the item was never scored, or the model returned a dimension
--           that was missing or invalid -- an unscored item stays UNRANKED and
--           never gets a fabricated zero. Every action is still written to the
--           ledger whatever its score, so a demoted item is accounted for.
--
-- No other column moves. The thresholds (10-20 advance, 7-9 hold, 4-6 demote)
-- and the parsing live in meeting-impact.ts; the ranking that consumes them is
-- in meeting-whole.ts.

alter table meeting_ledger_items
  add column if not exists impact jsonb;
comment on column meeting_ledger_items.impact is
  'Editorial impact score for this item as JSON {immediacy,impact,conflict,novelty,*Reason,total}, each dimension 1-5 and total 4-20. NULL means never scored or invalid, so the item is unranked rather than scored zero.';
