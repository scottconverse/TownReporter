import { it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getSql, getPglite } from "../db.ts";
import { ensureSectionsSchema } from "./sections.server.ts";

it("section readiness refuses missing dependencies and recovers instead of caching partial success", async () => {
  const sql = await getSql();
  await assert.rejects(ensureSectionsSchema(), /Section schema is incomplete/);
  assert.deepEqual(await sql`select * from _schema_ensure_state where name='sections'`, []);
  await (await getPglite()).exec(await readFile(new URL("../../../migrations/0002_newsroom.sql", import.meta.url), "utf8"));
  for (const table of ["articles","leads","drafts","scan_runs"]) {
    await sql.query(`alter table ${table} add column newsroom_id integer not null default 1`);
  }
  await ensureSectionsSchema();
  const triggers = await sql`select tgname from pg_trigger where tgname in ('leads_resolve_section','drafts_resolve_section','articles_resolve_section')`;
  assert.equal(triggers.length, 3);
  await sql.query("drop trigger leads_resolve_section on leads");
  await assert.rejects(ensureSectionsSchema(), /Section schema is incomplete/);
  assert.deepEqual(await sql`select * from _schema_ensure_state where name='sections'`, []);
  await ensureSectionsSchema();
  await assert.rejects(sql`insert into leads(user_id,headline,why,topic) values('schema-proof','Example','Reason','not-a-section')`, /Section not found in this newsroom: not-a-section/);
});
