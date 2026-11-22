import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  listAutoPublishedRegistryEntries,
  readDeskEntryPanel,
} from "./registry-desk.server.ts";

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
  const [foodService] = await sql.query<{ id: number }>(
    `insert into services (newsroom_id, hsds_id, organization_id, name, published, source_id)
     select $1, 'svc-food', organization_id, 'Food bank', true, source_id
       from services where id = $2 and newsroom_id = $1 returning id`,
    [newsroomId, seeded.serviceId],
  );

  // An older normal publish on one entry and a newer crisis publish on another.
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
    [newsroomId, foodService!.id],
  );

  const rows = await listAutoPublishedRegistryEntries(sql, newsroomId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.crisis, true, "the crisis entry is listed first");
  assert.equal(rows[0]!.serviceId, Number(foodService!.id));
  assert.equal(rows[0]!.organizationName, "OUR Center");
  assert.equal(rows[0]!.serviceName, "Food bank");
  assert.equal(rows[0]!.sourceUrl, "https://www.ourcenter.org/referral-program/");
  assert.equal(rows[0]!.published, true);
});

/*
  Scott, Nov 22 2026: a rechecked entry has two autopublish rows, so it drew two
  cards and the count was too high. One service is one card, whatever its rows:
  the card takes the newest publish time, and it is a crisis entry when any of
  its rows is a crisis row (here the crisis row is the older one).
*/
test("two auto-publish rows for one service make one card, with the newest time and any crisis row", async () => {
  const sql = await getSql();
  const newsroomId = 9803;
  const seeded = await seed(newsroomId);

  await sql.query(
    `insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id, created_at)
     values ('scan-owner', 'registry.service.autopublish', '[Crisis] Auto-published from https://www.ourcenter.org/',
             $1, 'registry-service', $2, now() - interval '2 days')`,
    [newsroomId, seeded.serviceId],
  );
  const [newest] = await sql.query<{ id: number; created_at: Date | string }>(
    `insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id, created_at)
     values ('scan-owner', 'registry.service.autopublish', 'Auto-published from https://www.ourcenter.org/',
             $1, 'registry-service', $2, now())
     returning id, created_at`,
    [newsroomId, seeded.serviceId],
  );

  const rows = await listAutoPublishedRegistryEntries(sql, newsroomId);
  assert.equal(rows.length, 1, "one service is one card");
  assert.equal(rows[0]!.serviceId, seeded.serviceId);
  assert.equal(rows[0]!.crisis, true, "one crisis row marks the entry as a crisis entry");
  assert.equal(rows[0]!.auditId, Number(newest!.id), "the card keys on the newest audit row");
  assert.equal(
    new Date(rows[0]!.publishedAt as string | Date).getTime(),
    new Date(newest!.created_at).getTime(),
    "the card shows the newest auto-publish time",
  );
});

/*
  Scott, Nov 20 2026: "It had the name of the site, no website URL, nothing."
  One entry's own desk page must carry every fact the registry holds, the pages
  it came from and its history.
*/
test("one entry's desk page carries every fact, its source and its history", async () => {
  const sql = await getSql();
  const newsroomId = 9802;
  const seeded = await seed(newsroomId);

  await sql.query(
    `insert into contacts (newsroom_id, hsds_id, service_id, phone, website, published)
     values ($1, 'c-1', $2, '303-555-0101', 'https://ourcenter.test/help', true)`,
    [newsroomId, seeded.serviceId],
  );
  const [place] = await sql.query<{ id: number }>(
    `insert into locations (newsroom_id, hsds_id, organization_id, name, address_1, city, state_province, postal_code, published)
     select $1, 'l-1', organization_id, 'The Center', '12 Main St', 'Longmont', 'CO', '80501', true
       from services where id = $2 and newsroom_id = $1 returning id`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, published)
     values ($1, 'sal-1', $2, $3, true)`,
    [newsroomId, seeded.serviceId, place!.id],
  );
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, days, opens_at, closes_at, published)
     values ($1, 's-1', $2, 'Monday to Friday', '9', '5', true)`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description, published)
     values ($1, 'e-1', $2, 'Longmont residents', true)`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `insert into languages (newsroom_id, hsds_id, service_id, language, published)
     values ($1, 'lg-1', $2, 'Spanish', true)`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `update services set fees = 'Free', description = 'Help with rent and food.'
      where id = $1 and newsroom_id = $2`,
    [seeded.serviceId, newsroomId],
  );
  await sql.query(
    `insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
     values ('scan-owner', 'registry.service.recheck', 'Rechecked the page; the facts still match.',
             $1, 'registry-service', $2)`,
    [newsroomId, seeded.serviceId],
  );

  const panel = await readDeskEntryPanel(sql, newsroomId, seeded.serviceId);
  assert.ok(panel, "the entry's page is read");
  assert.deepEqual(panel!.entry.phones, ["303-555-0101"]);
  assert.equal(panel!.entry.website, "https://ourcenter.test/help");
  assert.equal(panel!.entry.address, "12 Main St, Longmont, CO 80501");
  assert.deepEqual(panel!.entry.hours, ["Monday to Friday: 9 to 5"]);
  assert.equal(panel!.entry.eligibility, "Longmont residents");
  assert.deepEqual(panel!.entry.languages, ["Spanish"]);
  assert.equal(panel!.entry.fees, "Free");
  assert.equal(panel!.entry.description, "Help with rent and food.");
  assert.equal(panel!.entry.sourceTitle, "OUR Center");
  assert.equal(panel!.entry.sourceUrl, "https://www.ourcenter.org/referral-program/");
  assert.equal(panel!.sources.length, 1);
  assert.equal(panel!.sources[0]!.url, "https://www.ourcenter.org/referral-program/");
  assert.ok(panel!.history.some((row) => row.action === "registry.service.recheck"));
  assert.equal(panel!.detail.places.length, 1);
});
