import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { pageToTry, runIntake } from "./source-intake.ts";

/* Dynamic sources unit 7 (D169), spec 5f. */

it("checks the front page for an article suggestion, the page itself for a list or feed", () => {
  assert.equal(pageToTry("https://www.leader.example.test/local-news/library-opens-123"), "https://www.leader.example.test/");
  assert.equal(pageToTry("https://club.example.test/events/"), "https://club.example.test/events/");
  assert.equal(pageToTry("https://club.example.test/feed/"), "https://club.example.test/feed/");
  assert.equal(pageToTry("https://state.example.test/news/press-releases/a-story"), "https://state.example.test/");
});

it("a new suggested site with dated items goes on trial; others stay suggestions with a reason", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9571;
  await sql`insert into newsrooms(id,name) values(${room},'Intake fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values('intake-user',${room},${url},${url},'page','C',${status}) returning id`)[0]!.id;
  await add("https://city.example.test/", "accepted");
  const onKnownSite = await add("https://city.example.test/parks/new-trail", "proposed");
  const goodA = await add("https://club.example.test/2026/10/fall-fair", "proposed");
  const goodB = await add("https://club.example.test/2026/09/bake-sale", "proposed");
  const thin = await add("https://thin.example.test/about", "proposed");
  const social = await add("https://www.facebook.com/somepage", "proposed");

  const read = async (url: string) => {
    if (url === "https://club.example.test/") return { text: "Fall fair Oct. 12. Bake sale Sept. 3. Meeting 11/02/2026." };
    if (url === "https://thin.example.test/") return { text: "Welcome to our site." };
    throw new Error(`unexpected read ${url}`);
  };
  const checked = await runIntake(sql, { newsroomId: room, read });
  assert.deepEqual(checked.sort(), ["club.example.test", "thin.example.test"]);

  const rows = await sql<{ id: number; url: string; status: string; review_note: string | null }>`
    select id, url, status, review_note from sources where newsroom_id = ${room} order by id`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const trial = rows.find((r) => r.url === "https://club.example.test/")!;
  assert.equal(trial.status, "trial");
  assert.equal(byId.get(goodA)!.status, "proposed");
  assert.equal(byId.get(goodA)!.review_note, `Its site is on trial as source ${trial.id}.`);
  assert.equal(byId.get(goodB)!.review_note, `Its site is on trial as source ${trial.id}.`);
  assert.equal(byId.get(thin)!.status, "proposed");
  assert.match(byId.get(thin)!.review_note!, /not tried, because the page shows 0 dates/);
  assert.equal(byId.get(onKnownSite)!.review_note, null);
  assert.equal(byId.get(social)!.review_note, null);
  const [moved] = await sql<{ kind: string }>`select kind from source_observations where source_id = ${trial.id}`;
  assert.equal(moved!.kind, "promoted");

  // A checked site is not checked again.
  assert.deepEqual(await runIntake(sql, { newsroomId: room, read }), []);
});
