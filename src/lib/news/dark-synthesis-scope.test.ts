import { it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getSql } from "../db.ts";
import { ensureInvestigateSchema } from "./investigate.ts";
import { buildDarkSynthesisPack, ensureDarkSchema } from "./dark.ts";
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
