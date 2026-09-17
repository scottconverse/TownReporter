create table if not exists routine_notice_policies (
  newsroom_id integer primary key references newsrooms(id) on delete cascade,
  paused boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  updated_by text,
  updated_at timestamptz
);

create table if not exists routine_notice_approvals (
  newsroom_id integer not null references routine_notice_policies(newsroom_id) on delete cascade,
  source_id integer not null references sources(id) on delete cascade,
  source_url text not null,
  format_key text not null check (format_key in ('library-notice','parks-recreation-notice','community-arts-event-logistics','registration-deadline','waste-recycling-schedule','public-meeting-logistics')),
  primary key (newsroom_id, source_id, format_key)
);

create table if not exists routine_notice_policy_changes (
  id serial primary key,
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  revision integer not null,
  actor text not null,
  action text not null check (action in ('approved','revoked','paused','resumed','saved')),
  source_id integer,
  source_url_hash text,
  format_key text,
  changed_at timestamptz not null default now()
);

create index if not exists routine_notice_policy_changes_room_idx
  on routine_notice_policy_changes(newsroom_id, id desc);
