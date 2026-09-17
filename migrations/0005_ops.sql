create table if not exists desk_rate (
  id serial primary key,
  user_id text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists desk_rate_lookup on desk_rate (user_id, action, created_at desc);

create table if not exists audit_events (
  id serial primary key,
  user_id text not null,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_events_user_idx on audit_events (user_id, created_at desc);

alter table subscribers add column if not exists status text not null default 'pending';
alter table subscribers add column if not exists confirm_token text;
