-- P0-2: saved source packs. A pack is a named, reusable set of accepted
-- sources. Membership is stored by source_id; a pack scan resolves the pack's
-- CURRENT accepted membership at run time, so editing a pack never rewrites a
-- run that already started, and a source that later stops being accepted drops
-- out of the pack automatically.
create table if not exists scan_source_packs (
  id serial primary key,
  user_id text not null,
  newsroom_id integer not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, name)
);

create table if not exists scan_source_pack_members (
  pack_id integer not null references scan_source_packs(id) on delete cascade,
  source_id integer not null references sources(id) on delete cascade,
  newsroom_id integer not null,
  primary key (pack_id, source_id)
);

create index if not exists scan_source_packs_newsroom_idx on scan_source_packs (newsroom_id);
create index if not exists scan_source_pack_members_pack_idx on scan_source_pack_members (pack_id);