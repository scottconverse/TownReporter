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
-- Existing orphans are evidence of an earlier lifecycle defect. Preserve and
-- inventory them rather than erasing them inside a migration. The NOT VALID
-- foreign key protects every new/changed row and cascades valid draft deletes;
-- a reviewed repair can later resolve the quarantined historical rows and
-- validate the constraint.
create table if not exists meeting_draft_transcript_link_orphans (
  link_id integer primary key,
  newsroom_id integer not null,
  draft_id integer not null,
  artifact_id integer not null,
  citation_snapshot text not null,
  revision_notice text,
  original_created_at timestamptz,
  original_updated_at timestamptz,
  inventoried_at timestamptz not null default now()
);

insert into meeting_draft_transcript_link_orphans
  (link_id,newsroom_id,draft_id,artifact_id,citation_snapshot,revision_notice,original_created_at,original_updated_at)
select l.id,l.newsroom_id,l.draft_id,l.artifact_id,l.citation_snapshot,l.revision_notice,l.created_at,l.updated_at
  from meeting_draft_transcript_links l
 where not exists (select 1 from drafts d where d.id=l.draft_id)
on conflict (link_id) do nothing;

alter table meeting_draft_transcript_links
  drop constraint if exists meeting_draft_transcript_links_draft_id_fkey;

alter table meeting_draft_transcript_links
  add constraint meeting_draft_transcript_links_draft_id_fkey
  foreign key (draft_id) references drafts(id) on delete cascade not valid;

