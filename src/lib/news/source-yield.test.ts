import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { computeSourceYield, tickSourceYield } from "./source-yield.ts";

/*
  Dynamic sources unit 2 (D169): the per-source news score. Real migrations.
  Source A: 3 reads, a published lead (source_id set by unit 1) and an older
  lead with no source_id whose URL is on A's site, killed as a bad source.
  Source B: 1 read, no leads. A rejected source gets no row.
*/

await applyMigrationsToTestPglite();

it("counts reads, leads, published and bad-source kills per source, once a day", async () => {
  const sql = await getSql();
  const room = 9541;
  const user = "source-yield-user";
  await sql`insert into newsrooms(id,name) values(${room},'Source yield fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values(${user},${room},${url},${url},'page','B',${status}) returning id`)[0]!.id;
  const a = await add("https://www.leader.example.test/local-news", "accepted");
  const b = await add("https://city.example.test/agendas", "accepted");
  const rejected = await add("https://spam.example.test/", "rejected");
  const coverage = (ids: number[]) => JSON.stringify(ids.map((sourceId) => ({ sourceId, status: "read" })));
  await sql`insert into scan_runs(user_id,newsroom_id,source_coverage) values(${user},${room},${coverage([a, b])}::jsonb)`;
  await sql`insert into scan_runs(user_id,newsroom_id,source_coverage) values(${user},${room},${coverage([a])}::jsonb)`;
  await sql`insert into scan_runs(user_id,newsroom_id,source_coverage) values(${user},${room},${JSON.stringify([{ sourceId: a, status: "read" }, { sourceId: b, status: "deferred" }])}::jsonb)`;
  const [published] = await sql<{ id: number }>`insert into leads(user_id,newsroom_id,headline,why,source_urls,status,source_id)
    values(${user},${room},'Library opens a branch','Residents',${'["https://leader.example.test/local-news/library"]'},'published',${a}) returning id`;
  await sql`insert into articles(newsroom_id,user_id,slug,headline,status,topic,body,lead_id)
    values(${room},${user},'library-opens-9541','Library opens a branch','published','council','Body.',${published!.id})`;
  await sql`insert into leads(user_id,newsroom_id,headline,why,source_urls,status,kill_reason)
    values(${user},${room},'Old unreadable page','Residents',${'["https://www.leader.example.test/local-news/old"]'},'killed','Bad source or unreadable')`;

  assert.equal(await computeSourceYield(sql, room), 2);
  const rows = await sql<Record<string, unknown>>`
    select source_id, reads_90, leads_90, published_90, killed_90, bad_source_kills_90, round(leads_per_read::numeric, 4)::float8 as leads_per_read, round(published_per_read::numeric, 4)::float8 as published_per_read,
      last_lead_at is not null as has_last_lead, last_published_at is not null as has_last_published
    from source_yield where newsroom_id = ${room} order by source_id`;
  assert.deepEqual(rows, [
    { source_id: a, reads_90: 3, leads_90: 2, published_90: 1, killed_90: 1, bad_source_kills_90: 1,
      leads_per_read: 0.6667, published_per_read: 0.3333, has_last_lead: true, has_last_published: true },
    { source_id: b, reads_90: 1, leads_90: 0, published_90: 0, killed_90: 0, bad_source_kills_90: 0,
      leads_per_read: 0, published_per_read: 0, has_last_lead: false, has_last_published: false },
  ]);
  assert.equal((await sql`select 1 from source_yield where source_id = ${rejected}`).length, 0);

  // The hourly clock leaves fresh rows alone.
  const [before] = await sql<{ at: string }>`select computed_at::text as at from source_yield where source_id = ${a}`;
  await tickSourceYield(sql);
  const [afterTick] = await sql<{ at: string }>`select computed_at::text as at from source_yield where source_id = ${a}`;
  assert.equal(afterTick!.at, before!.at);
});
