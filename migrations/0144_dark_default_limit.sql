alter table dark_settings
  add column if not exists default_limit_key text not null default 'standard'
  check (default_limit_key in ('quick', 'standard', 'deep'));
