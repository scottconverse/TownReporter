-- Why a source was suggested, and who suggested it (0.6.70).
--
-- The daily scan has proposed sources since it learned to return
-- `proposed_sources`, and production carries 175 of them waiting for review.
-- Every one of those rows says only what the page is called and where it lives.
-- The editor opening the review list has no way to tell a city budget packet
-- from a dance studio's RSS feed without clicking, 175 times, which is the same
-- as never reviewing them at all. The owner's ask (2026-09-24) is that the
-- source list grow over time -- which only works if a person can see, at a
-- glance, what each suggestion offers the paper and which agent found it.
--
-- WHY COLUMNS RATHER THAN A SEPARATE TABLE. A suggestion is a property of the
-- source row, not a second entity: the row already exists, it already has the
-- status that says "not on watch yet", and the accept/reject act is a single
-- update to it. A side table would mean every reader of `sources` joins to
-- learn something the row should have carried, and would have to answer what
-- happens when a suggestion is accepted (the row stays; the suggestion stops
-- being one). Nullable columns answer that for free: null is "not recorded",
-- and the desk says exactly that in words rather than inventing a value.
--
-- `proposed_by` is 'scan' | 'research' | 'dark' | 'editor'. It is deliberately
-- a text column and not a Postgres enum -- the four are a display vocabulary
-- that grows (the research pass and the Dark Desk are the first two added after
-- this migration), and an enum would make each addition a migration that drops
-- nothing and rewrites a type. The desk prints an unknown value as it is
-- rather than failing to render a row.
--
-- `proposed_scan_run_id` and `proposed_lead_id` carry no foreign key on
-- purpose, the same call 0095 made for `correction_id`: scan runs are pruned,
-- and a suggestion that lost its provenance link would become an orphan row
-- nothing could explain. They are the "where did this come from" the editor
-- needs to judge it, not a constraint the database has to police.
--
-- `proposed_section` is the model's guess at where the source belongs. It is
-- advisory: accepting it files the source under the section the editor
-- confirms, which may be a different one, and the section link itself still
-- lives in `section_sources` and is still written only by the owner.
--
-- `reviewed_at` and `review_note` are the record of the decision. A rejected
-- suggestion keeps its reason, so "why was this dropped?" is answerable later;
-- an accepted one keeps the note that came with the accept.
--
-- Additive and nullable-only: nothing existing is rewritten, no read path is
-- required to change, and the 175 rows already proposed read as "not recorded"
-- until they are reviewed.
alter table sources add column if not exists proposed_reason text;
alter table sources add column if not exists proposed_by text;
alter table sources add column if not exists proposed_scan_run_id integer;
alter table sources add column if not exists proposed_lead_id integer;
alter table sources add column if not exists proposed_section text;
alter table sources add column if not exists reviewed_at timestamptz;
alter table sources add column if not exists review_note text;

comment on column sources.proposed_reason is
  'One sentence, from the model that found the page, on what it offers the paper. Null means not recorded (every row proposed before 0.6.70).';
comment on column sources.proposed_by is
  'Who suggested this source: scan | research | dark | editor. Null means not recorded.';
comment on column sources.proposed_scan_run_id is
  'The scan run that proposed this source. No foreign key: runs are pruned and the suggestion outlives them.';
comment on column sources.proposed_lead_id is
  'The lead the suggestion came from, when one did. Null when the source was found without a lead.';
comment on column sources.proposed_section is
  'The section the model guessed this source belongs in. Advisory only -- section_sources holds the real filing, written when the owner confirms it.';
comment on column sources.reviewed_at is
  'When a person accepted or rejected this suggestion. Null means nobody has decided yet.';
comment on column sources.review_note is
  'The note left with the accept or reject. Null when the reviewer left none.';

-- The review list is "everything still waiting, newest first" for one newsroom,
-- which is the one read this table does not already have an index for.
create index if not exists sources_proposed_review_idx
  on sources (newsroom_id, id desc)
  where status = 'proposed';
