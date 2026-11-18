/*
  Community resources Phase 2, job C2: the entry editor can remove a row from
  an entry and bring it back. A removal is a marker, never a delete: the row
  stays, with who removed it and when, and a restore clears the marker.

  Publish does not publish a removed row, the public Registry page does not
  read it, and an import of the same directory does not bring it back.

  Additive only: two nullable columns on each of seven tables, nothing dropped,
  renamed, filled or made NOT NULL. Every row that exists now has no marker, so
  nothing is removed by this migration. `locations` carries no marker: a place
  can serve several entries, so the editor removes an entry's link to it
  (service_at_locations), not the place.

  removed_by is the editor's user id as text, the way last_verified_by is.
*/
set local lock_timeout = '3s';

alter table contacts add column if not exists removed_at timestamptz;
alter table contacts add column if not exists removed_by text;
alter table service_at_locations add column if not exists removed_at timestamptz;
alter table service_at_locations add column if not exists removed_by text;
alter table schedules add column if not exists removed_at timestamptz;
alter table schedules add column if not exists removed_by text;
alter table eligibilities add column if not exists removed_at timestamptz;
alter table eligibilities add column if not exists removed_by text;
alter table required_documents add column if not exists removed_at timestamptz;
alter table required_documents add column if not exists removed_by text;
alter table languages add column if not exists removed_at timestamptz;
alter table languages add column if not exists removed_by text;
alter table accessibilities add column if not exists removed_at timestamptz;
alter table accessibilities add column if not exists removed_by text;
