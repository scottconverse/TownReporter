import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { saveReportingNotesForNewsroom } from "./reporting-notes-save.server.ts";
import { parseNotes } from "./notes.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

/*
  G23-QA-3 (D275): the Story page's writer pick is saved in the lead's notes
  (`saveReportingNotes`), and read back on load. This is the database half:
  the write goes through the same function the save handler runs, and the row
  is read back with the same `parseNotes` the page uses. The parse round trip
  alone would not catch a handler that never writes the field.
*/
await applyMigrationsToTestPglite();

describe("the saved writer pick in the lead's notes", () => {
  it("writes the pick, reads it off the row, and keeps it across unrelated note saves", async () => {
    const sql = await getSql();
    const room = 91341;
    const [lead] = await sql<{ id: number }>`
      insert into leads
        (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, notes_json)
      values (${"model-pick"}, ${room}, ${"Fixture lead"}, ${"Why"}, ${"council"}, ${"new"}, ${"[]"}, ${""}, ${1}, ${"{}"})
      returning id
    `;

    const first = await saveReportingNotesForNewsroom(sql, room, {
      leadId: lead!.id,
      modelPick: { choice: "codex-frontier", effort: "high" },
    });
    assert.equal(first.ok, true);

    const [row] = await sql<{ notes_json: string }>`
      select notes_json from leads where id = ${lead!.id}
    `;
    assert.deepEqual(parseNotes(row!.notes_json).modelPick, {
      choice: "codex-frontier",
      effort: "high",
    });

    // An ordinary notes save (scratch, no pick) must not erase the pick.
    await saveReportingNotesForNewsroom(sql, room, {
      leadId: lead!.id,
      scratch: "Pulled the agenda packet.",
    });
    const [kept] = await sql<{ notes_json: string }>`
      select notes_json from leads where id = ${lead!.id}
    `;
    assert.deepEqual(parseNotes(kept!.notes_json).modelPick, {
      choice: "codex-frontier",
      effort: "high",
    });

    // A new pick replaces the old one.
    await saveReportingNotesForNewsroom(sql, room, {
      leadId: lead!.id,
      modelPick: { choice: "deepseek-flash", effort: null },
    });
    const [replaced] = await sql<{ notes_json: string }>`
      select notes_json from leads where id = ${lead!.id}
    `;
    assert.deepEqual(parseNotes(replaced!.notes_json).modelPick, {
      choice: "deepseek-flash",
      effort: null,
    });
  });
});
