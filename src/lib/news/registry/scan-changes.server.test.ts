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
    changes: [change({ source_url: "https://never-fetched.test/page" })],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });

  assert.deepEqual(counts, { stored: 0, rejected: 1, needsEditor: 0 });
  const rows = await sql.query("select id from resource_changes where newsroom_id = $1", [newsroomId]);
  assert.equal(rows.length, 0);
  assert.match(registryChangeSentence(counts), /rejected for lack of a retained capture/);
});

test("a stored change binds the capture, the run and the source, and writes no registry field (guardrails 2 and 5)", async () => {
  const sql = await getSql();
  const newsroomId = 9302;
  const seeded = await seedNewsroom(newsroomId, "C");

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    changes: [change({ entity_hsds_id: "svc-scan", entity_name: "Weekly grocery pickup" })],
    ...maps(seeded.sourceId, seeded.snapshotId, "C"),
  });
  assert.deepEqual(counts, { stored: 1, rejected: 0, needsEditor: 0 });

  const [row] = await sql.query<{
    review_state: string;
    evidence_tier: string;
    entity_type: string;
    entity_id: number | null;
    scan_run_id: number;
    source_id: number;
    evidence_capture_id: number;
    lead_id: number | null;
  }>(
    `select review_state, evidence_tier, entity_type, entity_id, scan_run_id, source_id,
            evidence_capture_id, lead_id
       from resource_changes where newsroom_id = $1`,
    [newsroomId],
  );
  assert.equal(row!.review_state, "pending");
  assert.equal(row!.evidence_tier, "C");
  assert.equal(row!.entity_type, "service");
  assert.equal(Number(row!.entity_id), seeded.serviceId);
  assert.equal(Number(row!.scan_run_id), seeded.runId);
  assert.equal(Number(row!.source_id), seeded.sourceId);
  assert.equal(Number(row!.evidence_capture_id), seeded.snapshotId);
  assert.equal(row!.lead_id, null, "filing leads from changes is Phase 2");

  // Guardrail 2/5: nothing in the registry changed.
  const [service] = await sql.query<{ name: string; published: boolean }>(
    "select name, published from services where id = $1",
    [seeded.serviceId],
  );
  assert.deepEqual(service, { name: "Weekly grocery pickup", published: false });
});

test("a change matching no entity is a new-entity proposal and creates nothing (guardrail 3)", async () => {
  const sql = await getSql();
  const newsroomId = 9303;
  const seeded = await seedNewsroom(newsroomId);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    changes: [
      change({ entity_type: "organization", entity_name: "Brand New Mutual Aid", entity_hsds_id: "" }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "B"),
  });
  assert.equal(counts.stored, 1);

  const [row] = await sql.query<{ entity_id: number | null; review_state: string }>(
    "select entity_id, review_state from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(row!.entity_id, null);
  assert.equal(row!.review_state, "pending");

  const [orgCount] = await sql.query<{ count: string }>(
    "select count(*)::text as count from organizations where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(orgCount!.count), 1, "only the fixture organization exists");
  const [named] = await sql.query<{ count: string }>(
    "select count(*)::text as count from organizations where newsroom_id = $1 and name = 'Brand New Mutual Aid'",
    [newsroomId],
  );
  assert.equal(Number(named!.count), 0);
});

async function addSchedule(newsroomId: number, serviceId: number, hsdsId: string) {
  const sql = await getSql();
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, days, opens_at, closes_at)
     values ($1, $2, $3, 'Monday', '09:00', '11:00')`,
    [newsroomId, hsdsId, serviceId],
  );
}

test("a schedule change on a crisis service goes to the editor, and the same change on a normal service does not", async () => {
  const sql = await getSql();

  const crisisRoom = 9305;
  const crisis = await seedNewsroom(crisisRoom);
  await sql.query("update services set crisis = true where id = $1", [crisis.serviceId]);
  await addSchedule(crisisRoom, crisis.serviceId, "sch-crisis");
  const crisisCounts = await commitScanResourceChanges(sql, {
    newsroomId: crisisRoom,
    scanRunId: crisis.runId,
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
    ...maps(crisis.sourceId, crisis.snapshotId, "B"),
  });
  assert.deepEqual(crisisCounts, { stored: 1, rejected: 0, needsEditor: 1 });
  const [crisisRow] = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where newsroom_id = $1",
    [crisisRoom],
  );
  assert.equal(crisisRow!.review_state, "needs-editor");

  const normalRoom = 9306;
  const normal = await seedNewsroom(normalRoom);
  await addSchedule(normalRoom, normal.serviceId, "sch-normal");
  const normalCounts = await commitScanResourceChanges(sql, {
    newsroomId: normalRoom,
    scanRunId: normal.runId,
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
  assert.deepEqual(normalCounts, { stored: 1, rejected: 0, needsEditor: 0 });
  const [normalRow] = await sql.query<{ review_state: string }>(
    "select review_state from resource_changes where newsroom_id = $1",
    [normalRoom],
  );
  assert.equal(normalRow!.review_state, "pending");
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
  assert.deepEqual(counts, { stored: 1, rejected: 0, needsEditor: 1 });
});

test("a crisis-flagged service's change always goes to the editor (guardrail 4)", async () => {
  const sql = await getSql();
  const newsroomId = 9304;
  const seeded = await seedNewsroom(newsroomId);
  await sql.query("update services set crisis = true where id = $1", [seeded.serviceId]);

  const counts = await commitScanResourceChanges(sql, {
    newsroomId,
    scanRunId: seeded.runId,
    changes: [
      change({ entity_hsds_id: "svc-scan", model_confidence: 0.99, change_kind: "hours_change" }),
    ],
    ...maps(seeded.sourceId, seeded.snapshotId, "A"),
  });

  assert.deepEqual(counts, { stored: 1, rejected: 0, needsEditor: 1 });
  const [row] = await sql.query<{ review_state: string; evidence_tier: string }>(
    "select review_state, evidence_tier from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(row!.review_state, "needs-editor");
  assert.equal(row!.evidence_tier, "A");
});
