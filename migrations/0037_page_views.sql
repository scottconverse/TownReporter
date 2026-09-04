-- Anonymous, raw page-view counting (0.6.14). Decoupled from page render on
-- purpose: a client beacon pings a lightweight endpoint AFTER the page has
-- already loaded, so a stats failure can never slow or break a page.
--
-- One row per (newsroom, target, day). `target` is the literal 'site' for
-- the whole paper, or 'story:<slug>' for one published story. Site total and
-- per-story total are SUMs over every day; the 7/30-day views are the same
-- SUM with a `day >= current_date - interval` filter. No IP, no user agent,
-- no cookie, no visitor identity of any kind -- just a count per day.
--
-- Mirrored by `ensureViewsSchema` in src/lib/news/views.ts, which stays so
-- the PGLite and unit-test paths keep working without depending on the
-- migration glob (see migrations/0036_editorial_extras.sql for the same
-- note on this pattern).
create table if not exists page_views (
  newsroom_id integer not null default 1,
  target text not null,
  day date not null,
  count bigint not null default 0,
  primary key (newsroom_id, target, day)
);
create index if not exists page_views_newsroom_target_idx on page_views (newsroom_id, target);
