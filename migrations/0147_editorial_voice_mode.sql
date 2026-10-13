alter table editorial_requests
  add column if not exists voice_mode text not null default 'paper';
