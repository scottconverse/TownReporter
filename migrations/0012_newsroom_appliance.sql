-- Single-newsroom appliance: one newsroom, members share it, user_id is who clicked.
-- Additive. Existing rows backfill to newsroom 1. Owner uniqueness stops the two-owner race.

create table if not exists newsrooms (
  id serial primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into newsrooms (id, name)
values (1, 'TownReporter Longmont')
on conflict (id) do nothing;

alter table newsroom_members add column if not exists newsroom_id integer not null default 1;
create unique index if not exists newsroom_members_one_owner
  on newsroom_members (newsroom_id) where role = 'owner';

alter table sources add column if not exists newsroom_id integer not null default 1;
alter table snapshots add column if not exists newsroom_id integer not null default 1;
alter table scan_runs add column if not exists newsroom_id integer not null default 1;
alter table leads add column if not exists newsroom_id integer not null default 1;
alter table drafts add column if not exists newsroom_id integer not null default 1;
alter table articles add column if not exists newsroom_id integer not null default 1;
alter table beat_memory add column if not exists newsroom_id integer not null default 1;
alter table corrections add column if not exists newsroom_id integer not null default 1;
alter table investigations add column if not exists newsroom_id integer not null default 1;
alter table artifacts add column if not exists newsroom_id integer not null default 1;
alter table artifact_versions add column if not exists newsroom_id integer not null default 1;
alter table artifact_versions add column if not exists extracted_sha256 text;
alter table artifact_versions add column if not exists raw_sha256 text;
alter table capture_events add column if not exists newsroom_id integer not null default 1;
alter table artifact_blobs add column if not exists newsroom_id integer not null default 1;
alter table artifact_chunks add column if not exists newsroom_id integer not null default 1;
alter table source_monitors add column if not exists newsroom_id integer not null default 1;
alter table dark_runs add column if not exists newsroom_id integer not null default 1;
alter table dark_signals add column if not exists newsroom_id integer not null default 1;
alter table dark_promises add column if not exists newsroom_id integer not null default 1;
alter table desk_rate add column if not exists newsroom_id integer not null default 1;
alter table audit_events add column if not exists newsroom_id integer not null default 1;
