-- Unit CJ (0.6.80): first-owner setup code + owner recovery codes.
--
-- Additive only. 0102 was skipped on purpose earlier; this was originally cut
-- as 0105 (the next free number after 0104_draft_batch_dismissed.sql) and
-- renumbered to 0106 because Unit CC took 0105_lead_edit_record.sql on a
-- parallel 0.6.80 branch first.
--
-- owner_setup_code: a single row (id = 1, mirroring newsroom_members' own
-- one-owner intent) holding the hash of the one-time code printed for the
-- first owner. No plaintext ever touches this table.
create table if not exists owner_setup_code (
  id integer primary key,
  code_hash text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

-- owner_recovery_code: ten one-time codes per newsroom, shown once, stored
-- only as hashes. used_at/used_by double as the use log the task asked for --
-- who and when, never the code itself.
create table if not exists owner_recovery_code (
  id serial primary key,
  newsroom_id integer not null default 1,
  code_hash text not null unique,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by text
);

create index if not exists owner_recovery_code_newsroom_idx
  on owner_recovery_code (newsroom_id);
