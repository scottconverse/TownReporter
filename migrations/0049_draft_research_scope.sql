-- Freeze each queued draft's editorial scope across worker restarts/retries.
alter table desk_jobs add column if not exists research_scope text not null default 'public';
