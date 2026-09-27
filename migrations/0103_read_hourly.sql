-- 0103_read_hourly.sql -- aggregate reading time, the privacy-safe way.
--
-- WHAT THIS IS. The page-load counter (0037_page_views.sql) answers "how many
-- times was this page loaded". It cannot answer "how long was it read", "how
-- far down did they get", "did they come from search or from a text message",
-- or "which of the paper's own buttons did anyone actually press" -- and the
-- Stats redesign (docs/design/handoff-2026-09-26/README.md:370) asks for all
-- four.
--
-- WHAT IT MUST NEVER BE. Not a visitor log. There is no IP column, no
-- user-agent column, no cookie value, no session id, no per-reader row of any
-- kind -- and there cannot be one, because nothing that identifies a reader is
-- ever sent to the server to store. The beacon (src/lib/news/reading.ts,
-- src/components/read-beacon.tsx) sends a PATH, a REFERRER CLASS out of eight
-- fixed words, a DEVICE CLASS out of three, a duration in whole seconds and a
-- set of scroll-depth buckets. Each row below is the sum of those over one
-- hour, and an hour on a small paper holds many readers, so a row is nobody.
--
-- WHY AN HOUR. Coarser than an hour and "busiest time of day" (the heatmap)
-- stops being answerable; finer than an hour and a row with one reader in it
-- starts to be a fact about that reader's evening. An hour is the bucket the
-- approved drawing is drawn in (docs/design/handoff-2026-09-26/design/Desk
-- Stats.dc.html, "When people read").
--
-- "READING RIGHT NOW" IS NOT HERE, ON PURPOSE. Live readers live in an
-- in-memory rolling window on the server (src/lib/news/reading-live.ts) and
-- are never written down. Nothing in this table can be joined back to a
-- person, and there is nothing else in the database to join it to.
--
-- Mirrored for tests and for a database that never ran migrations by
-- `ensureReadingSchema()` in src/lib/news/reading.server.ts. The two must stay
-- column-for-column identical -- src/lib/news/schema-parity.test.ts fails if
-- they drift.

create table if not exists read_hourly (
  newsroom_id integer not null default 1,
  -- The top of the hour, as an instant. Read back with extract(hour from ...)
  -- and hour_start::date in the session's timezone, the same calendar the
  -- existing page_views.day is written on.
  hour_start timestamptz not null,
  -- A canonical path: "/" for the front page, "/articles/<slug>" for a
  -- published story, or one of a short list of the paper's own standing pages.
  -- Anything else is refused by the beacon handler, so this column cannot be
  -- used to mint an arbitrary bucket.
  path text not null,
  -- One of: search, share, facebook, reddit, direct, local, rss, internal.
  ref_class text not null,
  -- One of: phone, tablet, computer -- from the viewport width, at this class.
  device text not null,
  -- Every page load the beacon reported, including the ones that arrived from
  -- another page of this same paper.
  loads bigint not null default 0,
  -- The subset of those loads that "arrived from outside the site" (Q6,
  -- DECISIONS.md:90): ref_class is not 'internal'.
  visits bigint not null default 0,
  -- Arrived here from one of the paper's own article pages ("Read another
  -- story").
  recirc bigint not null default 0,
  -- Loads whose total active time was under ten seconds.
  left_early bigint not null default 0,
  active_seconds bigint not null default 0,
  -- How many loads reached each scroll-depth bucket (25/50/75/100 percent).
  -- Each bucket is counted once per load, so depth_75 <= depth_50 <= depth_25
  -- <= loads holds for every row.
  depth_25 bigint not null default 0,
  depth_50 bigint not null default 0,
  depth_75 bigint not null default 0,
  depth_100 bigint not null default 0,
  primary key (newsroom_id, hour_start, path, ref_class, device)
);

create index if not exists read_hourly_newsroom_hour_idx
  on read_hourly (newsroom_id, hour_start desc);

-- The paper's own controls, counted the same way: presses, not people. One row
-- per (hour, event), where event is one of the eight names in
-- src/lib/news/reading.ts's TRUST_EVENTS. "RSS feed fetches per day" is
-- counted server-side in src/routes/feed.ts; the other seven are counted by
-- the same anonymous beacon that counts reading.
create table if not exists trust_signals_hourly (
  newsroom_id integer not null default 1,
  hour_start timestamptz not null,
  event text not null,
  count bigint not null default 0,
  primary key (newsroom_id, hour_start, event)
);

create index if not exists trust_signals_hourly_newsroom_hour_idx
  on trust_signals_hourly (newsroom_id, hour_start desc);
