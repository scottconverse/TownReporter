// guards: a saved draft or published article can lose its story link after a backward status change.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { SqlTag } from "./lead-filing.ts";
import { resolveLeadDuplicateForEditor, restoreKilledLeadForEditor, setLeadStatusForEditor } from "./lead-lifecycle.ts";

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

// guards: Compare's "Same story" kill on a held lead with a saved draft must kill it (the editor confirmed the duplicate), while a plain kill of the same lead still warns.
test("a held lead with a saved draft is killed as a duplicate, and a plain kill still warns", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_reason_url text, kill_prior_status text, kill_prior_reason text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default 'Saved prose', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      create table audit_events(id serial primary key, user_id text not null, action text not null,
        detail text not null default '', created_at timestamptz not null default now(),
        newsroom_id integer not null default 1, subject_kind text, subject_id integer);
      insert into leads(id,newsroom_id,status) values (458,7,'held');
      insert into drafts(id,lead_id,newsroom_id) values (1,458,7);`);
    const sql = makeSql(db);
    const editor = { userId: "editor-1", newsroomId: 7 };
    const plainKill = await setLeadStatusForEditor(sql, editor, { id: 458, status: "killed" });
    assert.equal(plainKill.ok, false);
    const duplicateReason = "Duplicate of Housing and Human Service Advisory Board sets three agency funding hearings this month";
    const duplicateWarned = await setLeadStatusForEditor(sql, editor, { id: 458, status: "killed", killReason: duplicateReason });
    assert.equal(duplicateWarned.ok, false);
    const duplicateKill = await setLeadStatusForEditor(sql, editor, {
      id: 458,
      status: "killed",
      killReason: duplicateReason,
      override: ["lead-status-drafted"],
    });
    assert.equal(duplicateKill.ok, true);
    const [lead] = await sql<{ status: string; killed_at: string | null; kill_prior_status: string | null; kill_reason: string | null }>`
      select status, killed_at, kill_prior_status, kill_reason from leads where id = 458
    `;
    assert.equal(lead.status, "killed");
    assert.notEqual(lead.killed_at, null);
    assert.equal(lead.kill_prior_status, "held");
    assert.equal(lead.kill_reason, duplicateReason);
    const [draft] = await sql<{ body: string }>`select body from drafts where lead_id = 458`;
    assert.equal(draft.body, "Saved prose");
  } finally {
    await db.close();
  }
});

// guards: Compare's "Same story" press on a held lead with no draft must kill it, leave killed_at set, and keep the held status for Undo.
test("a held lead with no draft is killed as a duplicate and remembers that it was held", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_reason_url text, kill_prior_status text, kill_prior_reason text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      create table audit_events(id serial primary key, user_id text not null, action text not null,
        detail text not null default '', created_at timestamptz not null default now(),
        newsroom_id integer not null default 1, subject_kind text, subject_id integer);
      insert into leads(id,newsroom_id,status) values (459,7,'held');`);
    const sql = makeSql(db);
    const editor = { userId: "editor-1", newsroomId: 7 };
    const duplicateReason = "Duplicate of Housing and Human Service Advisory Board sets three agency funding hearings this month";
    const duplicateKill = await setLeadStatusForEditor(sql, editor, { id: 459, status: "killed", killReason: duplicateReason });
    assert.equal(duplicateKill.ok, true);
    const [lead] = await sql<{ status: string; killed_at: string | null; kill_prior_status: string | null; kill_reason: string | null }>`
      select status, killed_at, kill_prior_status, kill_reason from leads where id = 459
    `;
    assert.equal(lead.status, "killed");
    assert.notEqual(lead.killed_at, null);
    assert.equal(lead.kill_prior_status, "held");
    assert.equal(lead.kill_reason, duplicateReason);
  } finally {
    await db.close();
  }
});

test("an Undo of a kill leaves the lead as it was before the kill; a Bring back keeps the kill record", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, kill_prior_status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_prior_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      insert into leads(id,newsroom_id,status) values (1,7,'held'),(2,7,'new');`);
    const sql = makeSql(db);
    // Lead 1: held, no reason. Kill it with a reason, then Undo the kill.
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 1, status: "killed", killReason: "Not news" })).ok, true);
    assert.deepEqual(
      await restoreKilledLeadForEditor(sql, 7, { id: 1, keepRecord: false }),
      { ok: true, status: "held" },
    );
    const [undone] = await sql<{ status: string; killed_at: string | null; kill_reason: string | null; kill_prior_status: string | null; kill_prior_reason: string | null }>`
      select status, killed_at::text, kill_reason, kill_prior_status, kill_prior_reason from leads where id = 1
    `;
    assert.deepEqual(undone, { status: "held", killed_at: null, kill_reason: null, kill_prior_status: null, kill_prior_reason: null });

    // Lead 2: new, killed with a reason, then brought back from the Killed pile.
    assert.equal((await setLeadStatusForEditor(sql, 7, { id: 2, status: "killed", killReason: "Duplicate of Council" })).ok, true);
    const [killedAt] = await sql<{ killed_at: string }>`select killed_at::text from leads where id = 2`;
    assert.deepEqual(await restoreKilledLeadForEditor(sql, 7, { id: 2, keepRecord: true }), { ok: true, status: "new" });
    const [kept] = await sql<{ status: string; killed_at: string | null; kill_reason: string | null }>`
      select status, killed_at::text, kill_reason from leads where id = 2
    `;
    assert.deepEqual(kept, { status: "new", killed_at: killedAt.killed_at, kill_reason: "Duplicate of Council" });
    await db.close();
  } catch (error) {
    await db.close();
    throw error;
  }
});

test("an Undo refuses to put a lead back to drafted when the draft is gone, and writes nothing", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, kill_prior_status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_prior_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      insert into leads(id,newsroom_id,status,kill_prior_status,killed_at,kill_reason) values (1,7,'killed','drafted',now(),'Not news');`);
    const sql = makeSql(db);
    assert.deepEqual(
      await restoreKilledLeadForEditor(sql, 7, { id: 1, status: "drafted" }),
      { ok: false, error: "That lead has no draft to go back to." },
    );
    const [still] = await sql<{ status: string; killed_at: string | null }>`select status, killed_at::text from leads where id = 1`;
    assert.equal(still.status, "killed");
    assert.notEqual(still.killed_at, null, "a refused Undo must not clear the kill record");
    // Remembered as drafted with no draft left: the Undo comes back as new, not an error.
    assert.deepEqual(await restoreKilledLeadForEditor(sql, 7, { id: 1 }), { ok: true, status: "new" });
    await db.close();
  } catch (error) {
    await db.close();
    throw error;
  }
});

/*
  TIA-2 (walk step TIA-2, 2026-10-13). An editor pressed "Hold" on one open lead
  (counts moved Open 11 -> 10, Held 16 -> 17), pressed the toast's own "Undo" --
  and the lead stayed held. The row's "Release" button did put it back, and the
  Undo a KILL raises worked, so the two presses were compared.

  The cause is the write, not the button. The toast's Undo re-sent the Hold's own
  write reversed -- `setLeadStatus` with `new`, the ordinary status path -- and
  that path raises the drafted warning for any lead with a written text, which is
  the ordinary held lead. The walker's lead had a draft, the desk refused in
  silence, `leadStatusOptimistic` rolled the row back, and the lead stayed held.
  A kill's Undo never goes near that path: it carries the status the row held and
  goes through the desk's own way back (`restoreKilledLead`).

  These two tests are the fix. The first is the walker's press, made again, and
  the second is the refusal that used to be the whole answer -- asserted rather
  than described, so the red half of this unit is a measurement.
*/

// guards: TIA-2 -- the toast's Undo after a Hold must put the lead back where it was, through the desk's own way back.
test("an Undo of a Hold puts a drafted lead back to drafted and a released lead back to held", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, kill_prior_status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_prior_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      create table audit_events(id serial primary key, user_id text not null, action text not null,
        detail text not null default '', created_at timestamptz not null default now(),
        newsroom_id integer not null default 1, subject_kind text, subject_id integer);
      insert into leads(id,newsroom_id,status) values (1,7,'new'),(2,7,'held');
      insert into drafts(id,lead_id,newsroom_id) values (1,2,7);`);
    const sql = makeSql(db);
    const editor = { userId: "editor-1", newsroomId: 7 };

    // The walker's lead: the desk has already drafted it, and the editor holds it.
    assert.equal((await setLeadStatusForEditor(sql, editor, { id: 2, status: "held" })).ok, true);
    // An Undo carries the status the row held when the Hold was pressed, and the
    // keys the editor already approved on that press.
    assert.deepEqual(
      await restoreKilledLeadForEditor(sql, editor, { id: 2, status: "drafted", override: ["lead-status-drafted"] }),
      { ok: true, status: "drafted" },
      "a HOLD is put back by the desk's way back -- the half that used to refuse",
    );
    const [back] = await sql<{ status: string }>`select status from leads where id = 2`;
    assert.equal(back.status, "drafted", "the lead is where it was, its draft intact");

    // The row's own Release, unchanged: a released lead goes back on hold.
    assert.equal((await setLeadStatusForEditor(sql, editor, { id: 1, status: "held" })).ok, true);
    assert.deepEqual(await restoreKilledLeadForEditor(sql, editor, { id: 1 }), { ok: true, status: "new" });
    const [released] = await sql<{ status: string }>`select status from leads where id = 1`;
    assert.equal(released.status, "new", "a Hold on an open lead comes back to New");
  } finally {
    await db.close();
  }
});

// guards: TIA-2 -- the ordinary status write is refused for the walker's lead, and the way back is still narrow to a held or killed lead.
test("the ordinary status write cannot undo a Hold, and the way back refuses a lead it did not hold", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id integer primary key, newsroom_id integer, status text, kill_prior_status text, possible_duplicate_of integer, dup_kind text, killed_at timestamptz, kill_reason text, kill_prior_reason text, kill_reason_url text, notes_json text);
      create table drafts(id integer primary key, lead_id integer, newsroom_id integer, body text default '', research_json text default '{}');
      create table articles(id integer primary key, lead_id integer, newsroom_id integer, status text);
      create table audit_events(id serial primary key, user_id text not null, action text not null,
        detail text not null default '', created_at timestamptz not null default now(),
        newsroom_id integer not null default 1, subject_kind text, subject_id integer);
      insert into leads(id,newsroom_id,status) values (1,7,'new'),(2,7,'held');
      insert into drafts(id,lead_id,newsroom_id,body) values (1,2,7,'Saved prose');`);
    const sql = makeSql(db);
    const editor = { userId: "editor-1", newsroomId: 7 };

    // The write the toast's Undo sent before the fix, verbatim: refused, silently.
    const refused = await setLeadStatusForEditor(sql, editor, { id: 2, status: "new" });
    assert.equal(refused.ok, false, "the ordinary write is refused for the walker's lead, which is why the Undo did nothing");
    assert.equal((await sql<{ status: string }>`select status from leads where id = 2`)[0].status, "held");

    // The way back is not a general "set any status" door: an open lead is left alone.
    const open = await restoreKilledLeadForEditor(sql, editor, { id: 1, status: "held" });
    assert.equal(open.ok, false, "a lead that was never held or killed is not a way back");
    assert.match(String(open.error), /killed or held/i);
    // And a held lead asked to come back held is no way back at all.
    assert.equal((await restoreKilledLeadForEditor(sql, editor, { id: 2, status: "held" })).ok, false);
    assert.equal((await sql<{ status: string }>`select status from leads where id = 2`)[0].status, "held");
  } finally {
    await db.close();
  }
});
