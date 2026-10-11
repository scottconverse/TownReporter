import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { editLeadInput } from "./request-input.ts";
import { ensureAuditEventsSchema } from "./ops.ts";
import { updateLeadForEditor, type LeadEditInput } from "./lead-edit.server.ts";

/**
 * Item 3 (edit validation) and item 4 (a killed/published lead) behavior, per
 * Scott's rule: outside Publish the desk warns, and the editor may press again.
 * These call the REAL `updateLeadForEditor` against the real (PGlite) `leads`
 * and `drafts` tables -- no providers -- and check the two halves:
 *
 *   - an empty headline or a gone lead stay HARD (no override, no warning key);
 *   - a short headline, a missing why, and a killed/published lead WARN, are
 *     refused without override, and go through -- with an `override` audit row --
 *     once the editor's second press names the key.
 */

const NEWSROOM = 730;

async function freshLead(status: string): Promise<number> {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status)
    values (${NEWSROOM}, 'scanner', 'An ordinary filed lead headline', 'A reason it is news',
            'council', ${status})
    returning id
  `;
  return row!.id;
}

async function overrideAudit(userId: string) {
  const sql = await getSql();
  return await sql<{ action: string; detail: string; subject_kind: string | null; subject_id: number | null }>`
    select action, detail, subject_kind, subject_id from audit_events
    where user_id = ${userId} and action = 'override' order by id`;
}

describe("updateLeadForEditor: warn, never block (Scott's rule)", () => {
  it("keeps an EMPTY headline hard, with no warning key, even on a second press", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("new");
    const base = editLeadInput.parse({ id, headline: "", why: "A reason it is news", topic: "council" });
    for (const override of [undefined, ["lead-edit-headline-short"]]) {
      const result = await updateLeadForEditor(
        { userId: "editor-empty", newsroomId: NEWSROOM },
        { ...(base as LeadEditInput), override },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, "Headline needs a full sentence.");
      assert.equal("warning" in result, false, "an empty headline has no key");
    }
    const sql = await getSql();
    const [lead] = await sql<{ headline: string }>`select headline from leads where id = ${id}`;
    assert.notEqual(lead!.headline, "");
  });

  it("warns on a short (but non-empty) headline and a missing why, then applies on the second press", async () => {
    await ensureAuditEventsSchema();
    const shortId = await freshLead("new");
    const short = editLeadInput.parse({ id: shortId, headline: "Rates", why: "A real reason it is news", topic: "council" });
    const refused = await updateLeadForEditor(
      { userId: "editor-short", newsroomId: NEWSROOM },
      short as LeadEditInput,
    );
    assert.equal(refused.ok, false);
    assert.equal(refused.warning?.key, "lead-edit-headline-short");
    assert.equal(refused.warning?.sentence, refused.error);
    assert.equal((await overrideAudit("editor-short")).length, 0, "a refused warning writes nothing");

    const applied = await updateLeadForEditor(
      { userId: "editor-short", newsroomId: NEWSROOM },
      { ...(short as LeadEditInput), override: ["lead-edit-headline-short"] },
    );
    assert.equal(applied.ok, true, "the second press goes through");
    const sql = await getSql();
    const [lead] = await sql<{ headline: string }>`select headline from leads where id = ${shortId}`;
    assert.equal(lead!.headline, "Rates");
    const audit = await overrideAudit("editor-short");
    assert.equal(audit.length, 1);
    assert.deepEqual(JSON.parse(audit[0]!.detail).key, "lead-edit-headline-short");

    const whyId = await freshLead("new");
    const noWhy = editLeadInput.parse({ id: whyId, headline: "A full sentence headline", why: "Short", topic: "council" });
    const whyRefused = await updateLeadForEditor(
      { userId: "editor-why", newsroomId: NEWSROOM },
      noWhy as LeadEditInput,
    );
    assert.equal(whyRefused.ok, false);
    assert.equal(whyRefused.warning?.key, "lead-edit-why");
    const whyApplied = await updateLeadForEditor(
      { userId: "editor-why", newsroomId: NEWSROOM },
      { ...(noWhy as LeadEditInput), override: ["lead-edit-why"] },
    );
    assert.equal(whyApplied.ok, true);
  });

  it("warns on a killed lead, then applies it on the second press (item 4)", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("killed");
    const data = editLeadInput.parse({ id, headline: "A new headline attempt", why: "Trying anyway", topic: "council" });
    const refused = await updateLeadForEditor({ userId: "editor-killed", newsroomId: NEWSROOM }, data as LeadEditInput);
    assert.equal(refused.ok, false);
    assert.equal(refused.warning?.key, "lead-edit-killed");
    const sql = await getSql();
    const [untouched] = await sql<{ headline: string }>`select headline from leads where id = ${id}`;
    assert.equal(untouched!.headline, "An ordinary filed lead headline");

    const applied = await updateLeadForEditor(
      { userId: "editor-killed", newsroomId: NEWSROOM },
      { ...(data as LeadEditInput), override: ["lead-edit-killed"] },
    );
    assert.equal(applied.ok, true);
    const [edited] = await sql<{ headline: string; edited_by: string }>`select headline, edited_by from leads where id = ${id}`;
    assert.equal(edited!.headline, "A new headline attempt");
    assert.equal(edited!.edited_by, "editor-killed");
    assert.equal((await overrideAudit("editor-killed")).length, 1);
  });

  it("warns on a published lead, then applies it on the second press (item 4)", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("published");
    const data = editLeadInput.parse({ id, headline: "A new headline attempt", why: "Trying anyway", topic: "council" });
    const refused = await updateLeadForEditor({ userId: "editor-pub", newsroomId: NEWSROOM }, data as LeadEditInput);
    assert.equal(refused.ok, false);
    assert.equal(refused.warning?.key, "lead-edit-published");
    const applied = await updateLeadForEditor(
      { userId: "editor-pub", newsroomId: NEWSROOM },
      { ...(data as LeadEditInput), override: ["lead-edit-published"] },
    );
    assert.equal(applied.ok, true);
  });

  it("keeps a missing lead hard, with no warning key, even with an override (record missing)", async () => {
    await ensureAuditEventsSchema();
    const data = editLeadInput.parse({ id: 999_999_001, headline: "A full sentence headline", why: "A real reason it is news", topic: "council" });
    const result = await updateLeadForEditor(
      { userId: "editor-missing", newsroomId: NEWSROOM },
      { ...(data as LeadEditInput), override: ["lead-edit-killed", "lead-edit-published", "lead-edit-why", "lead-edit-headline-short"] },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, "Lead not found.");
    assert.equal((await overrideAudit("editor-missing")).length, 0, "a record that is gone is never overridden");
  });
});
