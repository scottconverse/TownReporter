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
  const city = await add("https://city.example.test/", "accepted");
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
  // Spec 5f: a suggestion on a website the paper has is attached to that source.
  assert.equal(byId.get(onKnownSite)!.status, "proposed");
  assert.equal(byId.get(onKnownSite)!.review_note, `Same website as source ${city}.`);
  assert.equal(byId.get(social)!.review_note, null);
  const [moved] = await sql<{ kind: string }>`select kind from source_observations where source_id = ${trial.id}`;
  assert.equal(moved!.kind, "promoted");

  // A checked site is not checked again.
  assert.deepEqual(await runIntake(sql, { newsroomId: room, read }), []);
});

it("a suggestion on a website the paper already has is attached to that source and counted there (5f)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9572;
  await sql`insert into newsrooms(id,name) values(${room},'Intake attach fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values('intake-user',${room},${url},${url},'page','C',${status}) returning id`)[0]!.id;
  const paper = await add("https://paper.example.test/", "accepted");
  const one = await add("https://paper.example.test/story-one", "proposed");
  const two = await add("https://www.paper.example.test/story-two", "proposed");
  const read = async (url: string) => {
    throw new Error(`unexpected read ${url}`);
  };

  assert.deepEqual(await runIntake(sql, { newsroomId: room, read }), []);
  const rows = await sql<{ id: number; status: string; review_note: string | null; proposed_count: number }>`
    select id, status, review_note, proposed_count from sources where newsroom_id = ${room} order by id`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get(paper)!.proposed_count, 2);
  assert.equal(byId.get(one)!.status, "proposed");
  assert.equal(byId.get(one)!.review_note, `Same website as source ${paper}.`);
  assert.equal(byId.get(two)!.review_note, `Same website as source ${paper}.`);

  // Written once: a second round leaves the note alone and still counts both.
  await runIntake(sql, { newsroomId: room, read });
  const again = await sql<{ id: number; review_note: string | null; proposed_count: number }>`
    select id, review_note, proposed_count from sources where newsroom_id = ${room} order by id`;
  assert.equal(again.find((r) => r.id === paper)!.proposed_count, 2);
  assert.equal(again.find((r) => r.id === one)!.review_note, `Same website as source ${paper}.`);
});

it("a new suggestion on a dormant source's website puts it back on trial (5b)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9573;
  await sql`insert into newsrooms(id,name) values(${room},'Intake dormant fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values('intake-user',${room},${url},${url},'page','C',${status}) returning id`)[0]!.id;
  const dormant = await add("https://quiet.example.test/", "dormant");
  const old = await add("https://quiet.example.test/old-story", "proposed");
  await sql`update sources set reviewed_at = now(), review_note = 'Already looked at.' where id = ${old}`;
  const read = async (url: string) => {
    throw new Error(`unexpected read ${url}`);
  };

  // An old, already reviewed suggestion does not wake it.
  await runIntake(sql, { newsroomId: room, read });
  const [before] = await sql<{ status: string }>`select status from sources where id = ${dormant}`;
  assert.equal(before!.status, "dormant");

  // A NEW suggestion on the same website does.
  await add("https://quiet.example.test/new-story", "proposed");
  await runIntake(sql, { newsroomId: room, read });
  const [after] = await sql<{ status: string; proposed_count: number }>`
    select status, proposed_count from sources where id = ${dormant}`;
  assert.equal(after!.status, "trial");
  assert.equal(after!.proposed_count, 2);
  const [moved] = await sql<{ kind: string; note: string }>`
    select kind, note from source_observations where source_id = ${dormant} order by id desc limit 1`;
  assert.equal(moved!.kind, "promoted");
  assert.equal(moved!.note, "A new link on its website was suggested. Trial started again.");
});
