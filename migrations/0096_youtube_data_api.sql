-- The YouTube key, and what the day has spent on Google's official API (0.6.70).
--
-- The desk has read YouTube by scraping the channel tab and the public RSS
-- feed, with a yt-dlp listing as the last resort. All three are unofficial:
-- they break when YouTube reshapes its HTML, and the feed can lag a stream by
-- hours. The owner has a YouTube Data API v3 key now, so the official service
-- becomes the first choice and the scrapers become the fallback.
--
-- Two tables, both additive, no defaults changed on anything existing.
--
-- 1. youtube_api_settings holds ONE row per newsroom. The key is encrypted by
--    the server before insertion, with the same helper the custom AI
--    connections use (AES-256-GCM under BETTER_AUTH_SECRET), and is never
--    returned through a client DTO -- the desk reads back "A key is saved",
--    never the key. That is why this is its own table rather than a column on
--    paper_settings: paper settings are read whole and handed to the desk as
--    one object, and a credential must not be able to ride along in it.
--
--    `quota_blocked_day` is the Pacific calendar day (YYYY-MM-DD) on which
--    Google answered "quotaExceeded". Google resets the quota at midnight
--    Pacific, so on that day the desk stops asking and reads the public feed
--    instead; the next Pacific day the column no longer matches and the API is
--    tried again. Null = no quota refusal on record.
--
-- 2. youtube_api_usage counts units per newsroom per Pacific day. Each call
--    this code makes costs 1 unit (channels.list, playlistItems.list,
--    videos.list -- none of them is search.list, which costs 100). The desk
--    shows the running total next to the key box so an editor can see a scan
--    eating into the 10,000 free units before it happens.
--
-- The day columns are text, not date, and hold the PACIFIC day explicitly.
-- A date column would be interpreted in whatever timezone the server happens
-- to run in, which is exactly the thing that has to be pinned here.
create table if not exists youtube_api_settings (
  newsroom_id integer primary key,
  encrypted_api_key text,
  quota_blocked_day text,
  updated_at timestamptz not null default now()
);

comment on table youtube_api_settings is
  'One row per newsroom: the encrypted YouTube Data API key and the Pacific day Google last refused for quota.';
comment on column youtube_api_settings.encrypted_api_key is
  'AES-256-GCM under BETTER_AUTH_SECRET, same helper as custom_ai_connections. Never returned to a client. Null = no key saved.';
comment on column youtube_api_settings.quota_blocked_day is
  'Pacific calendar day (YYYY-MM-DD) Google answered quotaExceeded on. Matches today -> read the public feed, do not call the API. Null = no refusal on record.';

create table if not exists youtube_api_usage (
  newsroom_id integer not null,
  day text not null,
  units integer not null default 0,
  primary key (newsroom_id, day)
);

comment on table youtube_api_usage is
  'YouTube Data API units spent per newsroom per Pacific day. 10,000 units a day are free; every call this code makes costs 1.';
comment on column youtube_api_usage.day is
  'Pacific calendar day (YYYY-MM-DD), stored as text so no server timezone can reinterpret it.';
