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

create or replace function legal_decode_url_path(value text) returns text language plpgsql immutable as $$
   declare result bytea := ''::bytea; at integer := 1; token text;
   begin
    while at<=length(value) loop
      token:=substr(value,at,1);
      if token='%' then
        token:=substr(value,at+1,2);
        if length(token)<>2 or token !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
        result:=result||decode(token,'hex'); at:=at+3;
      else result:=result||convert_to(token,'UTF8'); at:=at+1; end if;
    end loop;
    return convert_from(result,'UTF8');
   exception when character_not_in_repertoire or untranslatable_character then return null;
   end $$;

create or replace function legal_article_url_identity(value text) returns text language plpgsql immutable as $$
   declare clean text; parts text[]; authority text;
   begin
    clean:=rtrim(regexp_replace(btrim(value),'[?#].*$',''),'/');
    if clean ~ '^/articles/[^/]+$' then return legal_decode_url_path(clean); end if;
    parts:=regexp_match(clean,'^(https?)://([^/]+)(/articles/[^/]+)$','i');
    if parts is null then return null; end if;
    authority:=lower(parts[2]);
    if lower(parts[1])='https' then authority:=regexp_replace(authority,':443$','');
    else authority:=regexp_replace(authority,':80$',''); end if;
    return lower(parts[1])||'://'||authority||legal_decode_url_path(parts[3]);
   end $$;

create or replace function legal_search_article_urls(value jsonb) returns setof text language plpgsql immutable as $$
   declare field text; payload jsonb;
   begin
    foreach field in array array['results_json','selected_json','fetched_json','generated_json'] loop
      begin payload:=coalesce(value->>field,'[]')::jsonb;
      exception when invalid_text_representation then continue; end;
      return query select distinct legal_article_url_identity(v #>> '{}') from jsonb_path_query(payload,'$.**') v
        where jsonb_typeof(v)='string' and legal_article_url_identity(v #>> '{}') is not null;
    end loop;
   end $$;

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
    if TG_TABLE_NAME in ('artifacts','artifact_versions','artifact_chunks','artifact_blobs','capture_events','snapshots','sources','source_monitors','recurring_baselines','manual_watch_checks')
      and exists(select 1 from legal_removal_urls u where u.newsroom_id=room and (
        u.url_hash=md5(legal_article_url_identity(row_json->>'url')) or u.url_hash=md5(legal_article_url_identity(row_json->>'original_url')) or u.url_hash=md5(legal_article_url_identity(row_json->>'source_url')) or u.url_hash=md5(legal_article_url_identity(row_json->>'typical_url'))
        or exists(select 1 from artifact_versions v where v.newsroom_id=room and v.id=(row_json->>'version_id')::integer and md5(legal_article_url_identity(v.url))=u.url_hash)
        or exists(select 1 from sources s where s.newsroom_id=room and s.id=(row_json->>'source_id')::integer and md5(legal_article_url_identity(s.url))=u.url_hash)
        or exists(select 1 from source_monitors m where m.newsroom_id=room and m.id=(row_json->>'monitor_id')::integer and md5(legal_article_url_identity(m.url))=u.url_hash)
        or exists(select 1 from capture_events e where e.newsroom_id=room and e.id=(row_json->>'capture_event_id')::integer and md5(legal_article_url_identity(e.source_url))=u.url_hash)))
    then raise exception 'This captured article address is covered by a legal removal.'; end if;
    if TG_TABLE_NAME='search_log' and exists(select 1 from legal_search_article_urls(row_json) hit
      join legal_removal_urls u on u.newsroom_id=room and u.url_hash=md5(hit))
    then raise exception 'These search results are covered by a legal removal.'; end if;
    if TG_TABLE_NAME='frontier_items' and exists(select 1 from legal_removal_urls u where u.newsroom_id=room and (
      u.url_hash=md5(legal_article_url_identity(row_json->>'label')) or u.url_hash=md5(legal_article_url_identity(row_json->>'evidence'))
      or exists(select 1 from search_log l cross join lateral legal_search_article_urls(to_jsonb(l)) hit
        where l.newsroom_id=room and l.frontier_id=(row_json->>'id')::integer and md5(hit)=u.url_hash)))
    then raise exception 'This frontier reference is covered by a legal removal.'; end if;
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

drop trigger if exists search_log_legal_guard on search_log;

create trigger search_log_legal_guard before insert or update on search_log for each row execute function prevent_legal_resurrection();

drop trigger if exists frontier_items_legal_guard on frontier_items;

create trigger frontier_items_legal_guard before insert or update on frontier_items for each row execute function prevent_legal_resurrection();

drop trigger if exists sources_legal_guard on sources;

create trigger sources_legal_guard before insert or update on sources for each row execute function prevent_legal_resurrection();

drop trigger if exists source_monitors_legal_guard on source_monitors;

create trigger source_monitors_legal_guard before insert or update on source_monitors for each row execute function prevent_legal_resurrection();

drop trigger if exists recurring_baselines_legal_guard on recurring_baselines;

create trigger recurring_baselines_legal_guard before insert or update on recurring_baselines for each row execute function prevent_legal_resurrection();

drop trigger if exists manual_watch_checks_legal_guard on manual_watch_checks;

create trigger manual_watch_checks_legal_guard before insert or update on manual_watch_checks for each row execute function prevent_legal_resurrection();
