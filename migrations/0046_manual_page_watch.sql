-- Manual investigative page watching. Additive; capture history is retained.
alter table source_monitors add column if not exists manual_watch boolean not null default false;
alter table source_monitors add column if not exists watch_reason text not null default '';
alter table source_monitors add column if not exists watch_state text not null default 'active';
alter table source_monitors add column if not exists watch_lease text;
alter table source_monitors add column if not exists watch_check_started_at timestamptz;
alter table source_monitors add column if not exists watch_last_readable_version_id integer;
alter table source_monitors add column if not exists watch_model_choice text not null default 'auto';
alter table source_monitors add column if not exists watch_last_error text;
create table if not exists manual_watch_checks (
 id serial primary key, newsroom_id integer not null, monitor_id integer not null,
 capture_event_id integer not null unique, previous_version_id integer,
 state text not null, note text not null default '', created_at timestamptz not null default now()
);
create index if not exists manual_watch_checks_monitor on manual_watch_checks(newsroom_id,monitor_id,id desc);
create table if not exists manual_watch_actions (
 newsroom_id integer not null, check_id integer not null, action text not null,
 target_id integer not null default 0, result_id integer not null default 0,
 created_at timestamptz not null default now(),
 primary key(newsroom_id,check_id,action,target_id)
);
