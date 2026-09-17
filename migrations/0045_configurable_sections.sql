create table if not exists section_config (newsroom_id integer primary key, revision integer not null default 0);

create table if not exists newsroom_sections (newsroom_id integer not null, key text not null, name text not null,
    position integer not null, visible boolean not null default true, brief text not null default '', instructions text not null default '',
    replacement_key text, primary key (newsroom_id,key), foreign key (newsroom_id) references section_config(newsroom_id),
    check (replacement_key is null or replacement_key <> key));

create table if not exists section_sources (newsroom_id integer not null, section_key text not null,
    source_id integer not null references sources(id) on delete cascade, primary key (newsroom_id,section_key,source_id),
    foreign key (newsroom_id,section_key) references newsroom_sections(newsroom_id,key));

alter table scan_runs add column if not exists section_snapshot text;

create or replace function resolve_story_section() returns trigger language plpgsql as $$
  declare resolved text; next_key text; visited text[] := array[]::text[];
  begin
    -- A shared row lock makes filing serialize with the config revision update.
    perform revision from section_config where newsroom_id=NEW.newsroom_id for share;
    if not found then
      insert into section_config(newsroom_id) values(NEW.newsroom_id) on conflict do nothing;
      insert into newsroom_sections(newsroom_id,key,name,position,visible)
        select NEW.newsroom_id,k,initcap(k),n::integer,k<>'about'
        from unnest(array['council','budget','housing','utilities','schools','planning','infrastructure','elections','opinion','about']) with ordinality defaults(k,n) on conflict do nothing;
      insert into newsroom_sections(newsroom_id,key,name,position,visible)
        select NEW.newsroom_id,topic,initcap(topic),100+row_number() over(order by topic),topic<>'about' from (
          select topic from articles where newsroom_id=NEW.newsroom_id union select topic from leads where newsroom_id=NEW.newsroom_id
          union select topic from drafts where newsroom_id=NEW.newsroom_id) legacy on conflict do nothing;
      perform revision from section_config where newsroom_id=NEW.newsroom_id for share;
    end if;
    resolved := NEW.topic;
    loop
      if resolved=any(visited) then raise exception 'Section replacement cycle'; end if;
      visited := array_append(visited,resolved);
      select replacement_key into next_key from newsroom_sections where newsroom_id=NEW.newsroom_id and key=resolved;
      if not found then raise exception 'Section not found in this newsroom: %',resolved; end if;
      if next_key is null then exit; end if;
      resolved := next_key;
    end loop;
    NEW.topic := resolved;
    return NEW;
  end $$;

drop trigger if exists leads_resolve_section on leads;

create trigger leads_resolve_section before insert or update of topic on leads for each row execute function resolve_story_section();

drop trigger if exists drafts_resolve_section on drafts;

create trigger drafts_resolve_section before insert or update of topic on drafts for each row execute function resolve_story_section();

drop trigger if exists articles_resolve_section on articles;

create trigger articles_resolve_section before insert or update of topic on articles for each row execute function resolve_story_section();

insert into section_config(newsroom_id) select newsroom_id from (
    select 1 as newsroom_id union select newsroom_id from articles union select newsroom_id from leads union select newsroom_id from drafts) rooms on conflict do nothing;

insert into newsroom_sections(newsroom_id,key,name,position,visible)
    select newsroom_id,k,initcap(k),n::integer,k<>'about' from section_config cross join
    unnest(array['council','budget','housing','utilities','schools','planning','infrastructure','elections','opinion','about']) with ordinality defaults(k,n) on conflict do nothing;

insert into newsroom_sections(newsroom_id,key,name,position,visible)
    select newsroom_id,topic,initcap(topic),100+row_number() over(partition by newsroom_id order by topic),topic<>'about'
    from (select newsroom_id,topic from articles union select newsroom_id,topic from leads union select newsroom_id,topic from drafts) legacy
    on conflict do nothing;
