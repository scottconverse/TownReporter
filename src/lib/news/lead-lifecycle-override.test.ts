import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { SqlTag } from "./lead-filing.ts";
import { resolveLeadDuplicateForEditor, setLeadStatusForEditor } from "./lead-lifecycle.ts";

/**
 * Items 5 and 6 behavior, per Scott's rule: outside Publish the desk warns and
 * the editor may press again. These call the REAL lifecycle functions against a
 * hand-built PGlite (leads/drafts/articles plus the audit table the override
 * writes, so no global `getSql()` is involved) and check:
 *
 *   - a published story or a saved draft WARNS (item 5), for BOTH kill and hold
 *     -- the old code early-returned on kill and never checked;
 *   - a rejected warning records nothing; the second press applies the status
 *     and writes an `override` audit row;
 *   - a gone lead stays HARD with no key.
 */

function makeSql(db: PGlite): SqlTag {
  return async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
    return (await db.query<T>(query, values)).rows;
  };
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create table leads(id serial primary key, newsroom_id integer, status text,
      possible_duplicate_of integer, killed_at timestamptz, kill_reason text,
      kill_reason_url text, notes_json text);
    create table drafts(id serial primary key, lead_id integer, newsroom_id integer,
      body text default '', research_json text default '{}');
    create table articles(id serial primary key, lead_id integer, newsroom_id integer, status text);
    create table audit_events(id serial primary key, user_id text not null, action text not null,
      detail text not null default '', created_at timestamptz not null default now(),
      newsroom_id integer not null default 1, subject_kind text, subject_id integer);`);
  return db;
}

const context = { userId: "editor-7", newsroomId: 7 };
async function expectOverrideAudit(db: PGlite, key: string, targetId: number) {
  const result = await db.query<{user_id:string;detail:string;created_at:unknown;subject_id:number}>("select user_id,detail,created_at,subject_id from audit_events where action='override'");
  assert.ok(result.rows.some(row => row.user_id === context.userId && JSON.parse(row.detail).key === key && row.subject_id === targetId && row.created_at));
}

describe("setLeadStatusForEditor warns, never blocks (item 5)", () => {
  it("warns on a KILL of a lead with a published story, then applies on the second press", async () => {
    const db = await freshDb();
    try {
      await db.exec(`insert into leads(id,newsroom_id,status) values (1,7,'new');
        insert into articles(id,lead_id,newsroom_id,status) values (1,1,7,'published');`);
      const sql = makeSql(db);
      const refused = await setLeadStatusForEditor(sql, context, { id: 1, status: "killed" });
      assert.equal(refused.ok, false);
      assert.equal((refused as { warning?: { key: string } }).warning?.key, "lead-status-published");
      const [untouched] = await sql<{ status: string }>`select status from leads where id = 1`;
      assert.equal(untouched!.status, "new", "a refused kill changes nothing");

      const applied = await setLeadStatusForEditor(sql, context, {
        id: 1,
        status: "killed",
        override: ["lead-status-published"],
      });
      assert.equal(applied.ok, true);
      const [killed] = await sql<{ status: string }>`select status from leads where id = 1`;
      assert.equal(killed!.status, "killed");
      const [audit] = await sql<{ action: string; detail: string }>`
        select action, detail from audit_events where user_id = 'editor-7' order by id desc limit 1`;
      assert.equal(audit!.action, "override");
      assert.equal(JSON.parse(audit!.detail).key, "lead-status-published");
    } finally {
      await db.close();
    }
  });

  it("warns on a HOLD of a lead that has a written draft, then applies on the second press", async () => {
    const db = await freshDb();
    try {
      await db.exec(`insert into leads(id,newsroom_id,status) values (2,7,'new');
        insert into drafts(id,lead_id,newsroom_id,body) values (2,2,7,'Saved prose');`);
      const sql = makeSql(db);
      const refused = await setLeadStatusForEditor(sql, context, { id: 2, status: "held" });
      assert.equal(refused.ok, false);
      assert.equal((refused as { warning?: { key: string } }).warning?.key, "lead-status-drafted");
      const applied = await setLeadStatusForEditor(sql, context, {
        id: 2,
        status: "held",
        override: ["lead-status-drafted"],
      });
      assert.equal(applied.ok, true);
      const [held] = await sql<{ status: string }>`select status from leads where id = 2`;
      assert.equal(held!.status, "held");
      await expectOverrideAudit(db, "lead-status-drafted", 2);
    } finally {
      await db.close();
    }
  });

  it("keeps a gone lead hard, with no warning key even when an override names every policy key", async () => {
    const db = await freshDb();
    try {
      const sql = makeSql(db);
      const result = await setLeadStatusForEditor(sql, context, {
        id: 999,
        status: "held",
        override: ["lead-status-published", "lead-status-drafted"],
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, "That lead is no longer on the desk.");
      assert.equal((result as { warning?: unknown }).warning, undefined);
    } finally {
      await db.close();
    }
  });
});

describe("resolveLeadDuplicateForEditor warns, never blocks (item 6)", () => {
  it("warns on reopening a prior lead with a published story, applies on the second press", async () => {
    const db = await freshDb();
    try {
      await db.exec(`insert into leads(id,newsroom_id,status,possible_duplicate_of) values
        (1,7,'killed',null),(2,7,'held',1);
        insert into articles(id,lead_id,newsroom_id,status) values (1,1,7,'published');`);
      const sql = makeSql(db);
      const refused = await resolveLeadDuplicateForEditor(sql, context, { id: 2, action: "reopen-prior" });
      assert.equal(refused.ok, false);
      assert.equal((refused as { warning?: { key: string } }).warning?.key, "lead-duplicate-published");
      const applied = await resolveLeadDuplicateForEditor(sql, context, {
        id: 2,
        action: "reopen-prior",
        override: ["lead-duplicate-published"],
      });
      assert.equal(applied.ok, true);
      const [prior] = await sql<{ status: string }>`select status from leads where id = 1`;
      assert.equal(prior!.status, "new", "the second press reopens the prior lead");
      await expectOverrideAudit(db, "lead-duplicate-published", 1);
    } finally {
      await db.close();
    }
  });

  it("warns on reopening a prior lead with a saved draft, applies on the second press", async () => {
    const db = await freshDb();
    try {
      await db.exec(`insert into leads(id,newsroom_id,status,possible_duplicate_of) values
        (3,7,'killed',null),(4,7,'held',3);
        insert into drafts(id,lead_id,newsroom_id,body) values (3,3,7,'Saved prose');`);
      const sql = makeSql(db);
      const refused = await resolveLeadDuplicateForEditor(sql, context, { id: 4, action: "reopen-prior" });
      assert.equal(refused.ok, false);
      assert.equal((refused as { warning?: { key: string } }).warning?.key, "lead-duplicate-drafted");
      const applied = await resolveLeadDuplicateForEditor(sql, context, {
        id: 4,
        action: "reopen-prior",
        override: ["lead-duplicate-drafted"],
      });
      assert.equal(applied.ok, true);
      await expectOverrideAudit(db, "lead-duplicate-drafted", 3);
    } finally {
      await db.close();
    }
  });

  it("keeps a missing earlier lead hard even with an override", async () => {
    const db = await freshDb();
    try {
      await db.exec(`insert into leads(id,newsroom_id,status,possible_duplicate_of) values (5,7,'held',null);`);
      const sql = makeSql(db);
      const refused = await resolveLeadDuplicateForEditor(sql, context, { id: 5, action: "reopen-prior" });
      assert.equal(refused.ok, false);
      assert.equal((refused as { warning?: unknown }).warning, undefined);
      const approved = await resolveLeadDuplicateForEditor(sql, context, { id: 5, action: "reopen-prior", override: ["lead-duplicate-none"] });
      assert.equal(approved.ok, false);
    } finally {
      await db.close();
    }
  });
});
