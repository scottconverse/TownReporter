import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { listAutoPublishedRegistryEntries } from "./registry-desk.server.ts";

await applyMigrationsToTestPglite();

async function seed(newsroomId: number) {
  const sql = await getSql();
  const [source] = await sql.query<{ id: number }>(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
     values ('desk-scan', $1, 'https://www.ourcenter.org/referral-program/', 'OUR Center', 'community', 'B', 'accepted')
     returning id`,
    [newsroomId],
  );
  const [org] = await sql.query<{ id: number }>(
    `insert into organizations (newsroom_id, hsds_id, name, published, status, source_id)
     values ($1, 'org-desk', 'OUR Center', true, 'active', $2) returning id`,
    [newsroomId, source!.id],
  );
  const [service] = await sql.query<{ id: number }>(
    `insert into services (newsroom_id, hsds_id, organization_id, name, published, source_id)
     values ($1, 'svc-desk', $2, 'Help with basic needs', true, $3) returning id`,
    [newsroomId, org!.id, source!.id],
  );
  return { sourceId: Number(source!.id), serviceId: Number(service!.id) };
}

test("the desk lists auto-published entries newest first, crisis first, with the source URL", async () => {
  const sql = await getSql();
  const newsroomId = 9801;
  const seeded = await seed(newsroomId);

  // An older normal publish and a newer crisis publish.
  await sql.query(
    `insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id, created_at)
     values ('scan-owner', 'registry.service.autopublish', 'Auto-published from https://www.ourcenter.org/',
             $1, 'registry-service', $2, now() - interval '1 day')`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id, created_at)
     values ('scan-owner', 'registry.service.autopublish', '[Crisis] Auto-published from https://www.ourcenter.org/',
             $1, 'registry-service', $2, now())`,
    [newsroomId, seeded.serviceId],
  );

  const rows = await listAutoPublishedRegistryEntries(sql, newsroomId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.crisis, true, "the crisis row is listed first");
  assert.equal(rows[0]!.serviceId, seeded.serviceId);
  assert.equal(rows[0]!.organizationName, "OUR Center");
  assert.equal(rows[0]!.serviceName, "Help with basic needs");
  assert.equal(rows[0]!.sourceUrl, "https://www.ourcenter.org/referral-program/");
  assert.equal(rows[0]!.published, true);
});
