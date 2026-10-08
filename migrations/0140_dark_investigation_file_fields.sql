alter table investigations add column if not exists ordinary_explanation text not null default '';
alter table investigations add column if not exists scope_json text not null default '{"scope":"city"}';
alter table investigations add column if not exists limit_key text not null default 'standard' check (limit_key in ('quick', 'standard', 'deep'));
alter table investigations add column if not exists limit_minutes integer not null default 120 check (limit_minutes > 0);
alter table investigations add column if not exists limit_dollars numeric check (limit_dollars is null or limit_dollars >= 0);
