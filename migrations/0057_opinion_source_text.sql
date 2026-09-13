alter table editorial_requests
  add column if not exists source_text text not null default '';
