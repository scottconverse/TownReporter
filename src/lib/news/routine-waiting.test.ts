import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { listWaitingRoundupsFor, publishWaitingRoundupFor } from "./routine-waiting.ts";

await applyMigrationsToTestPglite();

const ROOM_A = 9711;
const ROOM_B = 9712;
let revisionCounter = 0;

beforeEach(async () => {
  const sql = await getSql();
  for (const room of [ROOM_A, ROOM_B]) {
    await sql.query("delete from routine_notice_publications where newsroom_id=$1", [room]);
    await sql.query("delete from routine_notice_runs where newsroom_id=$1", [room]);
    await sql.query("delete from articles where newsroom_id=$1", [room]);
    await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
      room,
      `room-${room}`,
    ]);
    await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [room]);
    await sql.query(
      "insert into newsroom_sections(newsroom_id,key,name,visible,position) values($1,'news','News',true,1) on conflict do nothing",
      [room],
    );
  }
});

async function seedRoundup(room: number, slug: string, status: string): Promise<number> {
  const sql = await getSql();
  revisionCounter += 1;
  const runRows = await sql.query<{ id: number }>(
    "insert into routine_notice_runs(newsroom_id, local_date, automation_revision, policy_revision, status, actor) values($1,'2026-11-02',$2,1,'completed','w-owner') returning id",
    [room, revisionCounter],
  );
  const runId = runRows[0].id;
  const articleRows = await sql.query<{ id: number }>(
    "insert into articles(user_id,newsroom_id,slug,headline,body,topic,status) values('w-owner',$1,$2,'Today in town','x','news',$3) returning id",
    [room, slug, status],
  );
  const articleId = articleRows[0].id;
  await sql.query(
    "insert into routine_notice_publications(newsroom_id, run_id, channel, issue_date, article_id, content_fingerprint, article_body_hash) values($1,$2,'today','2026-11-02',$3,'f','h')",
    [room, runId, articleId],
  );
  return articleId;
}

test("a waiting roundup is listed; publish returns ok and hides it; second publish fails", async () => {
  const sql = await getSql();
  const articleId = await seedRoundup(ROOM_A, "today-waiting", "waiting");

  const listed = await listWaitingRoundupsFor(sql, ROOM_A);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, articleId);
  assert.equal(listed[0].slug, "today-waiting");
  assert.equal(listed[0].channel, "today");
  assert.equal(listed[0].issueDate, "2026-11-02");

  const first = await publishWaitingRoundupFor(sql, ROOM_A, articleId);
  assert.deepEqual(first, { ok: true, slug: "today-waiting" });

  const rows = await sql.query<{ status: string }>(
    "select status from articles where id=$1",
    [articleId],
  );
  assert.equal(rows[0].status, "published");

  const after = await listWaitingRoundupsFor(sql, ROOM_A);
  assert.equal(after.length, 0);

  const second = await publishWaitingRoundupFor(sql, ROOM_A, articleId);
  assert.equal(second.ok, false);
});

test("an ordinary waiting article without a publications row cannot be published", async () => {
  const sql = await getSql();
  const rows = await sql.query<{ id: number }>(
    "insert into articles(user_id,newsroom_id,slug,headline,body,topic,status) values('w-owner',$1,'plain-waiting','Plain','x','news','waiting') returning id",
    [ROOM_A],
  );
  const articleId = rows[0].id;

  const listed = await listWaitingRoundupsFor(sql, ROOM_A);
  assert.equal(listed.length, 0);

  const result = await publishWaitingRoundupFor(sql, ROOM_A, articleId);
  assert.equal(result.ok, false);

  const check = await sql.query<{ status: string }>(
    "select status from articles where id=$1",
    [articleId],
  );
  assert.equal(check[0].status, "waiting");
});

test("a waiting roundup in another room cannot be published from this room", async () => {
  const sql = await getSql();
  const articleId = await seedRoundup(ROOM_B, "other-room", "waiting");

  const listed = await listWaitingRoundupsFor(sql, ROOM_A);
  assert.equal(listed.length, 0);

  const result = await publishWaitingRoundupFor(sql, ROOM_A, articleId);
  assert.equal(result.ok, false);

  const check = await sql.query<{ status: string }>(
    "select status from articles where id=$1",
    [articleId],
  );
  assert.equal(check[0].status, "waiting");
});
