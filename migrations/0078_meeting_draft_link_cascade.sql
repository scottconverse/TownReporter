-- A link between a meeting draft and its transcript must die with the draft.
--
-- meeting_draft_transcript_links has carried a foreign key on artifact_id since
-- migration 0070, with ON DELETE CASCADE, but none on draft_id -- it is a plain
-- integer with a NOT NULL. That covers the wrong side of the relation. The row
-- describes a DRAFT that cited a tape, so it should live and die with the draft.
--
-- Found by running the chain against the real database: deleting the draft left
-- its link row behind. An orphaned link is not merely untidy. recheckProvisionalMeetings
-- selects links with no revision_notice and compares their citation hashes against
-- the current caption hash, so every orphan is examined on every capture pass and,
-- when the tape has moved, produces a revision notice about a draft that no longer
-- exists.
--
-- The delete is written defensively: rows whose draft has already gone are removed
-- first, so the constraint can be added on a database that has run this code before
-- the constraint existed.

delete from meeting_draft_transcript_links l
 where not exists (select 1 from drafts d where d.id = l.draft_id);

alter table meeting_draft_transcript_links
  drop constraint if exists meeting_draft_transcript_links_draft_id_fkey;

alter table meeting_draft_transcript_links
  add constraint meeting_draft_transcript_links_draft_id_fkey
  foreign key (draft_id) references drafts(id) on delete cascade;

