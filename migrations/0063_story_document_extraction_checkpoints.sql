-- Keep deploy-created story_documents aligned with ensureStoryDocuments.
alter table story_documents add column if not exists extraction_pages text not null default '[]';
