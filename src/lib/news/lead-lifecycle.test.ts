// guards: a saved draft or published article can lose its story link after a backward status change.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { SqlTag } from "./lead-filing.ts";
import { resolveLeadDuplicateForEditor, setLeadStatusForEditor } from "./lead-lifecycle.ts";

function makeSql(db: PGlite): SqlTag {
  return async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  };
}

test("drafted and published leads refuse backward status changes and duplicate reopen", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, killed_at timestamptz, kill_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default 'Saved prose', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status,possible_duplicate_of,killed_at,kill_reason,kill_reason_url) values (1,7,'drafted',null,null,null,null),(2,7,'published',null,null,null,null),(3,7,'held',1,null,null,null),(4,7,'held',2,null,null,null);
      insert into drafts(id,lead_id,newsroom_id) values (1,1,7);
      insert into articles values (1,2,7,'published');`);
    const sql = makeSql(db);
    const results = await Promise.all([
      setLeadStatusForEditor(sql, 7, { id: 1, status: "new" }),
      setLeadStatusForEditor(sql, 7, { id: 2, status: "held" }),
      resolveLeadDuplicateForEditor(sql, 7, { id: 3, action: "reopen-prior" }),
      resolveLeadDuplicateForEditor(sql, 7, { id: 4, action: "reopen-prior" }),
    ]);
    assert.deepEqual(results.map((result) => result.ok), [false, false, false, false]);
    const rows = await sql<{ id: number; status: string; possible_duplicate_of: number | null }>`
      select id, status, possible_duplicate_of from leads order by id
    `;
    assert.deepEqual(rows.map(({ id, status, possible_duplicate_of }) => [id, status, possible_duplicate_of]), [
      [1, "drafted", null], [2, "published", null], [3, "held", 1], [4, "held", 2],
    ]);
  } finally {
    await db.close();
  }
});

// guards: empty hand-filed placeholders can trap leads in New or Killed while real prose must stay protected.
test("empty placeholder drafts allow hold and duplicate reopen while prose and imports stay protected", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, notes_json text);
      create table drafts(lead_id integer, newsroom_id integer, body text, research_json text);
      create table articles(lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status,possible_duplicate_of) values (1,7,'new',null),(2,7,'killed',null),(3,7,'held',2),(4,7,'new',null),(5,7,'killed',null),(6,7,'held',5),(7,7,'new',null);
      insert into drafts values (1,7,'','{}'),(2,7,E' \t\n','{}'),(4,7,'Saved prose','{}'),(5,7,'','{"importedText":true}'),(7,7,'','{}');
      insert into articles values (7,7,'published');`);
    const sql = makeSql(db);
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 1, status: "held" })).ok, true);
    assert.equal((await resolveLeadDuplicateForEditor(sql, 7, { id: 3, action: "reopen-prior" })).ok, true);
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 4, status: "held" })).ok, false);
    assert.equal((await resolveLeadDuplicateForEditor(sql, 7, { id: 6, action: "reopen-prior" })).ok, false);
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 7, status: "held" })).ok, false);
    assert.deepEqual((await sql<{ status: string }>`select status from leads order by id`).map(row => row.status),
      ["held", "new", "held", "new", "killed", "held", "new"]);
  } finally {
    await db.close();
  }
});
