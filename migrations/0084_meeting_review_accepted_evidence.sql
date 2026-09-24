-- Preserve the exact current-transcript evidence and immutable artifact hash
-- that the editor reviewed when marking a published story still accurate.
alter table meeting_article_revision_reviews
  add column if not exists accepted_artifact_sha256 text;

alter table meeting_article_revision_reviews
  add column if not exists accepted_citation_snapshot text;

do $$ begin
  alter table meeting_article_revision_reviews
    add constraint meeting_article_revision_reviews_accepted_evidence_pair_check
    check ((accepted_artifact_sha256 is null) = (accepted_citation_snapshot is null));
exception when duplicate_object then null;
end $$;
