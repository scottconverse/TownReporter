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
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_reason_url text, notes_json text);
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

test("Not a duplicate moves a killed lead to New and clears its duplicate link", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status,possible_duplicate_of,killed_at,kill_reason,kill_reason_url)
      values (11,7,'killed',10,now(),'Already covered',null);`);
    const sql = makeSql(db);
    const result = await resolveLeadDuplicateForEditor(sql, 7, { id: 11, action: "not-a-duplicate" });
    assert.equal(result.ok, true);
    const [lead] = await sql<{ status: string; possible_duplicate_of: number | null }>`
      select status, possible_duplicate_of from leads where id = 11
    `;
    assert.deepEqual(lead, { status: "new", possible_duplicate_of: null });
  } finally {
    await db.close();
  }
});

// guards: DHC06 -- Undo and "Bring back" must return a killed lead to the status it held before the kill, and DHC09 -- a second kill must keep the first kill record and add the duplicate note.
test("a kill remembers the prior status, and a second kill keeps the first record and appends the note", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, kill_prior_status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_prior_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status) values (1,7,'held'),(2,7,'new');`);
    const sql = makeSql(db);
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 1, status: "killed", killReason: "Not news" })).ok, true);
    const [first] = await sql<{ status: string; kill_prior_status: string; killed_at: string; kill_reason: string }>`
      select status, kill_prior_status, killed_at::text, kill_reason from leads where id = 1
    `;
    assert.equal(first.status, "killed");
    assert.equal(first.kill_prior_status, "held");
    assert.equal(first.kill_reason, "Not news");
    await db.query("select pg_sleep(0.01)");
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 1, status: "killed", killReason: "Same story as lead 9" })).ok, true);
    const [second] = await sql<{ kill_prior_status: string; killed_at: string; kill_reason: string }>`
      select kill_prior_status, killed_at::text, kill_reason from leads where id = 1
    `;
    assert.equal(second.kill_prior_status, "held", "the second kill must not overwrite the status before the first kill");
    assert.equal(second.killed_at, first.killed_at, "the first kill time is kept");
    assert.equal(second.kill_reason, "Not news · Killed again: Same story as lead 9", "DHD2-8: the repeated note is separated, not run on");
    await setLeadStatusForEditor(sql, 7, { id: 2, status: "killed" });
    const [untouched] = await sql<{ kill_prior_status: string }>`select kill_prior_status from leads where id = 2`;
    assert.equal(untouched.kill_prior_status, "new");
  } finally {
    await db.close();
  }
});

// guards: DHD2-3 -- a kill with no reason typed keeps the reason the lead already has, and the first kill remembers it so Undo can put it back.
test("a kill with no reason typed keeps the lead's reason, and remembers it for Undo", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, kill_prior_status text, kill_prior_reason text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status,kill_reason) values (3,7,'held','Covered last week');`);
    const sql = makeSql(db);
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 3, status: "killed" })).ok, true);
    const [killed] = await sql<{ status: string; kill_reason: string | null; kill_prior_reason: string | null }>`
      select status, kill_reason, kill_prior_reason from leads where id = 3
    `;
    assert.deepEqual(killed, { status: "killed", kill_reason: "Covered last week", kill_prior_reason: "Covered last week" });
  } finally {
    await db.close();
  }
});

// guards: DHD2-6 -- "Not a duplicate" clears the duplicate kill reason it wrote, and keeps a reason the editor wrote in their own words.
test("Not a duplicate clears a Duplicate-of kill reason but keeps an editor's own reason", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status,possible_duplicate_of,kill_reason) values (12,7,'killed',10,'Duplicate of Council Budget Hearing'),(13,7,'killed',10,'Not news');`);
    const sql = makeSql(db);
    assert.equal((await resolveLeadDuplicateForEditor(sql, 7, { id: 12, action: "not-a-duplicate" })).ok, true);
    assert.equal((await resolveLeadDuplicateForEditor(sql, 7, { id: 13, action: "not-a-duplicate" })).ok, true);
    const rows = await sql<{ id: number; status: string; kill_reason: string | null }>`select id, status, kill_reason from leads order by id`;
    assert.deepEqual(rows, [
      { id: 12, status: "new", kill_reason: null },
      { id: 13, status: "new", kill_reason: "Not news" },
    ]);
  } finally {
    await db.close();
  }
});
