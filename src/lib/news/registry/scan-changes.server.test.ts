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
