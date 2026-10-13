alter table editorial_requests
  add column if not exists research_scope text not null default 'public';
