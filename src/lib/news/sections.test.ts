import { before, it } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { getSql, getPglite } from "../db.ts";
import {
  getSections,
  saveSections,
  resolveSectionKey,
  sectionScanSnapshot,
} from "./sections.server.ts";
import { selectedScanSources } from "./section-types.ts";
import { buildScanUserMessage } from "./desk-copy.ts";
import { parseScanResult } from "./schema.ts";
import { coerceDraft } from "./coerce-draft.ts";
import {
  ensureNewsroomSources,
  insertProposedNewsroomSource,
  saveAcceptedNewsroomSource,
} from "./source-seeds.server.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { commitScanForAuthenticatedEditor } from "./model-request-commit.server.ts";
import { enqueueJob } from "./jobs.ts";

before(async () => {
  const sql = await getSql();
  await (
    await getPglite()
  ).exec(await readFile(new URL("../../../migrations/0002_newsroom.sql", import.meta.url), "utf8"));
  for (const table of ["sources", "articles", "leads", "drafts", "scan_runs"]) {
    await sql.query(`alter table ${table} add column newsroom_id integer not null default 1`);
  }
  await (
    await getPglite()
  ).exec(await readFile(new URL("../../../migrations/0056_newsroom_source_identity.sql", import.meta.url), "utf8"));
  await sql`insert into articles (user_id,newsroom_id,slug,headline,body,topic) values ('section-test',701,'sections-legacy','Legacy','Original body','legacy')`;
  await sql`insert into articles (user_id,newsroom_id,slug,headline,body,topic) values ('section-test',702,'sections-foreign','Foreign','Private body','legacy')`;
  const beforeMigration=await sql`select * from articles order by id`;
  const migration=await readFile(new URL("../../../migrations/0045_configurable_sections.sql",import.meta.url),"utf8");
  await (await getPglite()).exec(migration);
  await (await getPglite()).exec(migration);
  assert.deepEqual(await sql`select * from articles order by id`,beforeMigration,"migration replay preserves every legacy article field");
});

it("pins a section snapshot to the queued run and refuses a conflicting General Scan",async()=>{
  const sql=await getSql();
  const [source]=await sql<{id:number}>`insert into sources(user_id,newsroom_id,url,title,status) values('section-commit',761,'https://example.org/choir','Choir','accepted') returning id`;
  const initial=await getSections(761);
  await saveSections(761,{...initial,sections:initial.sections.map(s=>s.key==='schools'?{...s,brief:'Original brief',sourceIds:[source!.id]}:s)});
  const deps={probeProvider:async()=>({ok:true as const,label:'Mock Claude',choice:'claude-frontier' as const}),assertRate:async()=>undefined,enqueueJob:async(options:Parameters<typeof enqueueJob>[0])=>enqueueJob({...options,kick:false}),kickJobs:()=>undefined};
  const result=await commitScanForAuthenticatedEditor({context:{userId:'section-commit',newsroomId:761},modelChoice:'claude-frontier',sectionKey:'schools'},deps);
  assert.equal(result.ok,true);
  const [row]=await sql<{section_snapshot:string}>`select section_snapshot from scan_runs where newsroom_id=761 order by id desc limit 1`;
  const snapshot=JSON.parse(row!.section_snapshot);
  assert.equal(snapshot.key,'schools');assert.equal(snapshot.brief,'Original brief');assert.deepEqual(snapshot.sourceIds,[source!.id]);
  const current=await getSections(761);
  await saveSections(761,{...current,sections:current.sections.map(s=>s.key==='schools'?{...s,brief:'Changed brief'}:s)});
  assert.equal(JSON.parse((await sql<{section_snapshot:string}>`select section_snapshot from scan_runs where newsroom_id=761 order by id desc limit 1`)[0]!.section_snapshot).brief,'Original brief');
  const conflict=await commitScanForAuthenticatedEditor({context:{userId:'section-commit',newsroomId:761},modelChoice:'claude-frontier'},deps);
  assert.equal(conflict.ok,false);
  if(!conflict.ok) assert.match(conflict.error,/different section scope/);
});

it("new rooms initialize on first write and in-flight writes follow retirement for leads, drafts and articles", async () => {
  await getSections(721);
  const sql = await getSql();
  const [lead] = await sql<{
    id: number;
  }>`insert into leads(user_id,newsroom_id,headline,why,topic) values('section-first',722,'First lead','A reason','housing') returning id`;
  const initial = await getSections(722);
  assert.equal(initial.sections.length, 10);
  await saveSections(722, {
    ...initial,
    sections: initial.sections.map((s) =>
      s.key === "housing" ? { ...s, replacementKey: "schools" } : s,
    ),
  });
  await sql`insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic) values('section-first',722,${lead!.id},'Draft','Body','housing')`;
  await sql`insert into articles(user_id,newsroom_id,slug,headline,body,topic) values('section-first',722,'section-late','Article','Body','housing')`;
  const [later] = await sql<{
    topic: string;
  }>`insert into leads(user_id,newsroom_id,headline,why,topic) values('section-first',722,'Later lead','Why','housing') returning topic`;
  assert.equal(later!.topic, "schools");
  assert.equal(
    (await sql<{ topic: string }>`select topic from drafts where lead_id=${lead!.id}`)[0]!.topic,
    "schools",
  );
  assert.equal(
    (await sql<{ topic: string }>`select topic from articles where slug='section-late'`)[0]!.topic,
    "schools",
  );
  await assert.rejects(
    sql`insert into leads(user_id,newsroom_id,headline,why,topic) values('section-first',723,'Invalid','Why','foreign-private-key')`,
    /Section not found/,
  );
});

it("snapshots section instructions and accepted source IDs without accepting proposed sources", async () => {
  const sql = await getSql();
  const [source] = await sql<{
    id: number;
  }>`insert into sources(user_id,newsroom_id,url,title,status) values('section-snapshot',731,'https://example.org/school','School','accepted') returning id`;
  const initial = await getSections(731);
  await saveSections(731, {
    ...initial,
    sections: initial.sections.map((s) =>
      s.key === "schools"
        ? {
            ...s,
            brief: "Student life",
            instructions: "Look for family impacts",
            sourceIds: [source!.id],
          }
        : s,
    ),
  });
  const snapshot = await sectionScanSnapshot(731, "schools");
  assert.deepEqual(snapshot?.sourceIds, [source!.id]);
  assert.equal(snapshot?.brief, "Student life");
  assert.equal(snapshot?.instructions, "Look for family impacts");
  await sql`update sources set status='dropped' where id=${source!.id}`;
  await assert.rejects(sectionScanSnapshot(731, "schools"), /no accepted assigned sources/);
  assert.deepEqual(snapshot?.sourceIds, [source!.id], "queued snapshot remains immutable");
  assert.deepEqual(
    selectedScanSources(snapshot!, [
      { id: source!.id, status: "dropped" },
      { id: 9999, status: "accepted" },
    ]),
    [],
    "worker cannot fetch dropped or newly unassigned sources",
  );
  assert.equal(
    await sectionScanSnapshot(731),
    null,
    "General Scan keeps unrestricted accepted-source behavior",
  );
});

it("passes custom coverage instructions to the scanner and carries the key through draft and article persistence", async () => {
  const initial = await getSections(741);
  await saveSections(741, {
    ...initial,
    sections: [
      ...initial.sections,
      {
        key: "community-life",
        name: "Community life",
        visible: true,
        brief: "Neighborhood clubs and local arts",
        instructions: "Look for access barriers to participation",
        replacementKey: null,
        sourceIds: [],
      },
    ],
  });
  const prompt = buildScanUserMessage({
    city: "Riverbend",
    state: "Colorado",
    reread: false,
    memory: [],
    payload: "SOURCE: Library\nA neighborhood choir welcomes new members.",
    topics: ["community-life"],
    section: {
      name: "Community life",
      brief: "Neighborhood clubs and local arts",
      instructions: "Look for access barriers to participation",
    },
  });
  const transport = async (user: string) => {
    assert.match(user, /Neighborhood clubs and local arts/);
    assert.match(user, /access barriers to participation/);
    assert.match(user, /topic must be exactly one of: community-life/);
    return {
      leads: [
        {
          headline: "Choir opens free rehearsals",
          why: "Residents can join this week",
          topic: "community-life",
          newsworthiness: 12,
        },
      ],
    };
  };
  const result = parseScanResult(await transport(prompt), ["community-life"]);
  assert.equal(result.leads[0]?.topic, "community-life");
  const draft = coerceDraft(
    JSON.stringify({
      headline: "Choir opens free rehearsals",
      body: "The library choir invites residents.",
      topic: "community-life",
    }),
    { headline: "Choir", dek: "", topic: result.leads[0]!.topic },
  );
  assert.equal(draft.topic, "community-life");
  const sql = await getSql();
  const [lead] = await sql<{
    id: number;
  }>`insert into leads(user_id,newsroom_id,headline,why,topic) values('section-pipeline',741,${draft.headline},'Why',${draft.topic}) returning id`;
  await sql`insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic) values('section-pipeline',741,${lead!.id},${draft.headline},${draft.body},${draft.topic})`;
  const [article] = await sql<{
    topic: string;
  }>`insert into articles(user_id,newsroom_id,slug,headline,body,topic) values('section-pipeline',741,'community-choir',${draft.headline},${draft.body},${draft.topic}) returning topic`;
  assert.equal(article!.topic, "community-life");
  const before = await sql<{
    id: number;
    slug: string;
    body: string;
    published_at: unknown;
  }>`select id,slug,body,published_at from articles where slug='community-choir'`;
  const current = await getSections(741);
  await saveSections(741, {
    ...current,
    sections: [
      ...current.sections.map((s) =>
        s.key === "community-life" ? { ...s, replacementKey: "neighbors" } : s,
      ),
      {
        key: "neighbors",
        name: "Neighbors",
        visible: true,
        brief: "",
        instructions: "",
        replacementKey: null,
        sourceIds: [],
      },
    ],
  });
  const after = await sql<{
    id: number;
    slug: string;
    body: string;
    published_at: unknown;
  }>`select id,slug,body,published_at from articles where slug='community-choir'`;
  assert.deepEqual(after, before);
  assert.equal(
    (await sql<{ topic: string }>`select topic from articles where slug='community-choir'`)[0]!
      .topic,
    "neighbors",
  );
  assert.equal(
    (await sql<{ topic: string }>`select topic from drafts where lead_id=${lead!.id}`)[0]!.topic,
    "neighbors",
  );
  assert.equal(
    (await sql<{ topic: string }>`select topic from leads where id=${lead!.id}`)[0]!.topic,
    "neighbors",
  );
});

it("seeds sources from the owned onboarded room, never the default paper", async () => {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`insert into paper_settings(newsroom_id,onboarded,seed_sources) values(751,true,${JSON.stringify([{ url: "https://example.org/riverbend", title: "Riverbend library", kind: "official", tier: "A" }])}::jsonb),(752,false,'[]'::jsonb)`;
  await ensureNewsroomSources("section-seed", 751);
  await ensureNewsroomSources("section-seed-not-ready", 752);
  const rows = await sql<{
    newsroom_id: number;
    url: string;
  }>`select newsroom_id,url from sources where user_id in ('section-seed','section-seed-not-ready')`;
  assert.deepEqual(rows, [{ newsroom_id: 751, url: "https://example.org/riverbend" }]);
});

it("seeds each configured URL once per newsroom across editors and repeated calls", async () => {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  const seedSources = JSON.stringify([
    {
      url: "https://example.org/shared-calendar",
      title: "Shared calendar",
      kind: "official",
      tier: "A",
    },
  ]);
  await sql`
    insert into paper_settings(newsroom_id,onboarded,seed_sources)
    values
      (753,true,${seedSources}::jsonb),
      (754,true,${seedSources}::jsonb)
  `;

  await Promise.all([
    ensureNewsroomSources("section-seed-owner", 753),
    ensureNewsroomSources("section-seed-editor", 753),
  ]);
  await ensureNewsroomSources("section-seed-owner", 753);
  await ensureNewsroomSources("section-seed-owner", 754);

  const rows = await sql<{
    newsroom_id: number;
    user_id: string;
    url: string;
  }>`
    select newsroom_id,user_id,url
    from sources
    where newsroom_id in (753,754)
      and url='https://example.org/shared-calendar'
    order by newsroom_id,id
  `;
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map(({ newsroom_id, url }) => ({ newsroom_id, url })),
    [
      { newsroom_id: 753, url: "https://example.org/shared-calendar" },
      { newsroom_id: 754, url: "https://example.org/shared-calendar" },
    ],
  );
  assert.ok(
    ["section-seed-owner", "section-seed-editor"].includes(rows[0]!.user_id),
    "the first concurrent editor owns the single shared-room seed row",
  );
  assert.equal(rows[1]!.user_id, "section-seed-owner");
});

it("manual saves reuse the newsroom row while discovery preserves rejected decisions", async () => {
  const sql = await getSql();
  const url = "https://example.org/manual-shared";
  const seedSources = JSON.stringify([{ url, title: "Seed title", kind: "official", tier: "A" }]);
  await sql`insert into paper_settings(newsroom_id,onboarded,seed_sources) values(755,true,${seedSources}::jsonb)`;
  const first = await saveAcceptedNewsroomSource({ userId: "source-owner", newsroomId: 755, url, title: "Original", kind: "official", tier: "A" });
  const second = await saveAcceptedNewsroomSource({ userId: "source-editor", newsroomId: 755, url, title: "Updated", kind: "page", tier: "B" });
  assert.equal(second?.id, first?.id);
  await sql`update sources set status='rejected' where id=${first!.id}`;
  await ensureNewsroomSources("source-later-editor", 755);
  assert.equal(await insertProposedNewsroomSource(sql, { userId: "source-editor", newsroomId: 755, url, title: "Discovery" }), false);
  const rows = await sql<{ status: string; title: string }>`select status,title from sources where newsroom_id=755 and url=${url}`;
  assert.deepEqual(rows, [{ status: "rejected", title: "Updated" }]);
});

it("renames and retires stable keys without deleting article identities or crossing newsrooms", async () => {
  const sql = await getSql();
  const initial = await getSections(701);
  const legacy = initial.sections.find((s) => s.key === "legacy");
  assert.ok(legacy, "existing topic keys must be seeded");
  const updated = initial.sections.map((s) =>
    s.key === "legacy" ? { ...s, name: "Community life", visible: false } : s,
  );
  await saveSections(701, { revision: initial.revision, sections: updated });
  const renamed = await getSections(701);
  assert.equal(renamed.sections.find((s) => s.key === "legacy")?.name, "Community life");
  await saveSections(701, {
    revision: renamed.revision,
    sections: renamed.sections.map((s) =>
      s.key === "legacy" ? { ...s, replacementKey: "housing" } : s,
    ),
  });
  assert.equal(await resolveSectionKey(701, "legacy"), "housing");
  const rows = await sql<{
    slug: string;
    topic: string;
    body: string;
  }>`select slug,topic,body from articles where slug in ('sections-legacy','sections-foreign') order by slug`;
  assert.deepEqual(
    rows.map((r) => [r.slug, r.topic, r.body]),
    [
      ["sections-foreign", "legacy", "Private body"],
      ["sections-legacy", "housing", "Original body"],
    ],
  );
  const retired = await getSections(701);
  await saveSections(701, {
    revision: retired.revision,
    sections: retired.sections.map((s) =>
      s.key === "housing" ? { ...s, replacementKey: "schools" } : s,
    ),
  });
  assert.equal(
    await resolveSectionKey(701, "legacy"),
    "schools",
    "old aliases follow later retirements",
  );
});

it("rejects stale revisions, foreign/proposed source assignments and invalid retirements atomically", async () => {
  const sql = await getSql();
  const [foreign] = await sql<{
    id: number;
  }>`insert into sources (user_id,newsroom_id,url,title,status) values ('section-source',712,'https://example.org/foreign','Foreign','accepted') returning id`;
  const [proposed] = await sql<{
    id: number;
  }>`insert into sources (user_id,newsroom_id,url,title,status) values ('section-source',711,'https://example.org/proposed','Proposed','proposed') returning id`;
  const initial = await getSections(711);
  for (const sourceId of [foreign!.id, proposed!.id]) {
    await assert.rejects(
      saveSections(711, {
        revision: initial.revision,
        sections: initial.sections.map((s) =>
          s.key === "housing" ? { ...s, sourceIds: [sourceId] } : s,
        ),
      }),
      /accepted.*newsroom/i,
    );
    assert.deepEqual(await getSections(711), initial);
  }
  await assert.rejects(
    saveSections(711, {
      revision: initial.revision,
      sections: initial.sections.map((s) =>
        s.key === "housing" ? { ...s, replacementKey: "missing" } : s,
      ),
    }),
    /replacement/i,
  );
  const saved = await saveSections(711, initial);
  await assert.rejects(saveSections(711, initial), /changed.*reload/i);
  assert.equal(saved.revision, initial.revision + 1);
});
