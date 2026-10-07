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
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, killed_at timestamptz, kill_reason text, kill_reason_url text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer);
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads values (1,7,'drafted',null,null,null,null),(2,7,'published',null,null,null,null),(3,7,'held',1,null,null,null),(4,7,'held',2,null,null,null);
      insert into drafts values (1,1,7);
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
