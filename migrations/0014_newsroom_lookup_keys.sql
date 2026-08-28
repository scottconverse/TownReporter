-- URL history, watches, cadence, and names belong to the newsroom, not who clicked.

alter table artifact_versions add column if not exists newsroom_id integer not null default 1;
alter table source_monitors add column if not exists newsroom_id integer not null default 1;
alter table recurring_baselines add column if not exists newsroom_id integer not null default 1;
alter table entities add column if not exists newsroom_id integer not null default 1;
alter table capture_events add column if not exists newsroom_id integer not null default 1;

alter table artifact_versions drop constraint if exists artifact_versions_user_id_url_content_hash_key;
drop index if exists artifact_versions_user_id_url_content_hash_key;
create unique index if not exists artifact_versions_newsroom_url_hash
  on artifact_versions (newsroom_id, url, content_hash);

alter table entities drop constraint if exists entities_user_id_canonical_key;
drop index if exists entities_user_id_canonical_key;
create unique index if not exists entities_newsroom_canonical
  on entities (newsroom_id, canonical);

alter table source_monitors drop constraint if exists source_monitors_user_id_url_key;
drop index if exists source_monitors_user_id_url_key;
create unique index if not exists source_monitors_newsroom_url
  on source_monitors (newsroom_id, url);

alter table recurring_baselines drop constraint if exists recurring_baselines_user_id_key_key;
drop index if exists recurring_baselines_user_id_key_key;
create unique index if not exists recurring_baselines_newsroom_key
  on recurring_baselines (newsroom_id, key);
