import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { fileScanLeads } from "./lead-filing.ts";

/*
  Dynamic sources unit 1 (D169, Scott Oct 20 2026: "ALL THREE AGREE"). Each new
  lead a scan files records the source it came from (`leads.source_id`), and
  that source's log gets one `produced-lead` row per lead. Real migrations,
  real fileScanLeads.
*/

await applyMigrationsToTestPglite();

it("a scan's new leads record their source, one produced-lead row each", async () => {
  const sql = await getSql();
  const room = 9531;
  const user = "lead-source-user";
  await sql`insert into newsrooms(id,name) values(${room},'Lead source fixture')`;
  const [a] = await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values(${user},${room},'https://www.leader.example.test/local-news','Leader local news','page','B','accepted') returning id`;
  const [b] = await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values(${user},${room},'https://city.example.test/agendas','City agendas','page','A','accepted') returning id`;
  const [run] = await sql<{ id: number }>`insert into scan_runs(user_id,newsroom_id) values(${user},${room}) returning id`;

  const read = [
    { id: a!.id, url: "https://www.leader.example.test/local-news" },
    { id: b!.id, url: "https://city.example.test/agendas", extras: [{ url: "https://city.example.test/agendas/oct-28.pdf" }] },
  ];
  const lead = (headline: string, url: string) => ({
    headline, why: "Residents are affected.", topic: "council", source_urls: [url],
    evidence: "The page says so.", newsworthiness: 7, is_event: true,
  });
  const result = await fileScanLeads(sql, { userId: user }, room, run!.id, [
    lead("Library opens a second branch on Nov. 9 in east Longmont", "https://leader.example.test/local-news/library-branch-123"),
    lead("Bus route 324 ends Dec. 1 after ridership falls by half", "https://www.leader.example.test/local-news/bus-route-324"),
    lead("Council votes Oct. 28 on a $4 million water main contract", "https://city.example.test/agendas/oct-28.pdf"),
    lead("County fair board picks a new manager for the 2027 season", "https://elsewhere.example.test/fair"),
  ], [], null, null, undefined, read);
  assert.equal(result.leadsCreated, 4);

  const rows = await sql<{ headline: string; source_id: number | null }>`
    select headline, source_id from leads where newsroom_id = ${room} order by id`;
  assert.deepEqual(rows.map((row) => row.source_id), [a!.id, a!.id, b!.id, null]);

  const observed = await sql<{ source_id: number; lead_id: number }>`
    select o.source_id, o.lead_id from source_observations o
    where o.newsroom_id = ${room} and o.kind = 'produced-lead' and o.scan_run_id = ${run!.id} order by o.id`;
  const ids = await sql<{ id: number }>`select id from leads where newsroom_id = ${room} order by id`;
  assert.deepEqual(observed, [
    { source_id: a!.id, lead_id: ids[0]!.id },
    { source_id: a!.id, lead_id: ids[1]!.id },
    { source_id: b!.id, lead_id: ids[2]!.id },
  ]);
});
