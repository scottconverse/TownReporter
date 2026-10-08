// guards: an editor's section choice on a lead without a draft could be lost on reload.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { saveLeadTopicForEditor } from "./lead-topic.server.ts";

await applyMigrationsToTestPglite();

test("saves the selected section on a lead without creating a draft", async () => {
  const sql = await getSql();
  await sql.query("insert into newsrooms (id, name) values (435, 'Lead section test')");
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads (newsroom_id, user_id, headline, why, topic, topic_unchosen) values (435, 'editor', 'Budget hearing', 'Fixture', 'budget', true) returning id",
  );
  await sql.query(
    "insert into newsroom_sections (newsroom_id, key, name, position) values (435, 'community', 'Community', 11)",
  );
  await saveLeadTopicForEditor(
    { userId: "editor", newsroomId: 435 },
    { leadId: lead.id, topic: "community" },
  );
  const [saved] = await sql.query(
    "select topic, topic_unchosen, edited_by from leads where id = $1", [lead.id],
  );
  assert.deepEqual(saved, { topic: "community", topic_unchosen: false, edited_by: "editor" });
  assert.equal((await sql.query("select id from drafts where lead_id = $1", [lead.id])).length, 0);
});
