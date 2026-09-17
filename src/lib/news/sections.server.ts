import { getSql, ensureSchemaOnce, withTransaction, type Sql } from "../db.ts";
import { TOPICS } from "../paper.ts";
import type { Section, SectionConfig, SectionScanSnapshot } from "./section-types.ts";

// Mirror migration 0045 for direct-node tests and existing schema recovery.
export const SECTION_SCHEMA = [
  `create table if not exists section_config (newsroom_id integer primary key, revision integer not null default 0)`,
  `create table if not exists newsroom_sections (newsroom_id integer not null, key text not null, name text not null,
    position integer not null, visible boolean not null default true, brief text not null default '', instructions text not null default '',
    replacement_key text, primary key (newsroom_id,key), foreign key (newsroom_id) references section_config(newsroom_id),
    check (replacement_key is null or replacement_key <> key))`,
  `create table if not exists section_sources (newsroom_id integer not null, section_key text not null,
    source_id integer not null references sources(id) on delete cascade, primary key (newsroom_id,section_key,source_id),
    foreign key (newsroom_id,section_key) references newsroom_sections(newsroom_id,key))`,
  `alter table scan_runs add column if not exists section_snapshot text`,
  `create or replace function resolve_story_section() returns trigger language plpgsql as $$
  declare resolved text; next_key text; visited text[] := array[]::text[];
  begin
    -- A shared row lock makes filing serialize with the config revision update.
    perform revision from section_config where newsroom_id=NEW.newsroom_id for share;
    if not found then
      insert into section_config(newsroom_id) values(NEW.newsroom_id) on conflict do nothing;
      insert into newsroom_sections(newsroom_id,key,name,position,visible)
        select NEW.newsroom_id,k,initcap(k),n::integer,k<>'about'
        from unnest(array[${TOPICS.map((key) => `'${key}'`).join(",")}]) with ordinality defaults(k,n) on conflict do nothing;
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
  end $$`,
  ...["leads", "drafts", "articles"].flatMap((table) => [
    `drop trigger if exists ${table}_resolve_section on ${table}`,
    `create trigger ${table}_resolve_section before insert or update of topic on ${table} for each row execute function resolve_story_section()`,
  ]),
  `insert into section_config(newsroom_id) select newsroom_id from (
    select 1 as newsroom_id union select newsroom_id from articles union select newsroom_id from leads union select newsroom_id from drafts) rooms on conflict do nothing`,
  `insert into newsroom_sections(newsroom_id,key,name,position,visible)
    select newsroom_id,k,initcap(k),n::integer,k<>'about' from section_config cross join
    unnest(array[${TOPICS.map((key) => `'${key}'`).join(",")}]) with ordinality defaults(k,n) on conflict do nothing`,
  `insert into newsroom_sections(newsroom_id,key,name,position,visible)
    select newsroom_id,topic,initcap(topic),100+row_number() over(partition by newsroom_id order by topic),topic<>'about'
    from (select newsroom_id,topic from articles union select newsroom_id,topic from leads union select newsroom_id,topic from drafts) legacy
    on conflict do nothing`,
] as const;

export async function ensureSectionsSchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "sections", SECTION_SCHEMA);
  // The shared legacy ensure helper tolerates DDL failures. Sections cannot:
  // missing filing guards would silently revive retired keys or lose snapshots.
  const [ready] = await sql<{ ready: boolean }>`
    select
      (select count(*) from information_schema.tables where table_schema='public'
        and table_name in ('section_config','newsroom_sections','section_sources')) = 3
      and exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='scan_runs' and column_name='section_snapshot')
      and (select count(*) from information_schema.columns where table_schema='public'
        and table_name in ('leads','drafts','articles') and column_name in ('newsroom_id','topic')) = 6
      and (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and t.tgenabled <> 'D' and not t.tgisinternal
        and t.tgname=c.relname || '_resolve_section'
        and c.relname in ('leads','drafts','articles')) = 3 as ready
  `;
  if (!ready?.ready) {
    await sql`delete from _schema_ensure_state where name='sections'`;
    throw new Error("Section schema is incomplete. Apply migrations and retry; no section changes were accepted.");
  }
}

async function seed(sql: Sql, newsroomId: number) {
  if (!Number.isSafeInteger(newsroomId) || newsroomId < 1) throw new Error("Invalid newsroom.");
  await sql`insert into section_config (newsroom_id) values (${newsroomId}) on conflict do nothing`;
  const existing = await sql`select key from newsroom_sections where newsroom_id=${newsroomId}`;
  if (existing.length) return;
  const legacy = await sql<{
    topic: string;
  }>`select topic from articles where newsroom_id=${newsroomId}
    union select topic from leads where newsroom_id=${newsroomId} union select topic from drafts where newsroom_id=${newsroomId}`;
  const keys = [...new Set<string>([...TOPICS, ...legacy.map((r) => r.topic).filter(Boolean)])];
  for (let position = 0; position < keys.length; position++) {
    const key = keys[position]!;
    const name = key.replace(/[-_]/g, " ").replace(/^./, (s) => s.toUpperCase());
    await sql`insert into newsroom_sections (newsroom_id,key,name,position,visible)
      values (${newsroomId},${key},${name},${position},${key !== "about"}) on conflict do nothing`;
  }
}

async function readConfig(sql: Sql, newsroomId: number): Promise<SectionConfig> {
  const [config] = await sql<{
    revision: number;
  }>`select revision from section_config where newsroom_id=${newsroomId}`;
  const rows = await sql<{
    key: string;
    name: string;
    visible: boolean;
    brief: string;
    instructions: string;
    replacement_key: string | null;
  }>`
    select * from newsroom_sections where newsroom_id=${newsroomId} order by position,key`;
  const assignments = await sql<{
    section_key: string;
    source_id: number;
  }>`select section_key,source_id from section_sources where newsroom_id=${newsroomId} order by source_id`;
  return {
    revision: config!.revision,
    sections: rows.map((r) => ({
      key: r.key,
      name: r.name,
      visible: r.visible,
      brief: r.brief,
      instructions: r.instructions,
      replacementKey: r.replacement_key,
      sourceIds: assignments.filter((a) => a.section_key === r.key).map((a) => a.source_id),
    })),
  };
}

export async function getSections(newsroomId: number): Promise<SectionConfig> {
  await ensureSectionsSchema();
  return withTransaction(async (sql) => {
    await seed(sql, newsroomId);
    return readConfig(sql, newsroomId);
  });
}

export async function saveSections(
  newsroomId: number,
  input: SectionConfig,
): Promise<SectionConfig> {
  await ensureSectionsSchema();
  return withTransaction(async (sql) => {
    await seed(sql, newsroomId);
    const prior = await readConfig(sql, newsroomId);
    const reserved = new Set(["opinion", "about"]);
    if (
      !input ||
      !Number.isSafeInteger(input.revision) ||
      !Array.isArray(input.sections) ||
      input.sections.length > 100
    )
      throw new Error("Invalid section configuration.");
    const keys = new Set<string>();
    for (const section of input.sections) {
      if (!section || typeof section.key !== "string" || keys.has(section.key))
        throw new Error("Section keys must be unique.");
      const previous = prior.sections.find((s) => s.key === section.key);
      if (!previous && !/^[a-z][a-z0-9-]{0,39}$/.test(section.key))
        throw new Error(
          "New section keys use lowercase letters, numbers and hyphens (up to 40 characters).",
        );
      keys.add(section.key);
      if (
        typeof section.name !== "string" ||
        !section.name.trim() ||
        section.name.length > 80 ||
        typeof section.visible !== "boolean" ||
        typeof section.brief !== "string" ||
        section.brief.length > 3000 ||
        typeof section.instructions !== "string" ||
        section.instructions.length > 6000 ||
        !Array.isArray(section.sourceIds) ||
        section.sourceIds.length > 200 ||
        section.sourceIds.some((id) => !Number.isSafeInteger(id) || id < 1)
      )
        throw new Error(
          "Each section needs a name and valid brief, instructions and source selections.",
        );
      if (reserved.has(section.key) && section.replacementKey)
        throw new Error("Opinion and About cannot be retired.");
      if (previous?.replacementKey && section.replacementKey !== previous.replacementKey)
        throw new Error("Retired section aliases cannot be changed.");
    }
    if (prior.sections.some((s) => !keys.has(s.key)))
      throw new Error("Retire sections with a replacement; they cannot be deleted.");
    if (!input.sections.some((s) => !s.replacementKey && !reserved.has(s.key)))
      throw new Error("Keep at least one active reporting section.");
    for (const section of input.sections) {
      if (section.replacementKey) {
        const replacement = input.sections.find((s) => s.key === section.replacementKey);
        if (!replacement || replacement.key === section.key || reserved.has(replacement.key))
          throw new Error("Choose a reporting section as the replacement.");
        // An older alias may point to a section retired in this same save.
        // New retirements must target an active section; old chains remain valid.
        const alreadyRetired = prior.sections.find((s) => s.key === section.key)?.replacementKey;
        if (!alreadyRetired && replacement.replacementKey)
          throw new Error("Choose an active reporting section as the replacement.");
        resolvedSectionKey(input.sections, section.key);
      }
      for (const sourceId of new Set(section.sourceIds)) {
        const [source] =
          await sql`select id from sources where id=${sourceId} and newsroom_id=${newsroomId} and status='accepted'`;
        if (!source) throw new Error("Only accepted sources in this newsroom can be assigned.");
      }
    }
    const changed =
      await sql`update section_config set revision=revision+1 where newsroom_id=${newsroomId} and revision=${input.revision} returning revision`;
    if (!changed.length)
      throw new Error(
        "Sections changed while you were editing. Reload the saved configuration before applying again.",
      );
    for (let position = 0; position < input.sections.length; position++) {
      const s = input.sections[position]!;
      await sql`insert into newsroom_sections (newsroom_id,key,name,position,visible,brief,instructions,replacement_key)
        values (${newsroomId},${s.key},${s.name.trim()},${position},${s.visible},${s.brief.trim()},${s.instructions.trim()},${s.replacementKey || null})
        on conflict(newsroom_id,key) do update set name=excluded.name,position=excluded.position,visible=excluded.visible,brief=excluded.brief,instructions=excluded.instructions,replacement_key=excluded.replacement_key`;
      await sql`delete from section_sources where newsroom_id=${newsroomId} and section_key=${s.key}`;
      for (const id of new Set(s.sourceIds))
        await sql`insert into section_sources (newsroom_id,section_key,source_id) values (${newsroomId},${s.key},${id})`;
    }
    // All destinations (including newly created sections later in the order)
    // must exist before the write trigger resolves any retired story key.
    for (const s of input.sections) {
      if (s.replacementKey)
        for (const table of ["leads", "drafts", "articles"]) {
          await sql.query(`update ${table} set topic=$1 where newsroom_id=$2 and topic=$3`, [
            resolvedSectionKey(input.sections, s.key),
            newsroomId,
            s.key,
          ]);
        }
    }
    return readConfig(sql, newsroomId);
  });
}

export function resolvedSectionKey(sections: Section[], key: string): string {
  const seen = new Set<string>();
  for (let current = key; ;) {
    if (seen.has(current)) throw new Error("Section replacement cycle.");
    seen.add(current);
    const section = sections.find((s) => s.key === current);
    if (!section) throw new Error("Section not found in this newsroom.");
    if (!section.replacementKey) return section.key;
    current = section.replacementKey;
  }
}
export async function resolveSectionKey(newsroomId: number, key: string) {
  return resolvedSectionKey((await getSections(newsroomId)).sections, key);
}
export async function sectionScanSnapshot(
  newsroomId: number,
  key?: string,
): Promise<SectionScanSnapshot | null> {
  if (!key) return null;
  const config = await getSections(newsroomId);
  const section = config.sections.find(
    (s) => s.key === key && !s.replacementKey && s.key !== "about" && s.key !== "opinion",
  );
  if (!section) throw new Error("Choose an active reporting section.");
  const sql = await getSql();
  const accepted = await sql<{
    id: number;
  }>`select id from sources where newsroom_id=${newsroomId} and status='accepted'`;
  const sourceIds = section.sourceIds.filter((id) => accepted.some((s) => s.id === id));
  if (!sourceIds.length)
    throw new Error(
      "This section has no accepted assigned sources. Assign sources in Paper setup before scanning.",
    );
  return {
    key: section.key,
    name: section.name,
    brief: section.brief,
    instructions: section.instructions,
    sourceIds,
    revision: config.revision,
  };
}
