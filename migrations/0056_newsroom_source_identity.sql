alter table sources drop constraint if exists sources_user_id_url_key;

create unique index if not exists sources_user_newsroom_url_key
  on sources(user_id, newsroom_id, url);
