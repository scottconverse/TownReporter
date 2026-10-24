import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { emptyNotes, packNotes, parseNotes } from "./notes.ts";
import { saveDraftRefusalNote } from "./draft-refusal-note.server.ts";

// G23-QA-5 (D279): a Draft refusal is kept on the lead's notes so it survives
// a reload, and the next press clears it. This file asks for the migrated
// schema itself, the same way daily-scan-last-run.test.ts does.
await applyMigrationsToTestPglite();

const NEWSROOM = 612;
const LEAD = 61201;

async function reset() {
  const sql = await getSql();
  await sql.query("insert into newsrooms(id,name) values($1,'Test room 612') on conflict (id) do nothing", [NEWSROOM]);
  await sql.query("delete from leads where id=$1", [LEAD]);
  await sql.query(
    "insert into leads(id,user_id,newsroom_id,headline,why,notes_json,created_at) values($1,'owner-612',$2,'Test lead','It is a test','{}',now())",
    [LEAD, NEWSROOM],
  );
}

beforeEach(reset);

const REFUSAL = { text: "No model is set up. Add a connection on the Server page.", at: "2026-10-24T09:04:00.000Z" };

describe("D279: lastDraftRefusal round-trips through the notes", () => {
  it("keeps a well-formed refusal", () => {
    const packed = packNotes({ ...emptyNotes(), lastDraftRefusal: REFUSAL });
    assert.deepEqual(parseNotes(packed).lastDraftRefusal, REFUSAL);
  });

  it("cuts the text to 600 characters", () => {
    const packed = packNotes({ ...emptyNotes(), lastDraftRefusal: { ...REFUSAL, text: "x".repeat(900) } });
    assert.equal(parseNotes(packed).lastDraftRefusal?.text.length, 600);
  });

  it("drops a malformed refusal whole", () => {
    assert.equal(parseNotes(JSON.stringify({ lastDraftRefusal: { text: "Draft did not start." } })).lastDraftRefusal, undefined);
    assert.equal(parseNotes(JSON.stringify({ lastDraftRefusal: { at: REFUSAL.at } })).lastDraftRefusal, undefined);
    assert.equal(
      parseNotes(JSON.stringify({ lastDraftRefusal: { text: "Draft did not start.", at: "not a date" } })).lastDraftRefusal,
      undefined,
    );
    assert.equal(parseNotes(JSON.stringify({ lastDraftRefusal: "nope" })).lastDraftRefusal, undefined);
  });
});

describe("D279: the lead's saved refusal, written and cleared under the row lock", () => {
  it("saves a refusal, reads it back with parseNotes, then clears it", async () => {
    const sql = await getSql();
    assert.equal(await saveDraftRefusalNote(sql, NEWSROOM, LEAD, REFUSAL), true);

    const saved = await sql.query<{ notes_json: string | null }>("select notes_json from leads where id=$1", [LEAD]);
    assert.deepEqual(parseNotes(saved[0]!.notes_json).lastDraftRefusal, REFUSAL);

    assert.equal(await saveDraftRefusalNote(sql, NEWSROOM, LEAD, null), true);
    const cleared = await sql.query<{ notes_json: string | null }>("select notes_json from leads where id=$1", [LEAD]);
    assert.equal(parseNotes(cleared[0]!.notes_json).lastDraftRefusal, undefined);
  });

  it("does not touch another newsroom's lead", async () => {
    const sql = await getSql();
    assert.equal(await saveDraftRefusalNote(sql, 999, LEAD, REFUSAL), false);
    const saved = await sql.query<{ notes_json: string | null }>("select notes_json from leads where id=$1", [LEAD]);
    assert.equal(parseNotes(saved[0]!.notes_json).lastDraftRefusal, undefined);
  });

  it("writes nothing to a lead that has no stored refusal", async () => {
    const sql = await getSql();
    /* A shape the parse/pack round trip would change: `notAField` is not named
       by parseNotes, so it is dropped on read and never written back. */
    const stored = '{"why":"x","notAField":1}';
    assert.notEqual(packNotes(parseNotes(stored)), stored, "the round trip must not be the identity");
    await sql.query("update leads set notes_json=$1 where id=$2", [stored, LEAD]);

    assert.equal(await saveDraftRefusalNote(sql, NEWSROOM, LEAD, null), true);

    const saved = await sql.query<{ notes_json: string | null }>("select notes_json from leads where id=$1", [LEAD]);
    assert.equal(saved[0]!.notes_json, stored, "a press with nothing to clear leaves the row alone");
  });

  it("keeps the rest of the lead's notes when it writes", async () => {
    const sql = await getSql();
    const before = { ...emptyNotes(), news: "Council meets Tuesday.", angle: "The budget vote." };
    await sql.query("update leads set notes_json=$1 where id=$2", [packNotes(before), LEAD]);
    await saveDraftRefusalNote(sql, NEWSROOM, LEAD, REFUSAL);
    const saved = await sql.query<{ notes_json: string | null }>("select notes_json from leads where id=$1", [LEAD]);
    const notes = parseNotes(saved[0]!.notes_json);
    assert.equal(notes.news, "Council meets Tuesday.");
    assert.equal(notes.angle, "The budget vote.");
    assert.deepEqual(notes.lastDraftRefusal, REFUSAL);
  });
});
