-- Why a lead was killed, and what a duplicate of it is (0.6.69, unit AK).
--
-- Kill is not delete (desk.ts): a killed lead stays on the desk under Killed.
-- But the row recorded only that it was killed -- no reason, no time, no link
-- -- so the editor who killed it last week, and the editor looking at a new
-- finding against it today, had nothing to read. Two live cases:
--
--   1. A finding that strongly matches a killed lead was DISCARDED and only a
--      counter moved (leads 207/212's neighbour: a killed "juvenile
--      altercation" lead). When the new finding carries facts the killed lead
--      did not have, the desk now files it for review instead of dropping it,
--      and the reviewer needs the old kill reason next to it.
--   2. A lead whose story was already printed showed a bare "≈ PRINTED" chip
--      with no way to act on it. The one-press "Kill as duplicate" writes the
--      reason here, so the killed row can say what it was a duplicate of.
--
-- All four columns are nullable with no default, and that is the honest
-- answer for every row written before this migration: "not recorded". A
-- default of '' would read as "killed for no reason".
alter table leads add column if not exists kill_reason text;
comment on column leads.kill_reason is
  'In the editor''s words, why this lead was killed. Null = killed before 0.6.69 or killed without a reason recorded; the desk says so rather than showing an empty reason.';

alter table leads add column if not exists kill_reason_url text;
comment on column leads.kill_reason_url is
  'A link that backs the kill reason -- the article this lead duplicates, or the page that already covers it. Null = none recorded.';

alter table leads add column if not exists killed_at timestamptz;
comment on column leads.killed_at is
  'When the lead was killed. Null = killed before 0.6.69 (the desk shows the status without a date rather than inventing one).';

alter table leads add column if not exists dup_kind text;
comment on column leads.dup_kind is
  'For a lead filed as a duplicate rather than a story in its own right: ''possible'' (matcher was unsure) or ''developing'' (strong match to a lead you killed, carrying facts that lead lacked). Null = not a duplicate filing.';

-- The Killed and Held tabs read leads by (newsroom_id, status) and the story
-- page follows a possible_duplicate_of link; neither had an index to use.
create index if not exists leads_newsroom_status_idx on leads (newsroom_id, status);
