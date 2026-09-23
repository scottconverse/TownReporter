-- Keep every historical draft-to-transcript link, but identify the one that
-- supports the current saved draft. Redrafting against artifact B must not
-- make historical artifact A look like current publication provenance.
alter table meeting_draft_transcript_links
  add column if not exists is_current boolean not null default false;

with ranked as (
  select id,
         row_number() over (partition by newsroom_id,draft_id order by updated_at desc,id desc) as position
    from meeting_draft_transcript_links
)
update meeting_draft_transcript_links link
   set is_current=(ranked.position=1)
  from ranked
 where ranked.id=link.id;

create unique index if not exists meeting_draft_transcript_links_one_current_uidx
  on meeting_draft_transcript_links (newsroom_id,draft_id)
  where is_current;
