-- Paper settings (CITY-SETUP slice A): one row per newsroom overriding the
-- constants shipped in src/lib/paper.ts and src/lib/news/youtube.ts.
--
-- Every column is nullable, and nullable means "use the shipped default" --
-- this table holds overrides, not a second copy of the paper's identity. A
-- fresh Longmont install that never writes a row here behaves exactly as it
-- does today: getPaperConfig() falls back to PAPER / COUNCIL_VOTES_URL /
-- SEED_SOURCES / MEETING_KEYWORDS / LONGMONT_YOUTUBE_CHANNELS field by field.
--
-- Runtime code keeps an idempotent ensure for the PGLite preview (mirrors
-- ensureInviteSchema in src/lib/news/membership.ts); this migration is the
-- real deployment's source of truth, same as every table.
create table if not exists paper_settings (
  id serial primary key,
  newsroom_id integer not null default 1,
  name text,
  city text,
  state text,
  location text,
  timezone text,
  tagline text,
  kicker text,
  deck text,
  trust text,
  council_votes_url text,
  youtube_channels jsonb,
  meeting_keywords jsonb,
  seed_sources jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id)
);
