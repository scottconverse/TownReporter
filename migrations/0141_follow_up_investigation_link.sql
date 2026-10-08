alter table follow_ups add column if not exists investigation_id integer;
create index if not exists follow_ups_newsroom_investigation_idx
  on follow_ups (newsroom_id, investigation_id);
