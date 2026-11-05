import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { bundleToRows, rowsToBundle } from "./hsds-map.ts";
import type { HsdsBundle } from "./hsds-types.ts";
import { importHsdsBundle, readRegistryBundle } from "./hsds-import.server.ts";

// NAV-P1: these tests want the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner does not, so the fixture asks for it itself through the shared
// applier, which does nothing when the ledger is already full.
await applyMigrationsToTestPglite();

const sample = JSON.parse(
  readFileSync(new URL("./__fixtures__/sample-bundle.json", import.meta.url), "utf8"),
) as HsdsBundle;

function sampleCopy(): HsdsBundle {
  return structuredClone(sample);
}

const DIRECTORY = "example-hsds-directory";

test("mapping a bundle to rows and back loses no field and renames none", () => {
  assert.deepEqual(rowsToBundle(bundleToRows(sampleCopy())), sample);
});

test("an imported bundle round-trips through the database unchanged", async () => {
  const sql = await getSql();
  const newsroomId = 9101;
  await importHsdsBundle(sql, sampleCopy(), {
    newsroomId,
    directoryName: DIRECTORY,
    sourceUrl: "https://example.org/hsds.json",
  });

  const roundTripped = await readRegistryBundle(sql, newsroomId, DIRECTORY);
  assert.deepEqual(roundTripped, sample);
});

test("importing the same directory twice updates rows instead of duplicating them", async () => {
  const sql = await getSql();
  const newsroomId = 9102;
  const first = await importHsdsBundle(sql, sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const second = await importHsdsBundle(sql, sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  assert.deepEqual(second.recordCounts, Object.fromEntries(
    Object.keys(first.recordCounts).map((name) => [name, 0]),
  ));
  assert.deepEqual(second.conflicts, []);

  const expectedCounts: Record<string, number> = {
    organizations: 2,
    services: 3,
    locations: 2,
    contacts: 3,
  };
  for (const [table, expected] of Object.entries(expectedCounts)) {
    const rows = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1 and directory_name = $2`,
      [newsroomId, DIRECTORY],
    );
    assert.equal(Number(rows[0]!.count), expected, `${table} row count after re-import`);
  }

  const changes = await sql.query<{ count: string }>(
    "select count(*)::text as count from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(changes[0]!.count), 0);
});

test("a changed field makes one pending change and leaves the old value in place", async () => {
  const sql = await getSql();
  const newsroomId = 9103;
  await importHsdsBundle(sql, sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  const changed = sampleCopy();
  changed.organizations[0]!.name = "St. Vrain Community Food Pantry";
  const result = await importHsdsBundle(sql, changed, { newsroomId, directoryName: DIRECTORY });

  assert.equal(result.conflicts.length, 1);
  const conflict = result.conflicts[0]!;
  assert.equal(conflict.entity_type, "organization");
  assert.equal(conflict.field_name, "name");
  assert.equal(conflict.before_value, "St. Vrain Community Pantry");
  assert.equal(conflict.after_value, "St. Vrain Community Food Pantry");

  const stored = await sql.query<{ name: string }>(
    "select name from organizations where newsroom_id = $1 and hsds_id = $2",
    [newsroomId, "org-st-vrain-pantry"],
  );
  assert.equal(stored[0]!.name, "St. Vrain Community Pantry");

  const changes = await sql.query<{ review_state: string; evidence_capture_id: number | null }>(
    "select review_state, evidence_capture_id from resource_changes where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.review_state, "pending");
  assert.ok(changes[0]!.evidence_capture_id, "evidence capture is required and present");
});

test("every imported row is unpublished and unverified", async () => {
  const sql = await getSql();
  const newsroomId = 9104;
  await importHsdsBundle(sql, sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  for (const table of [
    "taxonomies",
    "organizations",
    "services",
    "locations",
    "schedules",
    "contacts",
    "service_at_locations",
    "eligibilities",
    "required_documents",
    "languages",
    "accessibilities",
  ]) {
    const published = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1 and published = true`,
      [newsroomId],
    );
    assert.equal(Number(published[0]!.count), 0, `${table} has a published row after import`);
  }

  const statuses = await sql.query<{ status: string }>(
    "select distinct status from organizations where newsroom_id = $1",
    [newsroomId],
  );
  assert.deepEqual(
    statuses.map((row) => row.status),
    ["unverified"],
  );

  const methods = await sql.query<{ verification_method: string }>(
    "select distinct verification_method from organizations where newsroom_id = $1",
    [newsroomId],
  );
  assert.deepEqual(
    methods.map((row) => row.verification_method),
    ["imported"],
  );
});

test("a failed import writes nothing", async () => {
  const sql = await getSql();
  const newsroomId = 9105;
  const broken = sampleCopy();
  // A schedule that names a service which does not exist cannot be linked.
  broken.organizations[0]!.services![0]!.service_at_locations![0]!.location_id = "loc-missing";

  await assert.rejects(() =>
    importHsdsBundle(sql, broken, { newsroomId, directoryName: "broken-directory" }),
  );

  for (const table of ["organizations", "services", "service_at_locations", "resource_imports"]) {
    const rows = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1`,
      [newsroomId],
    );
    assert.equal(Number(rows[0]!.count), 0, `${table} kept a row from a failed import`);
  }
});
