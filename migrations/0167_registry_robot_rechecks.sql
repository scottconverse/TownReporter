/*
  The robot recheck (Scott's Nov 20 2026 order: "Every so often we need to go
  through and recheck everything.")

  A published service now keeps the time the scan's nightly robot pass last
  opened its source page and what the pass found there. These columns are
  deliberately separate from `last_verified_at` and `resource_verifications`:
  a robot recheck is not an editor's check, and nothing here may ever be read
  as one.

  registry_rechecks keeps one row per attempt, so the desk can say why an entry
  is on the "Source gone" list and how many rechecks it has had. A failed fetch
  is a row with result 'failed'; a service's robot_check_result keeps its last
  settled answer ('same', 'changed' or 'source_gone') until a later recheck
  settles it again.

  Additive only: four nullable/defaulted columns and one new table.
*/
set local lock_timeout = '3s';

alter table services add column if not exists robot_checked_at timestamptz;
alter table services add column if not exists robot_check_result text
  check (robot_check_result in ('same', 'changed', 'source_gone'));
-- Consecutive "source gone" failures. A single failure is recorded but does not
-- unpublish; the second failure, at least three days after the first, does.
alter table services add column if not exists robot_failures integer not null default 0;
alter table services add column if not exists robot_first_failure_at timestamptz;

create table if not exists registry_rechecks (
  id bigserial primary key,
  newsroom_id integer not null,
  service_id integer not null references services(id) on delete cascade,
  checked_at timestamptz not null default now(),
  result text not null check (result in ('same', 'changed', 'source_gone', 'failed')),
  source_url text,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists registry_rechecks_service_idx
  on registry_rechecks (newsroom_id, service_id, checked_at desc);
create index if not exists registry_rechecks_recent_idx
  on registry_rechecks (newsroom_id, checked_at desc);
