import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { loadSourceScores } from "./source-scores.ts";
import { moveSource } from "./source-trials.ts";

/* Dynamic sources unit 8 (D169): what the Source inventory screen shows. */

it("counts each status, lists the latest moves with who made them, and sorts by score", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9581;
  await sql`insert into newsrooms(id,name) values(${room},'Scores fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values('scores-user',${room},${url},${url},'page','C',${status}) returning id`)[0]!.id;
  const low = await add("https://low.example.test/", "accepted");
  const high = await add("https://high.example.test/", "accepted");
  const trial = await add("https://trial.example.test/", "trial");
  await add("https://a.example.test/one", "proposed");
  await add("https://www.a.example.test/two", "proposed");
  await add("https://b.example.test/", "proposed");
  await sql`insert into source_yield(source_id,newsroom_id,reads_90,leads_90,leads_per_read,published_per_read)
    values(${low},${room},10,1,0.1,0), (${high},${room},10,5,0.5,0.1)`;
  await moveSource(sql, { newsroomId: room, sourceId: trial, to: "dormant", why: "Trial ended." });
  await moveSource(sql, { newsroomId: room, sourceId: trial, to: "trial", why: "The editor put it on trial.", by: "editor" });

  const data = await loadSourceScores(sql, room);
  assert.deepEqual(data.counts, { accepted: 2, trial: 1, dormant: 0, suggestedSites: 2 });
  assert.deepEqual(
    data.moves.map((m) => [m.sourceId, m.kind, m.by, m.statusNow]),
    [[trial, "promoted", "editor", "trial"], [trial, "demoted", "trial-pass", "trial"]],
  );
  assert.deepEqual(data.rows.map((r) => r.id), [high, low, trial]);
  assert.equal(data.rows[2]!.score, null);
});
