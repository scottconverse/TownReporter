// guards: an editor's section choice on a lead without a draft could be lost on reload.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSql } from "../db.ts";
import { saveLeadTopicForEditor } from "./lead-topic.server.ts";

test("saves the selected section on a lead without creating a draft", async () => {
  const sql = await getSql();
  await sql.query(`create table leads (id integer primary key, newsroom_id integer, status text,
    topic text, topic_unchosen boolean default true, edited_at timestamptz, edited_by text)`);
  await sql.query(
    "create table drafts (id integer primary key, lead_id integer, newsroom_id integer)",
  );
  await sql.query(
    "insert into leads (id, newsroom_id, status, topic) values (435, 1, 'new', 'budget')",
  );
  await saveLeadTopicForEditor(
    { userId: "editor", newsroomId: 1 },
    { leadId: 435, topic: "community" },
  );
  const [saved] = await sql.query(
    "select topic, topic_unchosen, edited_by from leads where id = 435",
  );
  assert.deepEqual(saved, { topic: "community", topic_unchosen: false, edited_by: "editor" });
  assert.equal((await sql.query("select * from drafts")).length, 0);
});
