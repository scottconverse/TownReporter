import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import type { ParsedResourceChange } from "../schema.ts";
import {
  commitScanResourceChanges,
  evidenceTierForSource,
  normalizeSourceUrl,
  registryChangeSentence,
} from "./scan-changes.server.ts";

await applyMigrationsToTestPglite();

const SOURCE_URL = "https://registry.test/resources";
const USER = "registry-scan";

function change(overrides: Partial<ParsedResourceChange> = {}): ParsedResourceChange {
  return {
    entity_type: "service",
    entity_hsds_id: "",
    entity_name: "",
    field_name: "phone",
    before_value: "555-0100",
    after_value: "555-0199",
    change_kind: "contact_change",
    summary: "New phone number.",
    model_confidence: 0.9,
    source_url: SOURCE_URL,
    ...overrides,
  };
}

async function seedNewsroom(newsroomId: number, tier = "B") {
  const sql = await getSql();
  const [source] = await sql.query<{ id: number }>(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
     values ('registry-scan', $1, $2, 'Registry source', 'official', $3, 'accepted') returning id`,
    [newsroomId, SOURCE_URL, tier],
  );
  const [org] = await sql.query<{ id: number }>(
    `insert into organizations (newsroom_id, hsds_id, name) values ($1, 'org-scan', 'Example Org') returning id`,
    [newsroomId],
  );
  const [service] = await sql.query<{ id: number }>(
    `insert into services (newsroom_id, hsds_id, organization_id, name)
     values ($1, 'svc-scan', $2, 'Weekly grocery pickup') returning id`,
    [newsroomId, org!.id],
  );
  const [snapshot] = await sql.query<{ id: number }>(
    `insert into snapshots (user_id, newsroom_id, source_id, content_hash, excerpt)
     values ('registry-scan', $1, $2, 'hash', 'text') returning id`,
    [newsroomId, source!.id],
  );
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs (user_id, newsroom_id) values ('registry-scan', $1) returning id",
    [newsroomId],
  );
  return {
    sourceId: Number(source!.id),
    organizationId: Number(org!.id),
    serviceId: Number(service!.id),
    snapshotId: Number(snapshot!.id),
    runId: Number(run!.id),
  };
}

function maps(sourceId: number, snapshotId: number, tier: string) {
  return {
    sourceIdByUrl: new Map([[normalizeSourceUrl(SOURCE_URL), sourceId]]),
    snapshotIdBySourceId: new Map([[sourceId, snapshotId]]),
    tierBySourceId: new Map([[sourceId, tier]]),
  };
}

test("evidence tier comes from the source, and an unknown tier is the weakest", () => {
  assert.equal(evidenceTierForSource("A"), "A");
  assert.equal(evidenceTierForSource("B"), "B");
  assert.equal(evidenceTierForSource("C"), "C");
  assert.equal(evidenceTierForSource("unclassified"), "C");
  assert.equal(evidenceTierForSource(null), "C");
});

test("a change whose page has no retained capture is rejected, not stored (guardrail 1)", async () => {
  const sql = await getSql();
  const newsroomId = 9301;
  const seeded = await seedNewsroom(newsroomId);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [change({ source_url: "https://never-fetched.test/page" })],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });

  assert.deepEqual(counts, { stored: 0, rejected: 1, published: 0, created: 0, crisis: 0 });
  const rows = await sql.query("select id from resource_changes where newsroom_id = $1", [newsroomId]);
  assert.equal(rows.length, 0);
  assert.match(registryChangeSentence(counts), /rejected for lack of a retained capture/);
});

/*
  Scott, Nov 20 2026: "I looked at one of the needs approval, and it didn't have
  any data. It had the name of the site, no website URL, nothing." This is that
  empty proposal: a change that names an entity and states no value at all. It
  used to be stored (and, for a new place, used to create a row with a name and
  nothing else); now it is dropped before anything is written.
*/
test("a change that names an entry but states no fact is dropped, not stored", async () => {
  const sql = await getSql();
  const newsroomId = 9320;
  const seeded = await seedNewsroom(newsroomId);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "location",
        entity_name: "Brand New Hall",
        field_name: "name",
        before_value: null,
        after_value: null,
        change_kind: "field_change",
        summary: "",
        quote: "",
      }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });

  assert.deepEqual(counts, { stored: 0, rejected: 1, published: 0, created: 0, crisis: 0 });
  const stored = await sql.query("select id from resource_changes where newsroom_id = $1", [
    newsroomId,
  ]);
  assert.equal(stored.length, 0, "no empty proposal is stored");
  const places = await sql.query("select id from locations where newsroom_id = $1", [newsroomId]);
  assert.equal(places.length, 0, "no entry is created from a name alone");
});

test("a proposal stores the full fact, the source and the page's own sentence", async () => {
  const sql = await getSql();
  const newsroomId = 9321;
  const seeded = await seedNewsroom(newsroomId);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "schedule",
        entity_name: "Weekly grocery pickup",
        field_name: "days",
        before_value: null,
        after_value: "Monday to Friday, 9 to 5",
        change_kind: "hours_change",
        summary: "The pantry is open five days a week.",
        quote: "The pantry is open Monday to Friday, 9 to 5.",
      }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.equal(counts.stored, 1);

  const [row] = await sql.query<{
    review_state: string;
    field_name: string;
    after_value: string;
    evidence_quote: string;
    source_id: number;
    evidence_capture_id: number;
  }>(
    `select review_state, field_name, after_value, evidence_quote, source_id, evidence_capture_id
       from resource_changes where newsroom_id = $1`,
    [newsroomId],
  );
  assert.equal(row!.review_state, "pending");
  assert.equal(row!.field_name, "days");
  assert.equal(row!.after_value, "Monday to Friday, 9 to 5");
  assert.equal(row!.evidence_quote, "The pantry is open Monday to Friday, 9 to 5.");
  assert.equal(Number(row!.source_id), seeded.sourceId, "the source page travels with the proposal");
  assert.equal(Number(row!.evidence_capture_id), seeded.snapshotId);
});

test("a change on an existing service is applied and the entry is auto-published", async () => {
  const sql = await getSql();
  const newsroomId = 9302;
  const seeded = await seedNewsroom(newsroomId, "C");

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [change({ entity_hsds_id: "svc-scan", entity_name: "Weekly grocery pickup" })],
    ...maps(seeded.sourceId, seeded.snapshotId, "C"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, published: 1, created: 0, crisis: 0 });

  const [row] = await sql.query<{
    review_state: string;
    evidence_tier: string;
    entity_type: string;
    entity_id: number | null;
    scan_run_id: number;
    source_id: number;
    evidence_capture_id: number;
    applied_at: unknown;
    review_note: string | null;
  }>(
    `select review_state, evidence_tier, entity_type, entity_id, scan_run_id, source_id,
            evidence_capture_id, applied_at, review_note
       from resource_changes where newsroom_id = $1`,
    [newsroomId],
  );
  assert.equal(row!.review_state, "accepted");
  assert.equal(row!.evidence_tier, "C");
  assert.equal(row!.entity_type, "service");
  assert.equal(Number(row!.entity_id), seeded.serviceId);
  assert.equal(Number(row!.scan_run_id), seeded.runId);
  assert.equal(Number(row!.source_id), seeded.sourceId);
  assert.equal(Number(row!.evidence_capture_id), seeded.snapshotId);
  assert.ok(row!.applied_at, "the change was applied, not just recorded");
  assert.match(String(row!.review_note), /Auto-published by the scan/);

  // The phone lives on a contact row; the service itself is now published.
  const [service] = await sql.query<{ name: string; published: boolean }>(
    "select name, published from services where id = $1",
    [seeded.serviceId],
  );
  assert.deepEqual(service, { name: "Weekly grocery pickup", published: true });
  const [contact] = await sql.query<{ phone: string }>(
    "select phone from contacts where newsroom_id = $1 and service_id = $2",
    [newsroomId, seeded.serviceId],
  );
  assert.equal(contact!.phone, "555-0199");

  const [audit] = await sql.query<{ action: string; detail: string }>(
    "select action, detail from audit_events where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(audit!.action, "registry.service.autopublish");
  assert.match(audit!.detail, /registry\.test\/resources/);
});

test("a change naming no existing organization creates it and publishes it (part 3)", async () => {
  const sql = await getSql();
  const newsroomId = 9303;
  const seeded = await seedNewsroom(newsroomId);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "organization",
        entity_name: "Brand New Mutual Aid",
        entity_hsds_id: "",
        field_name: "name",
        after_value: "Brand New Mutual Aid",
        change_kind: "field_change",
      }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, published: 1, created: 1, crisis: 0 });

  const [row] = await sql.query<{ entity_id: number | null; review_state: string }>(
    "select entity_id, review_state from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.notEqual(row!.entity_id, null, "the new entity is created, not left unresolved");
  assert.equal(row!.review_state, "accepted");

  const [named] = await sql.query<{ id: number; published: boolean }>(
    "select id, published from organizations where newsroom_id = $1 and name = 'Brand New Mutual Aid'",
    [newsroomId],
  );
  assert.equal(Number(named!.id), Number(row!.entity_id));
  assert.equal(named!.published, true);

  const [audit] = await sql.query<{ action: string }>(
    "select action from audit_events where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(audit!.action, "registry.change.autopublish");
});

test("a new service change creates its organization and service, and publishes the entry", async () => {
  const sql = await getSql();
  const newsroomId = 9310;
  const seeded = await seedNewsroom(newsroomId);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "service",
        entity_name: "Free Community Supper",
        entity_hsds_id: "",
        field_name: "description",
        after_value: "A free supper every Wednesday.",
        change_kind: "field_change",
      }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, published: 1, created: 1, crisis: 0 });

  const [service] = await sql.query<{
    id: number;
    published: boolean;
    description: string;
  }>(
    "select id, published, description from services where newsroom_id = $1 and name = 'Free Community Supper'",
    [newsroomId],
  );
  assert.equal(service!.published, true);
  assert.equal(service!.description, "A free supper every Wednesday.");

  const [org] = await sql.query<{ count: string }>(
    "select count(*)::text as count from organizations where newsroom_id = $1 and name = 'Free Community Supper' and published = true",
    [newsroomId],
  );
  assert.equal(Number(org!.count), 1);
});

async function addSchedule(newsroomId: number, serviceId: number, hsdsId: string) {
  const sql = await getSql();
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, days, opens_at, closes_at)
     values ($1, $2, $3, 'Monday', '09:00', '11:00')`,
    [newsroomId, hsdsId, serviceId],
  );
}

test("a crisis service change is still auto-published, and its audit row is marked crisis", async () => {
  const sql = await getSql();
  const newsroomId = 9305;
  const seeded = await seedNewsroom(newsroomId);
  await sql.query("update services set crisis = true where id = $1", [seeded.serviceId]);
  await addSchedule(newsroomId, seeded.serviceId, "sch-crisis");

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "schedule",
        entity_hsds_id: "sch-crisis",
        field_name: "opens_at",
        before_value: "09:00",
        after_value: "10:00",
        change_kind: "hours_change",
      }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, published: 1, created: 0, crisis: 1 });

  const [row] = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(row!.review_state, "accepted");

  const [schedule] = await sql.query<{ opens_at: string }>(
    "select opens_at from schedules where newsroom_id = $1 and hsds_id = 'sch-crisis'",
    [newsroomId],
  );
  assert.equal(schedule!.opens_at, "10:00");

  const [audit] = await sql.query<{ detail: string }>(
    "select detail from audit_events where newsroom_id = $1 and action = 'registry.service.autopublish'",
    [newsroomId],
  );
  assert.match(audit!.detail, /^\[Crisis\]/);
  assert.match(registryChangeSentence(counts), /crisis service change/);
});

test("a normal schedule change is auto-published without a crisis mark", async () => {
  const sql = await getSql();
  const newsroomId = 9306;
  const normal = await seedNewsroom(newsroomId);
  await addSchedule(newsroomId, normal.serviceId, "sch-normal");
  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: normal.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "schedule",
        entity_hsds_id: "sch-normal",
        field_name: "opens_at",
        before_value: "09:00",
        after_value: "10:00",
        change_kind: "hours_change",
      }),
    ],
    ...maps(normal.sourceId, normal.snapshotId, "B"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, published: 1, created: 0, crisis: 0 });
  const [audit] = await sql.query<{ detail: string }>(
    "select detail from audit_events where newsroom_id = $1",
    [newsroomId],
  );
  assert.doesNotMatch(audit!.detail, /^\[Crisis\]/);
});

test("a schedule reached only through service_at_locations still finds its crisis service", async () => {
  const sql = await getSql();
  const newsroomId = 9307;
  const seeded = await seedNewsroom(newsroomId);
  await sql.query("update services set crisis = true where id = $1", [seeded.serviceId]);
  const [location] = await sql.query<{ id: number }>(
    `insert into locations (newsroom_id, hsds_id, organization_id, city)
     values ($1, 'loc-scan', $2, 'Longmont') returning id`,
    [newsroomId, seeded.organizationId],
  );
  const [schedule] = await sql.query<{ id: number }>(
    `insert into schedules (newsroom_id, hsds_id, location_id, days)
     values ($1, 'sch-loc', $2, 'Tuesday') returning id`,
    [newsroomId, location!.id],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, schedule_id)
     values ($1, 'sal-scan', $2, $3, $4)`,
    [newsroomId, seeded.serviceId, location!.id, schedule!.id],
  );

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [
      change({
        entity_type: "schedule",
        entity_hsds_id: "sch-loc",
        field_name: "days",
        before_value: "Tuesday",
        after_value: "Wednesday",
        change_kind: "hours_change",
      }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "A"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, published: 1, created: 0, crisis: 1 });
});

test("an HSDS id repeated across directories binds within the change's own directory", async () => {
  const sql = await getSql();
  const newsroomId = 9308;
  const seeded = await seedNewsroom(newsroomId);
  await sql.query(
    `insert into resource_sources (newsroom_id, source_id, registry_role, directory_name)
     values ($1, $2, 'directory', 'Directory A')`,
    [newsroomId, seeded.sourceId],
  );
  const [serviceA] = await sql.query<{ id: number }>(
    `insert into services (newsroom_id, hsds_id, directory_name, organization_id, name)
     values ($1, 'shared-1', 'Directory A', $2, 'Pantry A') returning id`,
    [newsroomId, seeded.organizationId],
  );
  await sql.query(
    `insert into services (newsroom_id, hsds_id, directory_name, organization_id, name)
     values ($1, 'shared-1', 'Directory B', $2, 'Pantry B')`,
    [newsroomId, seeded.organizationId],
  );

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [change({ entity_hsds_id: "shared-1", entity_name: "" })],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.equal(counts.stored, 1);

  const [row] = await sql.query<{ entity_id: number | null }>(
    "select entity_id from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(row!.entity_id), Number(serviceA!.id));
});

test("an ambiguous name match is left unresolved instead of picking or duplicating a row", async () => {
  const sql = await getSql();
  const newsroomId = 9309;
  const seeded = await seedNewsroom(newsroomId);
  await sql.query(
    `insert into resource_sources (newsroom_id, source_id, registry_role, directory_name)
     values ($1, $2, 'directory', 'Directory A')`,
    [newsroomId, seeded.sourceId],
  );
  for (const hsdsId of ["amb-1", "amb-2"]) {
    await sql.query(
      `insert into services (newsroom_id, hsds_id, directory_name, organization_id, name)
       values ($1, $2, 'Directory A', $3, 'Ambiguous Pantry')`,
      [newsroomId, hsdsId, seeded.organizationId],
    );
  }

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    userId: USER,
    changes: [change({ entity_type: "service", entity_hsds_id: "", entity_name: "Ambiguous Pantry" })],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.equal(counts.created, 0, "no duplicate is created for an ambiguous name");

  const [row] = await sql.query<{ entity_id: number | null; review_state: string }>(
    "select entity_id, review_state from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(row!.entity_id, null);
  assert.equal(row!.review_state, "pending");
});
