-- Unit U17b (owner decision 2026-09-30): reader location and a daily visitor
-- count, both coarse enough that a row is a place or a day and never a person.
--
-- NUMBERING. 0108 was taken on a parallel branch in flight; this is 0109 so the
-- directory keeps one file per number. 0102 was skipped the same way earlier.
--
-- WHY TWO TABLES AND NOT A COLUMN ON read_hourly.
--
--   location_daily  A reader's city, counted once per day. It cannot live on
--                   read_hourly: that table is keyed by the HOUR, and an hour
--                   bucket for a small town holds one or two readers -- which
--                   migrations/0103_read_hourly.sql:15 refuses in as many
--                   words. A day is the coarsest grain that still draws the
--                   accepted "where readers are" panel, and the panel only
--                   prints a place at all once LOCATION_MIN_VISITS (25) visits
--                   have been counted there in the selected range.
--
--   visitor_daily   One integer per day: how many distinct readers the server
--                   could tell apart that day. It is a per-day property, so it
--                   cannot be a column on an hour-keyed table either (a reader
--                   seen at 10am and again at 2pm is one visitor, not two), and
--                   it must be counted even when NO location header arrived, so
--                   it cannot live on location_daily.
--
-- WHAT IS NOT HERE, AND CANNOT BE. Both tables are counters. There is no
-- column for an IP address, a user agent, a cookie, a session, a fingerprint,
-- a device, or any per-reader value -- and none could be added without failing
-- src/lib/news/reading.server.test.ts (which asserts these column lists
-- exactly) and src/lib/news/schema-parity.test.ts (which diffs this file
-- against the runtime ensure* mirror written in
-- src/lib/news/reading.server.ts, column type, nullability, default and index
-- for index).
--
-- THE VISITOR COUNT HAS NO TABLE OF ITS OWN, ON PURPOSE. The server tells two
-- readers apart for one day with an HMAC held in process memory and thrown
-- away -- the salt rotates at day rollover and dies with the process
-- (src/lib/news/stats-visitors.server.ts). Nothing derived from an IP ever
-- reaches a query, a file or a log line: the only thing this schema stores is
-- the integer those handles produced.
--
-- RETENTION. location_daily is pruned at twelve months -- the longest range
-- the Stats screen offers ("12 months", src/lib/news/reading.ts) -- by
-- pruneLocationDaily() on the existing hourly unattended tick. visitor_daily
-- is an aggregate like page_views and read_hourly and is kept indefinitely,
-- the same as they are. Neither table is deleted at any other time.

create table if not exists location_daily (
  newsroom_id integer not null default 1,
  -- The day the visits were counted on, in the database session's calendar --
  -- the same one page_views.day and read_hourly's hour_start are written on.
  day date not null,
  -- ISO-3166 alpha-2, uppercased. Never a region, a latitude, a longitude, a
  -- postal code or a timezone: Cloudflare can send all five and this table has
  -- a column for none of them (see the allowlist in stats-privacy.ts).
  country text not null,
  -- A city name, validated and length-capped before it is ever bound to a
  -- query. "unknown" is the fold for a country that arrived with no usable
  -- city beside it.
  city text not null,
  -- Arrivals filed under this (day, country, city). Not readers.
  visits bigint not null default 0,
  primary key (newsroom_id, day, country, city)
);

-- No separate index. Every read is "this newsroom, this day range", which is a
-- prefix of the primary key above -- the same reason read_hourly's own extra
-- index (0103) could not have been omitted had its key not put hour_start
-- third.

create table if not exists visitor_daily (
  newsroom_id integer not null default 1,
  day date not null,
  -- Distinct readers the server could distinguish that day, as an ESTIMATE:
  -- the in-memory handle set empties on every restart and is one process wide,
  -- so this under-counts. The screen says so beside the number rather than
  -- printing it as a headcount.
  visitors bigint not null default 0,
  primary key (newsroom_id, day)
);
