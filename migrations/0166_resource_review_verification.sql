/*
  Community resources Phase 3: proposal review and explicit verification.

  resource_verifications is a new record of a check an editor made of one entry
  (who, when, how, on what basis, and a snapshot of the entry's key facts). It
  is separate from the older last_verified_* columns, which are left exactly as
  they are: their values were set by saves and publishes, not by a check.

  resource_changes gains the editor's note and the time a proposal was applied
  to the entry (null when it was accepted without applying).

  Additive only: one new table, two new nullable columns. No existing column,
  constraint or row is touched.
*/
set local lock_timeout = '3s';

create table if not exists resource_verifications (
  id bigserial primary key,
  newsroom_id integer not null,
  service_id integer not null references services(id) on delete cascade,
  checked_at timestamptz not null default now(),
  checked_by text not null,
  method text not null
    check (method in ('phone', 'website', 'visit', 'email', 'document', 'organization')),
  basis text not null check (char_length(basis) between 1 and 2000),
  source_url text,
  facts jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists resource_verifications_service_idx
  on resource_verifications (newsroom_id, service_id, checked_at desc);

alter table resource_changes add column if not exists review_note text;
alter table resource_changes add column if not exists applied_at timestamptz;
