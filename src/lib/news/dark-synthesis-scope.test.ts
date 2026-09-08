import { it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { buildBrief, buildDarkBriefPromptPack, buildDarkSynthesisPack, ensureDarkSchema } from "./dark.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
it("synthesis uses only its newsroom's context and configured city", async () => {
  const sql = await getSql();
  const schema = (
    await readFile(new URL("../../../migrations/0002_newsroom.sql", import.meta.url), "utf8")
  ).split("insert into articles")[0]!;
  for (const statement of schema.split(";").filter((s) => s.trim())) await sql.query(statement);
  for (const table of ["sources", "leads", "articles", "beat_memory"])
    await sql.query(
      `alter table ${table} add column if not exists newsroom_id integer not null default 1`,
    );
  await sql.query(
    "alter table leads add column if not exists resurfaced_count integer not null default 0",
  );
  await ensureInvestigateSchema();
  await ensureDarkSchema();
  await ensurePaperSettingsSchema();
  await sql`insert into paper_settings(newsroom_id,city,state) values (77,'Centennial','Colorado')`;
  await sql`insert into sources(user_id,newsroom_id,title,url) values ('scope',1,'OTHER_SECRET','https://other.example'),('scope',77,'OWN_SOURCE','https://own.example')`;
  await sql`insert into leads(user_id,newsroom_id,headline,why) values ('scope',1,'OTHER_SECRET_LEAD','private'),('scope',77,'OWN_LEAD','own')`;
  await sql`insert into articles(user_id,newsroom_id,slug,headline,body,topic) values ('scope',1,'other','OTHER_SECRET_ARTICLE','x','x'),('scope',77,'own','OWN_ARTICLE','x','x')`;
  await sql`insert into beat_memory(user_id,newsroom_id,entity,last_angle) values ('scope',1,'OTHER_SECRET_MEMORY','private'),('scope',77,'OWN_MEMORY','own')`;
  const inv = (
    await sql<{
      id: number;
    }>`insert into investigations(user_id,newsroom_id,title) values ('scope',77,'Own file') returning id`
  )[0]!.id;
  const pack = await buildDarkSynthesisPack(inv, "", 77);
  assert.doesNotMatch(pack, /OTHER_SECRET/);
  for (const expected of ["OWN_SOURCE", "OWN_LEAD", "OWN_ARTICLE", "OWN_MEMORY", "Centennial"])
    assert.ok(pack.includes(expected), expected);
});

it("synthesis keeps an older focus-matching capture and its stored page evidence over later noise", async () => {
  const sql = await getSql();
  const newsroomId = 78;
  const otherNewsroomId = 79;
  const userId = "synthesis-ranking";
  await sql`insert into paper_settings(newsroom_id,city,state) values (${newsroomId},'Riverton','Colorado')`;
  const inv = (
    await sql<{ id: number }>`
      insert into investigations(user_id,newsroom_id,title)
      values (${userId},${newsroomId},'Cedar annexation FILE-4242')
      returning id
    `
  )[0]!.id;
  // The target begins near the end of a 2,000-character extractor chunk.
  // A brief that clips each selected document to a head prefix loses it.
  const targetText = `${"background ".repeat(710)}\nTARGET_ROW: FILE-4242 Cedar annexation covers the project record.`;
  const version = (
    await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome)
      values (${userId},${newsroomId},'https://records.example/cedar','target-hash','Cedar annexation packet',${targetText},200,'fetched')
      returning id
    `
  )[0]!.id;
  const capture = (
    await sql<{ id: number }>`
      insert into capture_events(user_id,newsroom_id,investigation_id,source_url,version_id,http_status,fetch_outcome,content_hash)
      values (${userId},${newsroomId},${inv},'https://records.example/cedar',${version},200,'fetched','target-hash')
      returning id
    `
  )[0]!.id;
  await sql`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,fetch_status,fetch_outcome,version_id,capture_event_id)
    values (${userId},${newsroomId},${inv},'https://records.example/cedar','Cedar annexation packet','target-hash',${targetText},200,'fetched',${version},${capture})
  `;
  await sql`
    insert into artifact_chunks(version_id,user_id,newsroom_id,chunk_index,page_number,section,excerpt,locator)
    values (${version},${userId},${newsroomId},0,7,'Annexation','Cedar filing table','page:7')
  `;
  await sql`
    insert into artifact_chunks(version_id,user_id,newsroom_id,chunk_index,page_number,section,excerpt,locator)
    values
      (${version},${userId},${newsroomId},3,7,'Annexation','PRECEDING_APPLICANT: Neighbor Holdings LLC','page:7:char:6000-6200'),
      (${version},${userId},${newsroomId},4,7,'Annexation','TARGET_ROW: FILE-4242 Cedar annexation covers the project record.','page:7:char:6200-6400'),
      (${version},${userId},${newsroomId},5,7,'Annexation','APPLICANT_TAIL: Dana, Community Association','page:7:char:6400-6500')
  `;
  for (let i = 0; i < 41; i += 1) {
    await sql`
      insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,fetch_status,fetch_outcome)
      values (${userId},${newsroomId},${inv},${`https://noise.example/${i}`},${`Later unrelated notice ${i}`},${`noise-${i}`},${`unrelated later noise ${i}`},200,'fetched')
    `;
  }
  const otherInv = (
    await sql<{ id: number }>`
      insert into investigations(user_id,newsroom_id,title)
      values (${userId},${otherNewsroomId},'Cedar annexation FILE-4242')
      returning id
    `
  )[0]!.id;
  await sql`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,fetch_status,fetch_outcome)
    values (${userId},${otherNewsroomId},${otherInv},'https://foreign.example/cedar','FOREIGN_TARGET','foreign-target','TARGET_ROW: FOREIGN_SECRET',200,'fetched')
  `;

  const pack = await buildDarkSynthesisPack(inv, "", newsroomId);
  assert.match(pack, /TARGET_ROW: FILE-4242 Cedar annexation/);
  assert.match(pack, new RegExp(`capture:${capture} version:${version} hash:target-hash`));
  assert.match(pack, /page:7/);
  assert.doesNotMatch(pack, /FOREIGN_SECRET|FOREIGN_TARGET/);

  const cappedPack = await buildDarkSynthesisPack(inv, "editor context ".repeat(2_000), newsroomId);
  assert.ok(cappedPack.length <= 28_000, `synthesis pack was ${cappedPack.length} characters`);
  assert.match(cappedPack, /TARGET_ROW: FILE-4242 Cedar annexation/);

  const briefPack = await buildDarkBriefPromptPack(newsroomId, inv);
  assert.ok(briefPack);
  assert.ok(briefPack.length <= 22_000, `brief pack was ${briefPack.length} characters`);
  assert.match(briefPack, /TARGET_ROW: FILE-4242 Cedar annexation/);
  assert.match(briefPack, new RegExp(`capture:${capture} version:${version} hash:target-hash`));
  assert.match(briefPack, /APPLICANT_TAIL: Dana, Community Association/);
  assert.match(briefPack, /page:7:char:6400-6500/);
  assert.doesNotMatch(briefPack, /PRECEDING_APPLICANT: Neighbor Holdings LLC/);
  assert.doesNotMatch(briefPack, /FOREIGN_SECRET|FOREIGN_TARGET/);

  for (let i = 0; i < 30; i += 1) {
    await sql`
      insert into claims(user_id,newsroom_id,investigation_id,body,kind,evidence)
      values (${userId},${newsroomId},${inv},${`long fact ${i} `.repeat(200)},'FACT','recorded')
    `;
  }

  let briefPrompt = "";
  const brief = await buildBrief(
    userId,
    newsroomId,
    inv,
    undefined,
    null,
    async (_system, prompt) => {
      briefPrompt = prompt;
      return { ok: true, text: '{"headline":"Cedar record","tldr":"A captured record is available."}' };
    },
  );
  assert.equal(brief.ok, true);
  assert.match(briefPrompt, /TARGET_ROW: FILE-4242 Cedar annexation/);
  assert.match(briefPrompt, new RegExp(`capture:${capture} version:${version} hash:target-hash`));
  assert.match(briefPrompt, /APPLICANT_TAIL: Dana, Community Association/);
  assert.match(briefPrompt, /page:7:char:6400-6500/);
  assert.doesNotMatch(briefPrompt, /PRECEDING_APPLICANT: Neighbor Holdings LLC/);
});

it("keeps readable evidence without focus tokens and collapses duplicate versions before the cap", async () => {
  const sql = await getSql();
  const userId = "synthesis-empty-focus";
  const emptyRoom = 80;
  await sql`insert into paper_settings(newsroom_id,city,state) values (${emptyRoom},'Riverton','Colorado')`;
  const emptyInv = (
    await sql<{ id: number }>`
      insert into investigations(user_id,newsroom_id,title)
      values (${userId},${emptyRoom},'AI tax')
      returning id
    `
  )[0]!.id;
  await sql`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,fetch_status,fetch_outcome)
    values (${userId},${emptyRoom},${emptyInv},'https://records.example/short-focus','Short focus record','empty-focus','EMPTY_FOCUS_EVIDENCE remains readable without a four-character query token.',200,'fetched')
  `;
  const emptyPack = await buildDarkSynthesisPack(emptyInv, "", emptyRoom);
  assert.match(emptyPack, /EMPTY_FOCUS_EVIDENCE/);

  const duplicateRoom = 81;
  await sql`insert into paper_settings(newsroom_id,city,state) values (${duplicateRoom},'Riverton','Colorado')`;
  const duplicateInv = (
    await sql<{ id: number }>`
      insert into investigations(user_id,newsroom_id,title)
      values (${userId},${duplicateRoom},'Cedar annexation FILE-4242')
      returning id
    `
  )[0]!.id;
  const targetVersion = (
    await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome)
      values (${userId},${duplicateRoom},'https://records.example/target','target-version','Cedar annexation FILE-4242','Cedar annexation FILE-4242 UNIQUE_VERSION_TARGET',200,'fetched')
      returning id
    `
  )[0]!.id;
  const duplicateVersion = (
    await sql<{ id: number }>`
      insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome)
      values (${userId},${duplicateRoom},'https://records.example/repeated','repeated-version','Cedar annexation FILE-4242','Cedar annexation FILE-4242 duplicate capture',200,'fetched')
      returning id
    `
  )[0]!.id;
  await sql`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,fetch_status,fetch_outcome,version_id)
    values (${userId},${duplicateRoom},${duplicateInv},'https://records.example/target','Cedar annexation FILE-4242','target-version','Cedar annexation FILE-4242 UNIQUE_VERSION_TARGET',200,'fetched',${targetVersion})
  `;
  for (let i = 0; i < 8; i += 1) {
    await sql`
      insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,fetch_status,fetch_outcome,version_id)
      values (${userId},${duplicateRoom},${duplicateInv},${`https://records.example/repeated/${i}`},'Cedar annexation FILE-4242','repeated-version','Cedar annexation FILE-4242 duplicate capture',200,'fetched',${duplicateVersion})
    `;
  }
  const duplicatePack = await buildDarkSynthesisPack(duplicateInv, "", duplicateRoom);
  assert.match(duplicatePack, /UNIQUE_VERSION_TARGET/);
  assert.equal((duplicatePack.match(new RegExp(`version:${duplicateVersion} hash:repeated-ver`, "g")) ?? []).length, 1);
});
