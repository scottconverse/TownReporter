-- An editor's citation-only review of a changed transcript for an unpublished
-- draft. This is append-only history: the draft's original A link and snapshot
-- remain intact while the review records the exact B evidence accepted.
create table if not exists meeting_draft_transcript_revision_reviews (
  id serial primary key,
  newsroom_id integer not null,
  -- Preserve the decision independently of the live draft/link rows. The editor
  -- can still delete a lead to trash; this audit record survives and can be
  -- re-associated if the lead is restored with its original IDs.
  draft_id integer not null,
  draft_link_id integer not null,
  lead_id integer not null,
  draft_headline text not null,
  prior_artifact_id integer not null references meeting_transcript_artifacts(id),
  accepted_artifact_id integer not null references meeting_transcript_artifacts(id),
  prior_artifact_sha256 text not null,
  accepted_artifact_sha256 text not null,
  prior_citation_snapshot text not null,
  accepted_citation_snapshot text not null,
  draft_evidence_sha256 text not null check (draft_evidence_sha256 ~ '^[a-fA-F0-9]{64}$'),
  reviewed_by text not null,
  resolution_note text not null check (length(trim(resolution_note)) > 0),
  reviewed_at timestamptz not null default now(),
  unique (newsroom_id,draft_id,draft_link_id,accepted_artifact_id)
);

create index if not exists meeting_draft_transcript_revision_reviews_history_idx
  on meeting_draft_transcript_revision_reviews (newsroom_id,draft_id,reviewed_at desc);

create or replace function reject_meeting_draft_transcript_review_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'meeting draft transcript review history is append-only';
end;
$$;

drop trigger if exists meeting_draft_transcript_revision_reviews_immutable
  on meeting_draft_transcript_revision_reviews;
create trigger meeting_draft_transcript_revision_reviews_immutable
before update or delete on meeting_draft_transcript_revision_reviews
for each row execute function reject_meeting_draft_transcript_review_mutation();
