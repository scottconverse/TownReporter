create table if not exists routine_notice_automations (
  newsroom_id integer primary key references newsrooms(id) on delete cascade,
  enabled boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  timezone text not null,
  local_time text not null default '06:15',
  today_section text not null,
  weekend_section text not null,
  deadlines_section text not null,
  activated_by text,
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists routine_notice_automation_sources (
  newsroom_id integer not null references routine_notice_automations(newsroom_id) on delete cascade,
  source_id integer not null,
  format_key text not null,
  source_url text not null,
  public_source_url text not null,
  issuer text not null,
  locality text not null,
  collection_area text,
  primary key(newsroom_id, source_id, format_key),
  foreign key(newsroom_id, source_id, format_key)
    references routine_notice_approvals(newsroom_id, source_id, format_key) on delete cascade
);

create table if not exists routine_notice_automation_changes (
  id serial primary key,
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  revision integer not null,
  actor text not null,
  action text not null check(action in ('saved','activated','paused','resumed')),
  detail text not null default '',
  changed_at timestamptz not null default now()
);
create index if not exists routine_notice_automation_changes_room_idx
  on routine_notice_automation_changes(newsroom_id,id desc);

create table if not exists routine_notice_runs (
  id serial primary key, newsroom_id integer not null references newsrooms(id) on delete cascade,
  local_date date not null, automation_revision integer not null, policy_revision integer not null,
  status text not null check(status in ('queued','running','completed','failed','cancelled')),
  actor text not null, summary_json text not null default '{}', created_at timestamptz not null default now(), finished_at timestamptz,
  unique(newsroom_id,local_date,automation_revision)
);
create table if not exists routine_notice_publications (
  id serial primary key, newsroom_id integer not null references newsrooms(id) on delete cascade,
  run_id integer not null references routine_notice_runs(id) on delete restrict,
  channel text not null check(channel in ('today','weekend','deadlines')), issue_date date not null,
  article_id integer references articles(id) on delete set null, content_fingerprint text not null,
  candidate_keys_json text not null default '[]', article_body_hash text not null, created_at timestamptz not null default now(),
  unique(newsroom_id,channel,issue_date)
);
