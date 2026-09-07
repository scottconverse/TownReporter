-- Preserve each existing editor's records while allowing that editor to
-- investigate the same names independently in another newsroom.
-- Existing ownership is retained; this does not guess historical room IDs.
create unique index if not exists entity_aliases_newsroom_user_names
  on entity_aliases (newsroom_id, user_id, canonical, alias);
alter table entity_aliases drop constraint if exists entity_aliases_user_id_canonical_alias_key;
drop index if exists entity_aliases_user_id_canonical_alias_key;

create unique index if not exists entity_matches_newsroom_user_names
  on entity_matches (newsroom_id, user_id, left_canonical, right_canonical);
alter table entity_matches drop constraint if exists entity_matches_user_id_left_canonical_right_canonical_key;
drop index if exists entity_matches_user_id_left_canonical_right_canonical_key;
