import type { Sql } from "../db.ts";
import { suppliedUrlsFromText } from "./draft-input.ts";
import { applyTodoPatch, packNotes, parseNotes, type ModelPick, type NoteTodo } from "./notes.ts";
import { sanitizePublicUrls } from "./schema.ts";

/*
  The one reporting-notes write, outside the server-fn wrapper.

  `saveReportingNotes` (./desk.ts) is the only production caller. It lives in
  this module so a database test can call it with the migrated PGlite `Sql`
  handle and read the row back -- desk.ts imports `@/lib/...`, which plain
  `node --test` cannot resolve. The behaviour is the handler's own: no logic
  here is different from what the handler ran before the extraction.
*/

export type ReportingNotesSave = {
  leadId: number;
  add?: string;
  toggle?: number;
  scratch?: string;
  storyDirection?: string;
  researchScope?: "public" | "supplied";
  todos?: NoteTodo[];
  modelPick?: ModelPick;
};

export async function saveReportingNotesForNewsroom(
  sql: Sql,
  newsroomId: number,
  data: ReportingNotesSave,
) {
  /*
    Pull writes excerpts in the background. Lock the same lead row before
    applying an editor note change so neither full notes_json update can
    erase the other after reading an older copy.
  */
  const rows = await sql<{ notes_json: string | null }>`
    select notes_json from leads
    where id = ${data.leadId} and newsroom_id = ${newsroomId}
    for update
  `;
  if (!rows[0]) return { ok: false as const, error: "Lead not found" };
  const notes = applyTodoPatch(parseNotes(rows[0].notes_json), {
    todos: data.todos,
    toggle: data.toggle,
    add: data.add,
    scratch: data.scratch,
  });
  if (data.researchScope === "supplied" || data.researchScope === "public")
    notes.researchScope = data.researchScope;
  if (typeof data.storyDirection === "string") {
    const direction = data.storyDirection.trim().slice(0, 1000);
    notes.editorialAssignment = direction ? { origin: "story-workspace", text: direction } : undefined;
  }
  if (typeof data.scratch === "string")
    notes.suppliedUrls = sanitizePublicUrls([
      ...(notes.suppliedUrls ?? []),
      ...suppliedUrlsFromText(data.scratch),
    ]).slice(0, 8);
  /*
    D275: the Story page's writer pick, written beside the other note fields
    so a reload restores it. It is not a todo-patch field: it replaces the one
    stored pick each time the editor picks.
  */
  if (data.modelPick) notes.modelPick = { choice: data.modelPick.choice, effort: data.modelPick.effort };
  const json = packNotes(notes);
  await sql`
    update leads set notes_json = ${json} where id = ${data.leadId} and newsroom_id = ${newsroomId}
  `;
  return { ok: true as const, notes };
}
