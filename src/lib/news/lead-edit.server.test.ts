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
  // No draft filed for this lead in this test -- the eligibility query
  // (`updated_at = created_at`) just needs the table to exist, the same as
  // any real newsroom's schema always has it.
  await sql.query(`create table if not exists drafts (
    id serial primary key, newsroom_id integer not null, user_id text,
    lead_id integer not null, headline text not null, dek text not null default '',
    body text not null default '', topic text not null, source_urls text not null default '[]',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
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
  // No draft was ever filed for this lead in this test, so there is nothing
  // to sync -- same message path as a draft someone has already worked on.
  assert.deepEqual(result, {
    ok: true,
    id: leadId,
    message: "The story draft keeps its own headline, section and sources.",
  });

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
  assert.equal(killedResult.ok, false);
  assert.equal("warning" in killedResult && killedResult.warning?.key, "lead-edit-killed");

  const publishedResult = await updateLeadForEditor(ctx, editLeadInput.parse({ id: publishedId, headline: "A new headline attempt", why: "Trying anyway", topic: "council" }));
  assert.equal(publishedResult.ok, false);
  assert.equal("warning" in publishedResult && publishedResult.warning?.key, "lead-edit-published");

  const [killed] = await sql<LeadRow>`select * from leads where id = ${killedId}`;
  assert.equal(killed.headline, "A lead the editor already killed");
  assert.equal(killed.edited_by, null);
  const [published] = await sql<LeadRow>`select * from leads where id = ${publishedId}`;
  assert.equal(published.headline, "A lead the editor already published");
  assert.equal(published.edited_by, null);
});

/** The `drafts` columns this file's own tests need, matching the real schema
 * (`migrations/0002_newsroom.sql` + the `newsroom_id` column added by
 * `migrations/0012_newsroom_appliance.sql`) closely enough for the sync rule:
 * `created_at`/`updated_at` both default `now()`, so a row this helper inserts
 * without touching either reads as "still the filing copy" exactly the way a
 * fresh `insertLeadWithDraft` row does. */
async function ensureLeadsAndDraftsTables() {
  const sql = await getSql();
  await sql.query(`create table if not exists leads (
    id serial primary key, newsroom_id integer not null, user_id text,
    headline text not null, why text not null, topic text not null default 'council',
    status text not null default 'new', source_urls text not null default '[]',
    edited_at timestamptz, edited_by text
  )`);
  await sql.query(`create table if not exists drafts (
    id serial primary key, newsroom_id integer not null, user_id text,
    lead_id integer not null, headline text not null, dek text not null default '',
    body text not null default '', topic text not null, source_urls text not null default '[]',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  )`);
}

it("edit the lead syncs the still-untouched companion draft's headline, section and sources", async () => {
  await ensureLeadsAndDraftsTables();
  const sql = await getSql();
  const [{ id: leadId }] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (91, 'scanner', 'Old headline needing work', 'Old reason for filing it', 'council', 'new')
    returning id
  `;
  // Filed the way `insertLeadWithDraft` (desk.ts:451) files it: same headline,
  // topic and source_urls as the lead, an empty body, and created_at/updated_at
  // stamped equal by the same insert.
  const [{ id: draftId }] = await sql<{ id: number }>`
    insert into drafts (newsroom_id, user_id, lead_id, headline, dek, body, topic, source_urls)
    values (91, 'scanner', ${leadId}, 'Old headline needing work', 'Old reason for filing it', '', 'council', '["https://longmontcolorado.gov/old"]')
    returning id
  `;

  const ctx = { userId: "editor-91", newsroomId: 91 };
  const edit = editLeadInput.parse({
    id: leadId,
    headline: "Council delays the water rate vote to Oct. 8",
    why: "Two members asked for more time to read the audit",
    topic: "utilities",
    urls: ["https://longmontcolorado.gov/agenda"],
  });
  const result = await updateLeadForEditor(ctx, edit);
  assert.deepEqual(result, { ok: true, id: leadId });

  const [draft] = await sql<{ headline: string; topic: string; source_urls: string; dek: string }>`
    select headline, topic, source_urls, dek from drafts where id = ${draftId}
  `;
  assert.equal(draft.headline, "Council delays the water rate vote to Oct. 8");
  assert.equal(draft.topic, "utilities");
  assert.deepEqual(JSON.parse(draft.source_urls), ["https://longmontcolorado.gov/agenda"]);
  // The dek (the lead's old "why", copied at filing) is left alone: only
  // headline/topic/source_urls are the lead-edit's business.
  assert.equal(draft.dek, "Old reason for filing it");
});

it("does not overwrite a draft the writer or editor has already worked on, and says so", async () => {
  await ensureLeadsAndDraftsTables();
  const sql = await getSql();
  const [{ id: leadId }] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (92, 'scanner', 'Old headline needing work', 'Old reason for filing it', 'council', 'new')
    returning id
  `;
  const [{ id: draftId }] = await sql<{ id: number }>`
    insert into drafts (newsroom_id, user_id, lead_id, headline, dek, body, topic, source_urls)
    values (92, 'scanner', ${leadId}, 'Old headline needing work', 'Old reason for filing it', '', 'council', '["https://longmontcolorado.gov/old"]')
    returning id
  `;
  // A writer (or an editor's own save) has since touched the draft, the way
  // every real draft write does: `updated_at` moves off `created_at`.
  await sql`update drafts set body = 'The council met Tuesday.', updated_at = now() + interval '1 second' where id = ${draftId}`;

  const ctx = { userId: "editor-92", newsroomId: 92 };
  const edit = editLeadInput.parse({
    id: leadId,
    headline: "Council delays the water rate vote to Oct. 8",
    why: "Two members asked for more time to read the audit",
    topic: "utilities",
    urls: ["https://longmontcolorado.gov/agenda"],
  });
  const result = await updateLeadForEditor(ctx, edit);
  assert.deepEqual(result, {
    ok: true,
    id: leadId,
    message: "The story draft keeps its own headline, section and sources.",
  });

  const [draft] = await sql<{ headline: string; topic: string; source_urls: string; body: string }>`
    select headline, topic, source_urls, body from drafts where id = ${draftId}
  `;
  assert.equal(draft.headline, "Old headline needing work");
  assert.equal(draft.topic, "council");
  assert.deepEqual(JSON.parse(draft.source_urls), ["https://longmontcolorado.gov/old"]);
  assert.equal(draft.body, "The council met Tuesday.");

  const [lead] = await sql<LeadRow>`select * from leads where id = ${leadId}`;
  assert.equal(lead.headline, "Council delays the water rate vote to Oct. 8");
  assert.equal(lead.topic, "utilities");
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
