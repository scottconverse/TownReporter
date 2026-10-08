create table if not exists source_scan_preferences (
  newsroom_id integer not null references newsrooms(id) on delete cascade,
  source_id integer not null references sources(id) on delete cascade,
  purpose text check (purpose is null or purpose in ('watch', 'reference', 'unknown')),
  cadence text check (cadence is null or cadence in ('daily', 'weekly', 'monthly', 'as-needed')),
  deadline date,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (newsroom_id, source_id)
);
