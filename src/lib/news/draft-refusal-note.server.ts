import type { Sql } from "../db.ts";
import { packNotes, parseNotes } from "./notes.ts";

/**
 * ── A DRAFT REFUSAL THAT SURVIVES THE RELOAD (G23-QA-5, D279) ───────────────
 *
 * The Story page showed a refused Draft press only as page state (`msg`), so an
 * editor who reloaded -- or came back an hour later -- saw a lead that looked
 * untouched: no job, no draft, no reason. The reason was real (the provider
 * preflight knew exactly what was missing), and it was thrown away with the
 * tab.
 *
 * So the refusal is written onto the lead's own notes, the same place the desk
 * keeps its other desk-only facts, and the next Draft press clears it. The read
 * is the SAME `parseNotes` the rest of the desk uses; the write is `packNotes`
 * with the lead row locked `for update`, exactly like `saveReportingNotes`.
 *
 * Callers wrap this in `withTransaction` so the lock means something for the
 * duration of the read-change-write. A test may call it with the plain `sql`
 * handle: the statements are the same, only the lock's reach is shorter.
 *
 * `refusal === null` CLEARS the note (the press is being tried again). A
 * missing lead returns `false` and changes nothing -- the commit path is about
 * to answer that same fact more usefully.
 *
 * NO CALLER LETS THIS FAIL THE PRESS: the note is a convenience, and a write
 * that fails must never change what the Draft press returns.
 */
export async function saveDraftRefusalNote(
  sql: Sql,
  newsroomId: number,
  leadId: number,
  refusal: { text: string; at: string } | null,
): Promise<boolean> {
  const rows = await sql<{ notes_json: string | null }>`
    select notes_json from leads
    where id = ${leadId} and newsroom_id = ${newsroomId}
    for update
  `;
  if (!rows[0]) return false;
  const notes = parseNotes(rows[0].notes_json);
  const text = (refusal?.text ?? "").trim().slice(0, 600);
  const at = (refusal?.at ?? "").trim();
  if (refusal && text && at && !Number.isNaN(Date.parse(at))) {
    notes.lastDraftRefusal = { text, at };
  } else {
    /*
      Nothing to clear. A Draft press with no refusal used to rewrite the row
      anyway, and the parse/pack round trip is not the identity: it can reshape
      or drop what the lead already holds. So only write when there is a stored
      refusal to take off.
    */
    if (!notes.lastDraftRefusal) return true;
    delete notes.lastDraftRefusal;
  }
  await sql`
    update leads set notes_json = ${packNotes(notes)}
    where id = ${leadId} and newsroom_id = ${newsroomId}
  `;
  return true;
}
