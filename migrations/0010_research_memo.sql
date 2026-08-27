-- Editor-only reporting notes from Draft with AI. Never printed.
alter table drafts add column if not exists research_json text not null default '{}';
