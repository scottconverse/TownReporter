import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureAuditEventsSchema } from "./ops.ts";
import { addLeadSourceUrl } from "./lead-edit.server.ts";

/**
 * D286's "Add to this story": one captured page's address onto the lead's own
 * source list. Same shape as `lead-edit-override.test.ts` -- the real
 * `addLeadSourceUrl` against the real (PGlite) `leads` and `audit_events`
 * tables, with no providers.
 */

const NEWSROOM = 831;
const OTHER_ROOM = 832;

async function freshLead(
  status: string,
  newsroom = NEWSROOM,
  sourceUrls = "[]",
): Promise<number> {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into leads (newsroom_id, user_id, headline, why, topic, status, source_urls)
    values (${newsroom}, 'scanner', 'An ordinary filed lead headline', 'A reason it is news',
            'council', ${status}, ${sourceUrls})
    returning id
  `;
  return row!.id;
}

async function readLead(id: number) {
  const sql = await getSql();
  const [row] = await sql<{ source_urls: string; edited_by: string | null }>`
    select source_urls, edited_by from leads where id = ${id}
  `;
  return { urls: JSON.parse(row!.source_urls) as string[], editedBy: row!.edited_by };
}

async function overrideAudit(userId: string) {
  const sql = await getSql();
  return await sql<{ detail: string }>`
    select detail from audit_events
    where user_id = ${userId} and action = 'override' order by id
  `;
}

describe("addLeadSourceUrl", () => {
  it("adds a url once and does not repeat it on a second press", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("new");
    const data = { leadId: id, url: "https://example.com/broadband-report" };

    const first = await addLeadSourceUrl({ userId: "editor-add", newsroomId: NEWSROOM }, data);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.urls, ["https://example.com/broadband-report"]);

    const second = await addLeadSourceUrl({ userId: "editor-add", newsroomId: NEWSROOM }, data);
    assert.equal(second.ok, true);
    const lead = await readLead(id);
    assert.deepEqual(lead.urls, ["https://example.com/broadband-report"]);
    assert.equal(lead.editedBy, "editor-add");
  });

  it("keeps the urls already on the lead", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("new", NEWSROOM, JSON.stringify(["https://example.com/old"]));
    const result = await addLeadSourceUrl(
      { userId: "editor-keep", newsroomId: NEWSROOM },
      { leadId: id, url: "https://example.com/new" },
    );
    assert.equal(result.ok, true);
    const lead = await readLead(id);
    assert.deepEqual(lead.urls, ["https://example.com/old", "https://example.com/new"]);
  });

  it("warns on a killed lead, changes nothing, then adds on the second press", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("killed");
    const data = { leadId: id, url: "https://example.com/killed-source" };

    const refused = await addLeadSourceUrl({ userId: "editor-killed-add", newsroomId: NEWSROOM }, data);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.warning?.key, "lead-add-source-killed");
    assert.equal(refused.warning?.sentence, refused.error);
    assert.deepEqual((await readLead(id)).urls, []);
    assert.equal((await overrideAudit("editor-killed-add")).length, 0);

    const applied = await addLeadSourceUrl(
      { userId: "editor-killed-add", newsroomId: NEWSROOM },
      { ...data, override: ["lead-add-source-killed"] },
    );
    assert.equal(applied.ok, true);
    assert.deepEqual((await readLead(id)).urls, ["https://example.com/killed-source"]);
    const audit = await overrideAudit("editor-killed-add");
    assert.equal(audit.length, 1);
    assert.equal(JSON.parse(audit[0]!.detail).key, "lead-add-source-killed");
  });

  it("warns on a published lead, then adds on the second press", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("published");
    const data = { leadId: id, url: "https://example.com/published-source" };
    const refused = await addLeadSourceUrl({ userId: "editor-pub-add", newsroomId: NEWSROOM }, data);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.warning?.key, "lead-add-source-published");
    const applied = await addLeadSourceUrl(
      { userId: "editor-pub-add", newsroomId: NEWSROOM },
      { ...data, override: ["lead-add-source-published"] },
    );
    assert.equal(applied.ok, true);
  });

  it("keeps a lead in another newsroom hard", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("new", OTHER_ROOM);
    const result = await addLeadSourceUrl(
      { userId: "editor-other", newsroomId: NEWSROOM },
      { leadId: id, url: "https://example.com/nope" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "Lead not found.");
    assert.equal("warning" in result, false);
  });

  it("refuses an address the public-url rules drop", async () => {
    await ensureAuditEventsSchema();
    const id = await freshLead("new");
    const result = await addLeadSourceUrl(
      { userId: "editor-bad-url", newsroomId: NEWSROOM },
      { leadId: id, url: "not a web address" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "That web address cannot be added.");
    assert.deepEqual((await readLead(id)).urls, []);
  });
});
