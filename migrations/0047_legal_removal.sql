alter table articles add column if not exists origin_draft_id integer;

alter table audit_events add column if not exists subject_kind text;

alter table audit_events add column if not exists subject_id integer;

create table if not exists legal_removal_rooms(newsroom_id integer primary key);

create table if not exists legal_removals(id text primary key, newsroom_id integer not null,
    requested_by text not null, case_ref text not null, policy text not null check(policy in ('retain','destroy')),
    created_at timestamptz not null default now(), expires_at timestamptz, purged_at timestamptz,
    review_pending boolean not null default true, counts_json text not null default '{}');

create table if not exists legal_removal_copies(case_id text primary key references legal_removals(id) on delete cascade,
    payload text not null);

create table if not exists legal_removal_targets(newsroom_id integer not null, table_name text not null,
    row_id integer not null, case_id text not null references legal_removals(id),
    primary key(newsroom_id,table_name,row_id));

create table if not exists legal_removal_slugs(newsroom_id integer not null, slug_hash text not null,
    case_id text not null references legal_removals(id), primary key(newsroom_id,slug_hash));

create table if not exists legal_removal_urls(newsroom_id integer not null, url_hash text not null,
    case_id text not null references legal_removals(id), primary key(newsroom_id,url_hash));

create table if not exists legal_removal_events(id serial primary key, case_id text not null references legal_removals(id),
    actor text not null, action text not null, created_at timestamptz not null default now());

create table if not exists legal_removal_backups(id serial primary key, case_id text not null references legal_removals(id),
    identifier text not null, confirmed_by text, confirmed_at timestamptz, created_at timestamptz not null default now());

create or replace function prevent_legal_resurrection() returns trigger language plpgsql as $$
   declare row_json jsonb; room integer; candidate jsonb; part jsonb;
   begin
    row_json:=to_jsonb(NEW); room:=(row_json->>'newsroom_id')::integer;
    insert into legal_removal_rooms(newsroom_id) values(room) on conflict do nothing;
    perform newsroom_id from legal_removal_rooms where newsroom_id=room for share;
    if exists(select 1 from legal_removal_targets where newsroom_id=room and (
      (table_name=TG_TABLE_NAME and row_id=(row_json->>'id')::integer)
      or (table_name='leads' and row_id=(row_json->>'lead_id')::integer)
      or (table_name='articles' and row_id=(row_json->>'article_id')::integer)
      or (table_name='drafts' and row_id=coalesce((row_json->>'draft_id')::integer,(row_json->>'origin_draft_id')::integer))
      or (table_name='leads' and row_json->>'kind'='draft' and row_id=(row_json->>'subject_id')::integer)
      or (table_name='editorial_requests' and row_json->>'kind'='editorial' and row_id=(row_json->>'subject_id')::integer)
      or (table_name=row_json->>'subject_kind' and row_id=(row_json->>'subject_id')::integer)))
    then raise exception 'This record is covered by a legal removal and cannot be restored or filed.'; end if;
    if TG_TABLE_NAME='articles' and exists(select 1 from legal_removal_slugs
      where newsroom_id=room and slug_hash=md5(row_json->>'slug'))
    then raise exception 'This article address is covered by a legal removal.'; end if;
    if TG_TABLE_NAME='editorial_requests' and row_json->>'source_kind'='article'
      and exists(select 1 from legal_removal_slugs where newsroom_id=room and slug_hash=md5(row_json->>'source_ref'))
    then raise exception 'This editorial source was legally removed. Choose reviewed sources.'; end if;
    if TG_TABLE_NAME in ('artifacts','artifact_versions','artifact_chunks','artifact_blobs','capture_events','snapshots')
      and exists(select 1 from legal_removal_urls u where u.newsroom_id=room and (
        u.url_hash=md5(row_json->>'url') or u.url_hash=md5(row_json->>'original_url') or u.url_hash=md5(row_json->>'source_url')
        or exists(select 1 from artifact_versions v where v.newsroom_id=room and v.id=(row_json->>'version_id')::integer and md5(v.url)=u.url_hash)
        or exists(select 1 from sources s where s.newsroom_id=room and s.id=(row_json->>'source_id')::integer and md5(s.url)=u.url_hash)))
    then raise exception 'This captured article address is covered by a legal removal.'; end if;
    if TG_TABLE_NAME='deleted_items' then
      candidate := (row_json->>'payload')::jsonb;
      if exists(select 1 from legal_removal_targets where newsroom_id=room
        and table_name=case row_json->>'kind' when 'article' then 'articles' when 'lead' then 'leads' when 'draft' then 'drafts' end
        and row_id=(row_json->>'ref_id')::integer)
      then raise exception 'Legally removed text cannot enter ordinary trash.'; end if;
      for part in select value from jsonb_array_elements(coalesce(candidate->'drafts','[]'::jsonb)) loop
        if exists(select 1 from legal_removal_targets where newsroom_id=room and table_name='drafts' and row_id=(part->>'id')::integer)
        then raise exception 'Legally removed text cannot enter ordinary trash.'; end if;
      end loop;
    end if;
    return NEW;
   end $$;

drop trigger if exists articles_legal_guard on articles;

create trigger articles_legal_guard before insert or update on articles for each row execute function prevent_legal_resurrection();

drop trigger if exists leads_legal_guard on leads;

create trigger leads_legal_guard before insert or update on leads for each row execute function prevent_legal_resurrection();

drop trigger if exists drafts_legal_guard on drafts;

create trigger drafts_legal_guard before insert or update on drafts for each row execute function prevent_legal_resurrection();

drop trigger if exists corrections_legal_guard on corrections;

create trigger corrections_legal_guard before insert or update on corrections for each row execute function prevent_legal_resurrection();

drop trigger if exists follow_ups_legal_guard on follow_ups;

create trigger follow_ups_legal_guard before insert or update on follow_ups for each row execute function prevent_legal_resurrection();

drop trigger if exists editorial_requests_legal_guard on editorial_requests;

create trigger editorial_requests_legal_guard before insert or update on editorial_requests for each row execute function prevent_legal_resurrection();

drop trigger if exists editorial_extras_legal_guard on editorial_extras;

create trigger editorial_extras_legal_guard before insert or update on editorial_extras for each row execute function prevent_legal_resurrection();

drop trigger if exists deleted_items_legal_guard on deleted_items;

create trigger deleted_items_legal_guard before insert or update on deleted_items for each row execute function prevent_legal_resurrection();

drop trigger if exists audit_events_legal_guard on audit_events;

create trigger audit_events_legal_guard before insert or update on audit_events for each row execute function prevent_legal_resurrection();

drop trigger if exists beat_memory_legal_guard on beat_memory;

create trigger beat_memory_legal_guard before insert or update on beat_memory for each row execute function prevent_legal_resurrection();

drop trigger if exists desk_jobs_legal_guard on desk_jobs;

create trigger desk_jobs_legal_guard before insert or update on desk_jobs for each row execute function prevent_legal_resurrection();

drop trigger if exists artifacts_legal_guard on artifacts;

create trigger artifacts_legal_guard before insert or update on artifacts for each row execute function prevent_legal_resurrection();

drop trigger if exists artifact_versions_legal_guard on artifact_versions;

create trigger artifact_versions_legal_guard before insert or update on artifact_versions for each row execute function prevent_legal_resurrection();

drop trigger if exists artifact_chunks_legal_guard on artifact_chunks;

create trigger artifact_chunks_legal_guard before insert or update on artifact_chunks for each row execute function prevent_legal_resurrection();

drop trigger if exists artifact_blobs_legal_guard on artifact_blobs;

create trigger artifact_blobs_legal_guard before insert or update on artifact_blobs for each row execute function prevent_legal_resurrection();

drop trigger if exists capture_events_legal_guard on capture_events;

create trigger capture_events_legal_guard before insert or update on capture_events for each row execute function prevent_legal_resurrection();

drop trigger if exists snapshots_legal_guard on snapshots;

create trigger snapshots_legal_guard before insert or update on snapshots for each row execute function prevent_legal_resurrection();
