-- Preserve the last attempted public route and newsletter discovery on the source.
alter table sources add column if not exists last_read_method text;
alter table sources add column if not exists last_read_outcome text;
alter table sources add column if not exists last_read_route_url text;
alter table sources add column if not exists newsletter_url text;
