import { createHash } from "node:crypto";
import { getSql, withTransaction, type Sql } from "../db.ts";

const GUARDED_TABLES=["articles","leads","drafts","corrections","follow_ups","editorial_requests","editorial_extras","deleted_items","audit_events","beat_memory","desk_jobs","artifacts","artifact_versions","artifact_chunks","artifact_blobs","capture_events","snapshots"];
export const LEGAL_SCHEMA = [
  `alter table articles add column if not exists origin_draft_id integer`,
  `alter table audit_events add column if not exists subject_kind text`,
  `alter table audit_events add column if not exists subject_id integer`,
  `create table if not exists legal_removal_rooms(newsroom_id integer primary key)`,
  `create table if not exists legal_removals(id text primary key, newsroom_id integer not null,
    requested_by text not null, case_ref text not null, policy text not null check(policy in ('retain','destroy')),
    created_at timestamptz not null default now(), expires_at timestamptz, purged_at timestamptz,
    review_pending boolean not null default true, counts_json text not null default '{}')`,
  `create table if not exists legal_removal_copies(case_id text primary key references legal_removals(id) on delete cascade,
    payload text not null)`,
  `create table if not exists legal_removal_targets(newsroom_id integer not null, table_name text not null,
    row_id integer not null, case_id text not null references legal_removals(id),
    primary key(newsroom_id,table_name,row_id))`,
  `create table if not exists legal_removal_slugs(newsroom_id integer not null, slug_hash text not null,
    case_id text not null references legal_removals(id), primary key(newsroom_id,slug_hash))`,
  `create table if not exists legal_removal_urls(newsroom_id integer not null, url_hash text not null,
    case_id text not null references legal_removals(id), primary key(newsroom_id,url_hash))`,
  `create table if not exists legal_removal_events(id serial primary key, case_id text not null references legal_removals(id),
    actor text not null, action text not null, created_at timestamptz not null default now())`,
  `create table if not exists legal_removal_backups(id serial primary key, case_id text not null references legal_removals(id),
    identifier text not null, confirmed_by text, confirmed_at timestamptz, created_at timestamptz not null default now())`,
  `create or replace function prevent_legal_resurrection() returns trigger language plpgsql as $$
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
   end $$`,
  ...GUARDED_TABLES.flatMap(table => [
    `drop trigger if exists ${table}_legal_guard on ${table}`,
    `create trigger ${table}_legal_guard before insert or update on ${table} for each row execute function prevent_legal_resurrection()`,
  ]),
] as const;

export async function ensureLegalSchema() {
  const fingerprint = createHash("sha256").update(LEGAL_SCHEMA.join("; ")).digest("hex");
  const sql=await getSql();
  await sql.query(`create table if not exists _schema_ensure_state(name text primary key,fingerprint text not null,ensured_at timestamptz not null default now())`);
  const [ready]=await sql<{fingerprint:string}>`select fingerprint from _schema_ensure_state where name='legal-removal'`;
  if(ready?.fingerprint===fingerprint) {await assertLegalReady(sql);return;}
  await withTransaction(async tx=>{
    await tx`insert into _schema_ensure_state(name,fingerprint) values('legal-removal','') on conflict do nothing`;
    const [locked]=await tx<{fingerprint:string}>`select fingerprint from _schema_ensure_state where name='legal-removal' for update`;
    if(locked?.fingerprint===fingerprint) return;
    for(const statement of LEGAL_SCHEMA) await tx.query(statement);
    await assertLegalReady(tx);
    await tx`update _schema_ensure_state set fingerprint=${fingerprint},ensured_at=now() where name='legal-removal'`;
  });
}

export async function lockRemovalRoom(sql:Sql,room:number) {
  await sql`insert into legal_removal_rooms(newsroom_id) values(${room}) on conflict do nothing`;
  await sql`select newsroom_id from legal_removal_rooms where newsroom_id=${room} for update`;
}

async function assertLegalReady(sql:Sql) {
  const [ready]=await sql<{ready:boolean}>`select
    (select count(*) from information_schema.tables where table_schema='public' and table_name in ('legal_removal_rooms','legal_removals','legal_removal_copies','legal_removal_targets','legal_removal_slugs','legal_removal_urls','legal_removal_events','legal_removal_backups'))=8
    and (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and t.tgenabled<>'D' and not t.tgisinternal and t.tgname=c.relname||'_legal_guard' and c.relname=any(${GUARDED_TABLES}::text[]))=${GUARDED_TABLES.length} as ready`;
  if(!ready?.ready) {
    await sql`delete from _schema_ensure_state where name='legal-removal'`;
    throw new Error('Legal removal schema is incomplete. Apply migrations before continuing; no removal was accepted.');
  }
}
