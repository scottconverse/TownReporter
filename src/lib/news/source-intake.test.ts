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
  const checked = await runIntake(sql, { newsroomId: room, placeNames: [], read });
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
  assert.deepEqual(await runIntake(sql, { newsroomId: room, placeNames: [], read }), []);
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

  assert.deepEqual(await runIntake(sql, { newsroomId: room, placeNames: [], read }), []);
  const rows = await sql<{ id: number; status: string; review_note: string | null; proposed_count: number }>`
    select id, status, review_note, proposed_count from sources where newsroom_id = ${room} order by id`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get(paper)!.proposed_count, 2);
  assert.equal(byId.get(one)!.status, "proposed");
  assert.equal(byId.get(one)!.review_note, `Same website as source ${paper}.`);
  assert.equal(byId.get(two)!.review_note, `Same website as source ${paper}.`);

  // Written once: a second round leaves the note alone and still counts both.
  await runIntake(sql, { newsroomId: room, placeNames: [], read });
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
  await runIntake(sql, { newsroomId: room, placeNames: [], read });
  const [before] = await sql<{ status: string }>`select status from sources where id = ${dormant}`;
  assert.equal(before!.status, "dormant");

  // A NEW suggestion on the same website does.
  await add("https://quiet.example.test/new-story", "proposed");
  await runIntake(sql, { newsroomId: room, placeNames: [], read });
  const [after] = await sql<{ status: string; proposed_count: number }>`
    select status, proposed_count from sources where id = ${dormant}`;
  assert.equal(after!.status, "trial");
  assert.equal(after!.proposed_count, 2);
  const [moved] = await sql<{ kind: string; note: string }>`
    select kind, note from source_observations where source_id = ${dormant} order by id desc limit 1`;
  assert.equal(moved!.kind, "promoted");
  assert.equal(moved!.note, "A new link on its website was suggested. Trial started again.");
});

it("a suggested website that never names the paper's place stays a suggestion (D176)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9574;
  await sql`insert into newsrooms(id,name) values(${room},'Intake home-area fixture')`;
  const add = async (url: string, status: string) =>
    (await sql<{ id: number }>`insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
      values('intake-user',${room},${url},${url},'page','C',${status}) returning id`)[0]!.id;
  const away = await add("https://www.nyc.gov/news/budget-hearing", "proposed");
  const home = await add("https://www.longmontcolorado.gov/news/library-open", "proposed");
  const placeNames = ["Longmont", "Boulder County"];

  const read = async (url: string) => {
    if (url === "https://www.nyc.gov/")
      return { text: "Budget hearing Oct. 2. Council meets Oct. 9. Parade Oct. 14. Vote Oct. 21. Fair Oct. 28." };
    if (url === "https://www.longmontcolorado.gov/")
      return { text: "Longmont: library open Oct. 2. Council meets Oct. 9. Parade Oct. 14. Vote Oct. 21. Fair Oct. 28." };
    throw new Error(`unexpected read ${url}`);
  };
  assert.deepEqual((await runIntake(sql, { newsroomId: room, placeNames, read })).sort(), [
    "longmontcolorado.gov",
    "nyc.gov",
  ]);

  const rows = await sql<{ id: number; url: string; status: string; review_note: string | null }>`
    select id, url, status, review_note from sources where newsroom_id = ${room} order by id`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(rows.find((r) => r.url === "https://www.nyc.gov/"), undefined);
  assert.equal(byId.get(away)!.status, "proposed");
  assert.match(byId.get(away)!.review_note!, /not tried, because the page does not name Longmont or Boulder County/);
  const [observation] = await sql<{ kind: string; note: string; observed_by: string }>`
    select kind, note, observed_by from source_observations where source_id = ${away}`;
  assert.equal(observation!.kind, "not-local");
  assert.equal(observation!.note, byId.get(away)!.review_note);
  assert.equal(observation!.observed_by, "trial-pass");

  const trial = rows.find((r) => r.url === "https://www.longmontcolorado.gov/")!;
  assert.equal(trial.status, "trial");
  assert.equal(byId.get(home)!.review_note, `Its site is on trial as source ${trial.id}.`);
});

it("a dated site whose host names the paper's city goes on trial (D182 rule 2)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9576;
  await sql`insert into newsrooms(id,name) values(${room},'Intake host fixture')`;
  const [suggestion] = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values('intake-user',${room},'https://www.artslongmont.org/events/art-walk','arts','page','C','proposed')
    returning id`;
  const placeNames = ["Longmont", "Boulder County"];
  const read = async () => ({
    // Five dates, and no place name anywhere in the extracted text.
    text: "Art walk Oct. 2. Gallery night Oct. 9. Open studio Oct. 14. Concert Oct. 21. Fair Oct. 28.",
  });

  assert.deepEqual(await runIntake(sql, { newsroomId: room, placeNames, read }), ["artslongmont.org"]);
  const [trial] = await sql<{ id: number; status: string }>`
    select id, status from sources where newsroom_id = ${room} and url = 'https://www.artslongmont.org/'`;
  assert.equal(trial!.status, "trial");
  const [note] = await sql<{ review_note: string }>`select review_note from sources where id = ${suggestion!.id}`;
  assert.equal(note!.review_note, `Its site is on trial as source ${trial!.id}.`);
});

it("a site that names the paper's place only in its full page text goes on trial (D182 rule 3)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9577;
  await sql`insert into newsrooms(id,name) values(${room},'Intake raw-text fixture')`;
  await sql`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values('intake-user',${room},'https://www.stvrain.k12.co.us/calendars/board-meeting','svvSD','page','C','proposed')`;
  const placeNames = ["Longmont", "Boulder County"];
  const read = async (url: string) => {
    assert.equal(url, "https://www.stvrain.k12.co.us/");
    return {
      // The article body has the dates but not the city.
      text: "Board meeting Oct. 2. Late start Oct. 9. Conferences Oct. 14. Holiday Oct. 21. Break Oct. 28.",
      // The header and footer do, and article extraction drops them.
      rawText: "St. Vrain Valley Schools — 395 S. Pratt Parkway, Longmont, CO 80501. Board meeting Oct. 2.",
    };
  };

  assert.deepEqual(await runIntake(sql, { newsroomId: room, placeNames, read }), ["stvrain.k12.co.us"]);
  const [trial] = await sql<{ status: string }>`
    select status from sources where newsroom_id = ${room} and url = 'https://www.stvrain.k12.co.us/'`;
  assert.equal(trial!.status, "trial");
});

it("a far-away site naming the place nowhere stays a suggestion (D182)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9578;
  await sql`insert into newsrooms(id,name) values(${room},'Intake nowhere fixture')`;
  const [away] = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values('intake-user',${room},'https://www.nyc.gov/news/budget-hearing','nyc','page','C','proposed')
    returning id`;
  const placeNames = ["Longmont", "Boulder County"];
  const read = async () => ({
    text: "Budget hearing Oct. 2. Council meets Oct. 9. Parade Oct. 14. Vote Oct. 21. Fair Oct. 28.",
    rawText: "City of New York. Budget hearing Oct. 2. Council meets Oct. 9. Parade Oct. 14.",
  });

  assert.deepEqual(await runIntake(sql, { newsroomId: room, placeNames, read }), ["nyc.gov"]);
  const [row] = await sql<{ status: string; review_note: string | null }>`
    select status, review_note from sources where id = ${away!.id}`;
  assert.equal(row!.status, "proposed");
  assert.match(row!.review_note!, /not tried, because the page does not name Longmont or Boulder County/);
  const [observation] = await sql<{ kind: string }>`
    select kind from source_observations where source_id = ${away!.id}`;
  assert.equal(observation!.kind, "not-local");
});

it("with no place set, a dated far-away website still goes on trial (D176)", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const room = 9575;
  await sql`insert into newsrooms(id,name) values(${room},'Intake no-place fixture')`;
  const [suggestion] = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values('intake-user',${room},'https://www.nyc.gov/news/budget-hearing','nyc','page','C','proposed') returning id`;
  const read = async () => ({
    text: "Budget hearing Oct. 2. Council meets Oct. 9. Parade Oct. 14. Vote Oct. 21. Fair Oct. 28.",
  });

  assert.deepEqual(await runIntake(sql, { newsroomId: room, placeNames: [], read }), ["nyc.gov"]);
  const [trial] = await sql<{ id: number; status: string }>`
    select id, status from sources where newsroom_id = ${room} and url = 'https://www.nyc.gov/'`;
  assert.equal(trial!.status, "trial");
  const [note] = await sql<{ review_note: string }>`select review_note from sources where id = ${suggestion!.id}`;
  assert.equal(note!.review_note, `Its site is on trial as source ${trial!.id}.`);
});
