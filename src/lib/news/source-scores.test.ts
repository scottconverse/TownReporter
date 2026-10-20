import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { loadSourceScores } from "./source-scores.ts";
import { proposalsBySite } from "./source-intake.ts";
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
  /*
    Spec 6a's "Last observation" column: the newest `source_observations` row
    for that source, kind and date. The trial source was moved twice, so its
    newest observation is the editor's move "up" into trial; a source nothing
    has been recorded about reads as null -- "nothing recorded yet", not a
    made-up word.
  */
  const byId = new Map(data.rows.map((r) => [r.id, r]));
  assert.equal(byId.get(trial)!.lastObservationKind, "promoted");
  assert.ok(byId.get(trial)!.lastObservationAt);
  assert.equal(byId.get(high)!.lastObservationKind, null);
  assert.equal(byId.get(high)!.lastObservationAt, null);
});

it("suggestions come back one row per website, biggest first, on suggestedSites (5f)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9582;
  await sql`insert into newsrooms(id,name) values(${room},'Suggested sites fixture')`;
  const add = async (url: string, note: string | null) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status,review_note)
      values('scores-user',${room},${url},${url},'page','C','proposed',${note}) returning id`)[0]!.id;
  await add("https://one.example.test/a", null);
  await add("https://one.example.test/b", null);
  await add("https://www.one.example.test/c", "Same website as source 9.");
  await add("https://two.example.test/", null);
  await add("https://two.example.test/story", null);
  await add("https://two.example.test/feed", null);
  await add("https://three.example.test/only", null);

  const sites = await proposalsBySite(sql, room);
  assert.deepEqual(
    sites.map((s) => [s.site, s.count, s.firstUrl, s.note]),
    [
      ["one.example.test", 3, "https://one.example.test/a", "Same website as source 9."],
      ["two.example.test", 3, "https://two.example.test/", null],
      ["three.example.test", 1, "https://three.example.test/only", null],
    ],
  );
  const data = await loadSourceScores(sql, room);
  assert.deepEqual(data.suggestedSites, sites);
});
