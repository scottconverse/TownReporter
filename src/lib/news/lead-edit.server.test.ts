import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { updateLeadForEditor } from "./lead-edit.server.ts";
import { editLeadInput } from "./request-input.ts";
import { ensureNewsroomSchema, requireEditor, ForbiddenError } from "./membership.ts";
import type { LeadRow } from "./types.ts";

/**
 * Behavior tests for "Edit the lead" (design review note 2, 0.6.80), against
 * a real (PGlite fallback) database, the same pattern as draft-edit.test.ts:
 * a plain `leads` table this file creates by hand (node's raw
 * `--experimental-strip-types` run has no Vite migration glob -- see the
 * comment on `migrate` in `../db.ts`), then calls to the real function, not a
 * grep over its source.
 *
 * Four properties, matching the unit's brief:
 *   1. a valid edit saves, and stamps who/when
 *   2. bad input is refused by the schema every caller must validate through
 *   3. a killed (or published) lead is refused with a plain sentence
 *   4. the desk's own editor gate refuses a non-member -- `updateLead`
 *      (desk.ts) carries the identical `deskMiddleware`
 *      (`requireUserId` + `requireEditor`) every other lead action carries;
 *      this exercises the same `requireEditor` call directly, the way
 *      membership.test.ts's "leave as editor refuses a stranger" already
 *      does for that gate. `desk.ts` cannot be imported here (see above), so
 *      this is the closest real call to "unauthenticated" this file can make
 *      without standing up the framework.
 */

it("saves a valid edit, stamps who and when, sanitizes the source links, and leaves other newsrooms alone", async () => {
  const sql = await getSql();
  await sql.query(`create table if not exists leads (
    id serial primary key, newsroom_id integer not null, user_id text,
    headline text not null, why text not null, topic text not null default 'council',
    status text not null default 'new', source_urls text not null default '[]',
    edited_at timestamptz, edited_by text
  )`);
  const [{ id: leadId }] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (77, 'scanner', 'Old headline needing work', 'Old reason for filing it', 'council', 'new')
    returning id
  `;
  const [{ id: otherId }] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (78, 'scanner', 'A different newsroom entirely', 'Not this editor''s lead', 'council', 'new')
    returning id
  `;

  const ctx = { userId: "editor-77", newsroomId: 77 };
  const edit = editLeadInput.parse({
    id: leadId,
    headline: "Council delays the water rate vote to Oct. 8",
    why: "Two members asked for more time to read the audit",
    topic: "utilities",
    urls: ["https://longmontcolorado.gov/agenda", "https://longmontcolorado.gov/agenda", "javascript:alert(1)"],
  });
  const result = await updateLeadForEditor(ctx, edit);
  assert.deepEqual(result, { ok: true, id: leadId });

  const [saved] = await sql<LeadRow>`select * from leads where id = ${leadId}`;
  assert.equal(saved.headline, "Council delays the water rate vote to Oct. 8");
  assert.equal(saved.why, "Two members asked for more time to read the audit");
  assert.equal(saved.topic, "utilities");
  assert.equal(saved.edited_by, "editor-77");
  assert.ok(saved.edited_at, "edited_at is stamped");
  // The duplicate is dropped and the javascript: URL never reaches the row.
  assert.deepEqual(JSON.parse(saved.source_urls), ["https://longmontcolorado.gov/agenda"]);

  // A lead in a different newsroom is untouched by this edit's own scope.
  const [other] = await sql<LeadRow>`select * from leads where id = ${otherId}`;
  assert.equal(other.headline, "A different newsroom entirely");
  assert.equal(other.edited_by, null);

  // Cross-newsroom: the same edit, aimed at the other newsroom's lead from
  // this editor's context, finds nothing to update rather than reaching
  // across the boundary.
  const crossResult = await updateLeadForEditor(ctx, editLeadInput.parse({ id: otherId, headline: "Reached across newsrooms", why: "Should not happen", topic: "council" }));
  assert.deepEqual(crossResult, { ok: false, error: "Lead not found." });
  const [stillOther] = await sql<LeadRow>`select * from leads where id = ${otherId}`;
  assert.equal(stillOther.headline, "A different newsroom entirely");
});

it("the schema refuses bad input before it ever reaches the update", () => {
  assert.throws(() => editLeadInput.parse({ id: 5, headline: "x".repeat(181), why: "A real reason for this", topic: "council" }));
  assert.throws(() => editLeadInput.parse({ headline: "A full sentence headline", why: "A real reason for this", topic: "council" }));
  assert.throws(() => editLeadInput.parse({ id: 5, headline: "A full sentence headline", why: "A real reason for this", topic: "council", urls: ["not a url array item that is also way too", 1] }));
});

it("refuses a killed lead and an already-published lead, in a plain sentence, without changing the row", async () => {
  const sql = await getSql();
  await sql.query(`create table if not exists leads (
    id serial primary key, newsroom_id integer not null, user_id text,
    headline text not null, why text not null, topic text not null default 'council',
    status text not null default 'new', source_urls text not null default '[]',
    edited_at timestamptz, edited_by text
  )`);
  const [{ id: killedId }] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (81, 'scanner', 'A lead the editor already killed', 'Not news', 'council', 'killed')
    returning id
  `;
  const [{ id: publishedId }] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (81, 'scanner', 'A lead the editor already published', 'It ran in the paper', 'council', 'published')
    returning id
  `;
  const ctx = { userId: "editor-81", newsroomId: 81 };

  const killedResult = await updateLeadForEditor(ctx, editLeadInput.parse({ id: killedId, headline: "A new headline attempt", why: "Trying anyway", topic: "council" }));
  assert.deepEqual(killedResult, { ok: false, error: "This lead was killed. Restore it before editing." });

  const publishedResult = await updateLeadForEditor(ctx, editLeadInput.parse({ id: publishedId, headline: "A new headline attempt", why: "Trying anyway", topic: "council" }));
  assert.deepEqual(publishedResult, { ok: false, error: "This lead is already published. Edit the published story instead." });

  const [killed] = await sql<LeadRow>`select * from leads where id = ${killedId}`;
  assert.equal(killed.headline, "A lead the editor already killed");
  assert.equal(killed.edited_by, null);
  const [published] = await sql<LeadRow>`select * from leads where id = ${publishedId}`;
  assert.equal(published.headline, "A lead the editor already published");
  assert.equal(published.edited_by, null);
});

it("the same editor gate every lead action carries refuses a non-member outright", async () => {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const owner = `edit-lead-owner-${Date.now()}`;
  const stranger = `edit-lead-stranger-${Date.now()}`;
  await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${owner}, ${"owner"}, ${1})`;
  await assert.rejects(() => requireEditor(stranger), (err: unknown) => {
    assert.ok(err instanceof ForbiddenError);
    return true;
  });
  await sql`delete from newsroom_members where user_id = ${owner}`;
});
