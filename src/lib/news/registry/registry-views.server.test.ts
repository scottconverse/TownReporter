import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  listDeskChanges,
  listRegistryImports,
  listRegistrySourcesWithHealth,
} from "./registry-desk.server.ts";
import { listPublicRegistry } from "./registry-public.server.ts";

await applyMigrationsToTestPglite();

interface Seeded {
  sourceId: number;
  organizationId: number;
  serviceId: number;
  taxonomyId: number;
  snapshotId: number;
  runId: number;
}

async function seedNewsroom(
  newsroomId: number,
  options: {
    serviceName?: string;
    published?: boolean;
    serviceStatus?: string;
    taxonomyName?: string;
    verifiedAt?: string | null;
    /** Child rows follow the service's published flag unless set here. */
    childPublished?: boolean;
    /** Keeps the HSDS identifiers unique when one newsroom is seeded twice. */
    suffix?: string;
  } = {},
): Promise<Seeded> {
  const sql = await getSql();
  const childPublished = options.childPublished ?? options.published ?? false;
  const key = (name: string) => `${name}-${newsroomId}${options.suffix ?? ""}`;
  const [source] = await sql.query<{ id: number }>(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status, last_fetched_at)
     values ('registry-view', $1, $2, 'Registry source', 'official', 'A', 'accepted', now())
     returning id`,
    [newsroomId, `https://registry.test/${newsroomId}${options.suffix ?? ""}`],
  );
  const [taxonomy] = await sql.query<{ id: number }>(
    `insert into taxonomies (newsroom_id, hsds_id, name) values ($1, $2, $3) returning id`,
    [newsroomId, key("tax"), options.taxonomyName ?? "Food"],
  );
  const [org] = await sql.query<{ id: number }>(
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, $2, 'Example Org', 'active', $3) returning id`,
    [newsroomId, key("org"), options.published ?? false],
  );
  const [service] = await sql.query<{ id: number }>(
    `insert into services
       (newsroom_id, hsds_id, organization_id, name, description, status, published,
        taxonomy_id, source_id, last_verified_at)
     values ($1, $2, $3, $4, 'A pantry.', $5, $6, $7, $8, $9) returning id`,
    [
      newsroomId,
      key("svc"),
      org!.id,
      options.serviceName ?? "Weekly pantry",
      options.serviceStatus ?? "active",
      options.published ?? false,
      taxonomy!.id,
      source!.id,
      options.verifiedAt ?? null,
    ],
  );
  const [snapshot] = await sql.query<{ id: number }>(
    `insert into snapshots (user_id, newsroom_id, source_id, content_hash, excerpt)
     values ('registry-view', $1, $2, 'hash', 'text') returning id`,
    [newsroomId, source!.id],
  );
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs (user_id, newsroom_id) values ('registry-view', $1) returning id",
    [newsroomId],
  );

  await sql.query(
    `insert into contacts (newsroom_id, hsds_id, service_id, phone, published)
     values ($1, $2, $3, '555-0100', $4)`,
    [newsroomId, key("ct"), service!.id, childPublished],
  );
  await sql.query(
    `insert into languages (newsroom_id, hsds_id, service_id, language, published)
     values ($1, $2, $3, 'Spanish', $4)`,
    [newsroomId, key("lang"), service!.id, childPublished],
  );
  const [location] = await sql.query<{ id: number }>(
    `insert into locations (newsroom_id, hsds_id, organization_id, address_1, city, state_province, postal_code, published)
     values ($1, $2, $3, '100 Main St', 'Longmont', 'CO', '80501', $4) returning id`,
    [newsroomId, key("loc"), org!.id, childPublished],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, published)
     values ($1, $2, $3, $4, $5)`,
    [newsroomId, key("sal"), service!.id, location!.id, childPublished],
  );
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, days, opens_at, closes_at, published)
     values ($1, $2, $3, 'Monday', '09:00', '11:00', $4)`,
    [newsroomId, key("sch"), service!.id, childPublished],
  );

  return {
    sourceId: Number(source!.id),
    organizationId: Number(org!.id),
    serviceId: Number(service!.id),
    taxonomyId: Number(taxonomy!.id),
    snapshotId: Number(snapshot!.id),
    runId: Number(run!.id),
  };
}

test("the public list returns published rows with their source, last verified date and children", async () => {
  const sql = await getSql();
  const newsroomId = 9401;
  const seeded = await seedNewsroom(newsroomId, {
    published: true,
    verifiedAt: "2026-10-01T12:00:00Z",
  });

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1);
  const entry = page.entries[0]!;
  assert.equal(entry.serviceId, seeded.serviceId);
  assert.equal(entry.organizationName, "Example Org");
  assert.equal(entry.serviceName, "Weekly pantry");
  assert.equal(entry.address, "100 Main St, Longmont, CO, 80501");
  assert.equal(entry.phone, "555-0100");
  assert.deepEqual(entry.languages, ["Spanish"]);
  assert.equal(entry.hours, "Monday, 09:00–11:00");
  assert.equal(entry.sourceUrl, `https://registry.test/${newsroomId}`);
  assert.ok(entry.lastVerifiedAt, "last verified date is returned");
  assert.equal(
    new Date(entry.lastVerifiedAt as string | Date).toISOString(),
    "2026-10-01T12:00:00.000Z",
  );
  assert.deepEqual(
    page.categories.map((category) => category.name),
    ["Food"],
  );
});

test("a row with published = false never appears in the public list", async () => {
  const sql = await getSql();
  const newsroomId = 9402;
  await seedNewsroom(newsroomId, { published: false });

  const page = await listPublicRegistry(sql, newsroomId);
  assert.deepEqual(page.entries, []);
  assert.deepEqual(page.categories, [], "an unpublished service adds no category either");
});

test("a published service shows only its published children", async () => {
  const sql = await getSql();
  const newsroomId = 9410;
  const seeded = await seedNewsroom(newsroomId, {
    published: true,
    childPublished: true,
    suffix: "a",
  });

  // Unpublished phones, schedules, languages and address all stay off the page.
  await sql.query(
    `insert into contacts (newsroom_id, hsds_id, service_id, phone, published)
     values ($1, 'ct-unpub', $2, '555-9999', false)`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `insert into languages (newsroom_id, hsds_id, service_id, language, published)
     values ($1, 'lang-unpub', $2, 'French', false)`,
    [newsroomId, seeded.serviceId],
  );
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, days, opens_at, closes_at, published)
     values ($1, 'sch-unpub', $2, 'Sunday', '14:00', '16:00', false)`,
    [newsroomId, seeded.serviceId],
  );
  const [unpublishedLocation] = await sql.query<{ id: number }>(
    `insert into locations
       (newsroom_id, hsds_id, organization_id, address_1, city, state_province, postal_code, published)
     values ($1, 'loc-unpub', $2, '9 Wrong St', 'Boulder', 'CO', '80301', false) returning id`,
    [newsroomId, seeded.organizationId],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, published)
     values ($1, 'sal-unpub', $2, $3, true)`,
    [newsroomId, seeded.serviceId, unpublishedLocation!.id],
  );
  // A published service_at_location whose location is unpublished, and a
  // schedule reached through it that is also unpublished.
  const [secondLocation] = await sql.query<{ id: number }>(
    `insert into locations
       (newsroom_id, hsds_id, organization_id, address_1, city, state_province, postal_code, published)
     values ($1, 'loc-unpub-sal', $2, '8 Wrong St', 'Boulder', 'CO', '80301', false) returning id`,
    [newsroomId, seeded.organizationId],
  );
  const [linkedSchedule] = await sql.query<{ id: number }>(
    `insert into schedules (newsroom_id, hsds_id, days, opens_at, closes_at, published)
     values ($1, 'sch-sal', 'Tuesday', '10:00', '12:00', false) returning id`,
    [newsroomId],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, schedule_id, published)
     values ($1, 'sal-unpub-location', $2, $3, $4, true)`,
    [newsroomId, seeded.serviceId, secondLocation!.id, linkedSchedule!.id],
  );

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1);
  const entry = page.entries[0]!;
  assert.equal(entry.phone, "555-0100", "only the published phone is shown");
  assert.equal(
    entry.address,
    "100 Main St, Longmont, CO, 80501",
    "only the published address is shown",
  );
  assert.equal(entry.hours, "Monday, 09:00–11:00", "only the published schedule is shown");
  assert.deepEqual(entry.languages, ["Spanish"], "only the published language is shown");
});

test("a published service under an unpublished organization stays out of the public list", async () => {
  const sql = await getSql();
  const newsroomId = 9403;
  const seeded = await seedNewsroom(newsroomId, { published: true });
  // The service is published on its own; the organization is not.
  await sql.query("update organizations set published = false where id = $1", [
    seeded.organizationId,
  ]);

  const page = await listPublicRegistry(sql, newsroomId);
  assert.deepEqual(page.entries, []);
});

test("a category whose only service sits under an unpublished organization is not offered", async () => {
  const sql = await getSql();
  const newsroomId = 9411;
  const seeded = await seedNewsroom(newsroomId, { published: true });
  // The service is published and active; its organization is not, so the list
  // rule drops the service and the category nav must drop its category too.
  await sql.query("update organizations set status = 'inactive' where id = $1", [
    seeded.organizationId,
  ]);

  const page = await listPublicRegistry(sql, newsroomId);
  assert.deepEqual(page.entries, []);
  assert.deepEqual(page.categories, []);
});

test("the category filter returns only that category's published rows", async () => {
  const sql = await getSql();
  const newsroomId = 9404;
  const food = await seedNewsroom(newsroomId, {
    published: true,
    taxonomyName: "Food",
    suffix: "a",
  });
  const housing = await seedNewsroom(newsroomId, {
    published: true,
    taxonomyName: "Housing",
    suffix: "b",
  });

  const all = await listPublicRegistry(sql, newsroomId);
  assert.equal(all.entries.length, 2);

  const filtered = await listPublicRegistry(sql, newsroomId, housing.taxonomyId);
  assert.deepEqual(
    filtered.entries.map((entry) => entry.serviceId),
    [housing.serviceId],
  );
  assert.ok(food.serviceId !== housing.serviceId);
  // The nav still offers both categories, so a reader can move between them.
  assert.deepEqual(
    filtered.categories.map((category) => category.name),
    ["Food", "Housing"],
  );
});

test("an unverified row says so rather than inventing a date", async () => {
  const sql = await getSql();
  const newsroomId = 9405;
  await seedNewsroom(newsroomId, { published: true, verifiedAt: null });

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0]!.lastVerifiedAt, null);
});

test("the desk list returns this newsroom's changes and nothing from another newsroom", async () => {
  const sql = await getSql();
  const mine = await seedNewsroom(9406);
  const theirs = await seedNewsroom(9407);

  const insertChange = async (newsroomId: number, seeded: Seeded, fieldName: string) =>
    sql.query(
      `insert into resource_changes
         (newsroom_id, scan_run_id, source_id, source_capture_id, evidence_capture_id,
          evidence_tier, entity_type, entity_id, field_name, before_value, after_value,
          change_kind, summary, review_state)
       values ($1, $2, $3, $4, $4, 'B', 'service', $5, $6, 'old', 'new', 'field_change', 'note', 'pending')`,
      [newsroomId, seeded.runId, seeded.sourceId, seeded.snapshotId, seeded.serviceId, fieldName],
    );

  await insertChange(9406, mine, "phone");
  await insertChange(9406, mine, "description");
  await insertChange(9407, theirs, "email");

  const changes = await listDeskChanges(sql, 9406);
  assert.equal(changes.length, 2);
  assert.deepEqual(
    changes.map((change) => change.fieldName).sort(),
    ["description", "phone"],
  );
  assert.ok(changes.every((change) => change.entityName === "Weekly pantry"));
  assert.equal(changes[0]!.evidenceTier, "B");
  assert.equal(changes[0]!.sourceTitle, "Registry source");

  const other = await listDeskChanges(sql, 9407);
  assert.equal(other.length, 1);
  assert.equal(other[0]!.fieldName, "email");
});

test("the desk's imports and registry sources are this newsroom's only", async () => {
  const sql = await getSql();
  const mine = await seedNewsroom(9408);
  await seedNewsroom(9409);

  await sql.query(
    `insert into resource_imports (newsroom_id, directory_name, format, record_counts, conflicts)
     values ($1, 'Boulder County', 'json', '{"organizations": 3, "services": 4}', '[{"hsds_id": "x"}]')`,
    [9408],
  );
  await sql.query(
    `insert into resource_imports (newsroom_id, directory_name, format)
     values ($1, 'Another directory', 'json')`,
    [9409],
  );
  await sql.query(
    `insert into resource_sources (newsroom_id, source_id, registry_role, directory_name)
     values ($1, $2, 'directory', 'Boulder County')`,
    [9408, mine.sourceId],
  );

  const imports = await listRegistryImports(sql, 9408);
  assert.equal(imports.length, 1);
  assert.equal(imports[0]!.directoryName, "Boulder County");
  assert.equal(imports[0]!.recordCount, 7);
  assert.equal(imports[0]!.conflictCount, 1);

  const sources = await listRegistrySourcesWithHealth(sql, 9408);
  assert.equal(sources.length, 1);
  assert.equal(sources[0]!.registryRole, "directory");
  assert.ok(sources[0]!.lastFetchedAt, "last fetched date is returned from the source");
  assert.equal((await sql.query("select id from resource_sources where newsroom_id = 9409")).length, 0);
});
