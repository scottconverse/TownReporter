-- D169 (Scott, Oct 20 2026: "ALL THREE AGREE"), dynamic sources unit 1.
-- Goals\TownReporter-SPEC-DYNAMIC-SOURCES-2026-10-20.md sections 4 and 10a.
-- sources.status stays the truth; there is no separate state column.
-- This migration only adds room for data. Nothing reads these columns yet
-- except leads.source_id, which the scan now writes for each new lead.

alter table leads add column if not exists source_id integer references sources(id) on delete set null;
create index if not exists leads_source_id_idx on leads (source_id);

alter table sources add column if not exists trial_started_at timestamptz;
alter table sources add column if not exists trial_reads integer not null default 0;
alter table sources add column if not exists next_due_at timestamptz;
alter table sources add column if not exists interval_minutes integer not null default 1440;
alter table sources add column if not exists rhythm text;
alter table sources add column if not exists rhythm_confidence real;
alter table sources add column if not exists dormant_at timestamptz;
alter table sources add column if not exists dormant_reason text;

-- One row per source, written nightly by unit 2 (nothing writes it yet).
create table if not exists source_yield (
  source_id integer primary key references sources(id) on delete cascade,
  newsroom_id integer not null,
  reads_90 integer not null default 0,
  leads_90 integer not null default 0,
  published_90 integer not null default 0,
  killed_90 integer not null default 0,
  bad_source_kills_90 integer not null default 0,
  leads_per_read real,
  published_per_read real,
  last_lead_at timestamptz,
  last_published_at timestamptz,
  computed_at timestamptz not null default now()
);
create index if not exists source_yield_newsroom_idx on source_yield (newsroom_id);
