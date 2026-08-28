-- Key shared caches on newsroom_id (who-clicked stays on user_id).
-- Drop leftover newsletter confirm tokens; there is no mailer.

alter table artifact_versions drop constraint if exists artifact_versions_user_id_url_content_hash_key;
alter table source_monitors drop constraint if exists source_monitors_user_id_url_key;
alter table entities drop constraint if exists entities_user_id_canonical_key;
alter table recurring_baselines drop constraint if exists recurring_baselines_user_id_key_key;

create unique index if not exists artifact_versions_newsroom_url_hash
  on artifact_versions (newsroom_id, url, content_hash);
create unique index if not exists source_monitors_newsroom_url
  on source_monitors (newsroom_id, url);
create unique index if not exists entities_newsroom_canonical
  on entities (newsroom_id, canonical);
create unique index if not exists recurring_baselines_newsroom_key
  on recurring_baselines (newsroom_id, key);

alter table subscribers drop column if exists confirm_token;
alter table subscribers drop column if exists status;
