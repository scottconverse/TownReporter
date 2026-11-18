import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql, withTransaction } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { bundleToRows, REGISTRY_TABLE_NAMES, rowsToBundle } from "./hsds-map.ts";
import type { HsdsBundle } from "./hsds-types.ts";
import { importHsdsBundle, readRegistryBundle } from "./hsds-import.server.ts";
import { publishRegistryEntryIn } from "./registry-desk-write.server.ts";

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
  await importHsdsBundle(sampleCopy(), {
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
  const first = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const second = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });

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
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  const changed = sampleCopy();
  changed.organizations[0]!.name = "St. Vrain Community Food Pantry";
  const result = await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY });

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
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });

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
    importHsdsBundle(broken, { newsroomId, directoryName: "broken-directory" }),
  );

  for (const table of ["organizations", "services", "service_at_locations", "resource_imports"]) {
    const rows = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1`,
      [newsroomId],
    );
    assert.equal(Number(rows[0]!.count), 0, `${table} kept a row from a failed import`);
  }
});

test("a failed import inside a caller's transaction joins it and rolls back with it", async () => {
  const sql = await getSql();
  const newsroomId = 9106;
  const broken = sampleCopy();
  broken.organizations[0]!.services![0]!.service_at_locations![0]!.location_id = "loc-missing";

  await assert.rejects(() =>
    withTransaction((tx) =>
      importHsdsBundle(broken, { newsroomId, directoryName: "broken-in-tx", tx }),
    ),
  );

  const rows = await sql.query<{ count: string }>(
    "select count(*)::text as count from organizations where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(rows[0]!.count), 0);
});

test("an import into newsroom 2 writes the source and the capture into newsroom 2", async () => {
  const sql = await getSql();
  const newsroomId = 9107;
  const result = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  const [source] = await sql.query<{ newsroom_id: number }>(
    "select newsroom_id from sources where id = $1",
    [result.sourceId],
  );
  assert.equal(Number(source!.newsroom_id), newsroomId);

  const [snapshot] = await sql.query<{ newsroom_id: number }>(
    "select newsroom_id from snapshots where id = $1",
    [result.snapshotId],
  );
  assert.equal(Number(snapshot!.newsroom_id), newsroomId);
});

test("deleting a taxonomy clears the child and service links and keeps their newsroom", async () => {
  const sql = await getSql();
  const newsroomId = 9108;

  const [org] = await sql.query<{ id: number }>(
    "insert into organizations (newsroom_id, hsds_id, name) values ($1,'org-del','Delete fixture') returning id",
    [newsroomId],
  );
  const [parent] = await sql.query<{ id: number }>(
    "insert into taxonomies (newsroom_id, hsds_id, name) values ($1,'tax-parent','Parent') returning id",
    [newsroomId],
  );
  const [child] = await sql.query<{ id: number }>(
    "insert into taxonomies (newsroom_id, hsds_id, name, parent_id) values ($1,'tax-child','Child',$2) returning id",
    [newsroomId, parent!.id],
  );
  const [service] = await sql.query<{ id: number }>(
    "insert into services (newsroom_id, hsds_id, organization_id, name, taxonomy_id) values ($1,'svc-del',$2,'Linked',$3) returning id",
    [newsroomId, org!.id, parent!.id],
  );

  // A composite FK with a bare `on delete set null` would try to null
  // newsroom_id too and fail here.
  await sql.query("delete from taxonomies where id = $1", [parent!.id]);

  const [savedChild] = await sql.query<{ parent_id: number | null; newsroom_id: number }>(
    "select parent_id, newsroom_id from taxonomies where id = $1",
    [child!.id],
  );
  assert.equal(savedChild!.parent_id, null);
  assert.equal(Number(savedChild!.newsroom_id), newsroomId);

  const [savedService] = await sql.query<{ taxonomy_id: number | null; newsroom_id: number }>(
    "select taxonomy_id, newsroom_id from services where id = $1",
    [service!.id],
  );
  assert.equal(savedService!.taxonomy_id, null);
  assert.equal(Number(savedService!.newsroom_id), newsroomId);
});

test("deleting a schedule clears the service_at_location link and keeps its newsroom", async () => {
  const sql = await getSql();
  const newsroomId = 9109;

  const [org] = await sql.query<{ id: number }>(
    "insert into organizations (newsroom_id, hsds_id, name) values ($1,'org-sched','Schedule fixture') returning id",
    [newsroomId],
  );
  const [service] = await sql.query<{ id: number }>(
    "insert into services (newsroom_id, hsds_id, organization_id, name) values ($1,'svc-sched',$2,'Scheduled') returning id",
    [newsroomId, org!.id],
  );
  const [location] = await sql.query<{ id: number }>(
    "insert into locations (newsroom_id, hsds_id, organization_id, name) values ($1,'loc-sched',$2,'Site') returning id",
    [newsroomId, org!.id],
  );
  const [schedule] = await sql.query<{ id: number }>(
    "insert into schedules (newsroom_id, hsds_id, service_id) values ($1,'sched-del',$2) returning id",
    [newsroomId, service!.id],
  );
  const [sal] = await sql.query<{ id: number }>(
    "insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, schedule_id) values ($1,'sal-del',$2,$3,$4) returning id",
    [newsroomId, service!.id, location!.id, schedule!.id],
  );

  await sql.query("delete from schedules where id = $1", [schedule!.id]);

  const [saved] = await sql.query<{ schedule_id: number | null; newsroom_id: number }>(
    "select schedule_id, newsroom_id from service_at_locations where id = $1",
    [sal!.id],
  );
  assert.equal(saved!.schedule_id, null);
  assert.equal(Number(saved!.newsroom_id), newsroomId);
});

test("a bundle longer than an excerpt cap keeps all of it, and a conflict on its last record stays checkable", async () => {
  const sql = await getSql();
  const newsroomId = 9109;
  const directory = "large-hsds-directory";
  const bundle = sampleCopy();
  // Push the bundle well past the old 2000-character truncation point.
  bundle.organizations[0]!.description = "x".repeat(5000);

  const payloadLength = JSON.stringify(bundle).length;
  assert.ok(payloadLength > 2000, "the fixture is longer than the old cap");

  const first = await importHsdsBundle(bundle, { newsroomId, directoryName: directory });

  // Change the last organization, whose record sits well past 2000 characters.
  const changed = structuredClone(bundle);
  const lastOrg = changed.organizations[changed.organizations.length - 1]!;
  lastOrg.name = "Changed Last Organization";
  const second = await importHsdsBundle(changed, { newsroomId, directoryName: directory });

  const conflict = second.conflicts.find((row) => row.after_value === "Changed Last Organization");
  assert.ok(conflict, "the last record's change is a conflict");

  const [importRow] = await sql.query<{ payload: string }>(
    "select payload from resource_imports where id = $1",
    [second.importId],
  );
  assert.equal(importRow!.payload, JSON.stringify(changed), "the full bundle is stored");
  assert.notEqual(first.importId, second.importId);

  const [evidence] = await sql.query<{ excerpt: string }>(
    `select s.excerpt
       from resource_changes rc
       join snapshots s on s.id = rc.evidence_capture_id
      where rc.newsroom_id = $1 and rc.after_value = 'Changed Last Organization'`,
    [newsroomId],
  );
  assert.ok(evidence, "the conflict points at a retained capture");
  assert.ok(
    evidence!.excerpt.includes(JSON.stringify(lastOrg)),
    "the evidence holds the conflicted record",
  );
});

const ALL_TABLES = [
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
  "sources",
  "snapshots",
  "resource_imports",
  "resource_changes",
];

async function rowCounts(newsroomId: number): Promise<Record<string, number>> {
  const sql = await getSql();
  const counts: Record<string, number> = {};
  for (const table of ALL_TABLES) {
    const rows = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1`,
      [newsroomId],
    );
    counts[table] = Number(rows[0]!.count);
  }
  return counts;
}

function withoutStatuses(bundle: HsdsBundle): HsdsBundle {
  const copy = structuredClone(bundle);
  for (const org of copy.organizations) {
    delete org.status;
    for (const service of org.services ?? []) delete service.status;
    for (const location of org.locations ?? []) delete location.status;
  }
  return copy;
}

test("first import inserts every row unpublished and counts them per table", async () => {
  const sql = await getSql();
  const newsroomId = 9701;
  const result = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  let total = 0;
  for (const [table, counts] of Object.entries(result.tables)) {
    assert.equal(counts.unchanged, 0, `${table} unchanged on first import`);
    assert.equal(counts.changed, 0, `${table} changed on first import`);
    assert.equal(counts.inserted, result.recordCounts[table as keyof typeof result.recordCounts]);
    total += counts.inserted;
  }
  assert.ok(total > 0);
  assert.equal(result.tables.organizations.inserted, 2);
  assert.equal(result.tables.services.inserted, 3);
  assert.equal(result.dryRun, false);

  for (const table of Object.keys(result.tables)) {
    const unpublished = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1 and published = false`,
      [newsroomId],
    );
    const all = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1`,
      [newsroomId],
    );
    assert.equal(unpublished[0]!.count, all[0]!.count, `${table} rows are all unpublished`);
  }
});

test("a repeat import reports unchanged rows and adds no change, on every run", async () => {
  const newsroomId = 9702;
  const first = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  for (let run = 0; run < 2; run += 1) {
    const repeat = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
    for (const [table, counts] of Object.entries(repeat.tables)) {
      const firstCounts = first.tables[table as keyof typeof first.tables];
      assert.equal(counts.inserted, 0, `${table} inserted on repeat ${run}`);
      assert.equal(counts.changed, 0, `${table} changed on repeat ${run}`);
      assert.equal(counts.unchanged, firstCounts.inserted, `${table} unchanged on repeat ${run}`);
    }
    assert.deepEqual(repeat.conflicts, []);
  }
  assert.equal((await rowCounts(newsroomId)).resource_changes, 0);
});

test("importing a changed file twice proposes the change once", async () => {
  const sql = await getSql();
  const newsroomId = 9703;
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const changed = sampleCopy();
  changed.organizations[0]!.name = "St. Vrain Community Food Pantry";

  const second = await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY });
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.tables.organizations.changed, 1);
  const third = await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY });
  assert.equal(third.conflicts.length, 0, "the same proposal is not repeated");
  assert.equal(third.tables.organizations.changed, 0);
  assert.equal(third.tables.organizations.alreadyPending, 1);

  assert.equal((await rowCounts(newsroomId)).resource_changes, 1);
  const stored = await sql.query<{ name: string }>(
    "select name from organizations where newsroom_id = $1 and hsds_id = $2",
    [newsroomId, "org-st-vrain-pantry"],
  );
  assert.equal(stored[0]!.name, "St. Vrain Community Pantry");

  // A different new value is a different proposal.
  changed.organizations[0]!.name = "St. Vrain Pantry Network";
  const fourth = await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY });
  assert.equal(fourth.conflicts.length, 1);
  assert.equal((await rowCounts(newsroomId)).resource_changes, 2);
});

async function publishFirstService(newsroomId: number): Promise<void> {
  const sql = await getSql();
  const [service] = await sql.query<{ id: number }>(
    "select id from services where newsroom_id = $1 and directory_name = $2 order by id limit 1",
    [newsroomId, DIRECTORY],
  );
  await publishRegistryEntryIn(sql, newsroomId, Number(service!.id), "editor-1");
}

test("re-importing an unchanged file after Publish makes no status conflict", async () => {
  const sql = await getSql();
  const newsroomId = 9704;
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  await publishFirstService(newsroomId);
  const active = await sql.query<{ count: string }>(
    "select count(*)::text as count from services where newsroom_id = $1 and status = 'active'",
    [newsroomId],
  );
  assert.equal(Number(active[0]!.count), 1, "publish made one service active");

  const repeat = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  assert.deepEqual(
    repeat.conflicts.filter((conflict) => conflict.field_name === "status"),
    [],
  );
  assert.deepEqual(repeat.conflicts, []);
  assert.equal((await rowCounts(newsroomId)).resource_changes, 0);
});

test("a file with no status keeps the stored status; new rows still start unverified", async () => {
  const sql = await getSql();
  const newsroomId = 9705;
  const bare = withoutStatuses(sampleCopy());
  await importHsdsBundle(bare, { newsroomId, directoryName: DIRECTORY });
  const statuses = await sql.query<{ status: string }>(
    "select distinct status from services where newsroom_id = $1",
    [newsroomId],
  );
  assert.deepEqual(statuses.map((row) => row.status), ["unverified"]);

  await publishFirstService(newsroomId);
  const repeat = await importHsdsBundle(bare, { newsroomId, directoryName: DIRECTORY });
  assert.deepEqual(repeat.conflicts, []);
});

test("a file that states a real status different from the stored one still proposes it", async () => {
  const newsroomId = 9706;
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  await publishFirstService(newsroomId);

  const closed = sampleCopy();
  for (const org of closed.organizations) {
    for (const service of org.services ?? []) service.status = "inactive";
  }
  const result = await importHsdsBundle(closed, { newsroomId, directoryName: DIRECTORY });
  const statusConflicts = result.conflicts.filter((conflict) => conflict.field_name === "status");
  assert.equal(statusConflicts.length, 3);
  assert.ok(statusConflicts.every((conflict) => conflict.after_value === "inactive"));
});

test("one changed value is exactly one proposal and the stored value stays", async () => {
  const sql = await getSql();
  const newsroomId = 9707;
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const changed = sampleCopy();
  changed.organizations[0]!.services![0]!.fees = "Five dollars";
  const result = await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY });
  assert.equal(result.conflicts.length, 1);
  const totals = Object.values(result.tables).reduce((sum, counts) => sum + counts.changed, 0);
  assert.equal(totals, 1);
  assert.equal((await rowCounts(newsroomId)).resource_changes, 1);
  const stored = await sql.query<{ fees: string | null }>(
    "select fees from services where newsroom_id = $1 and hsds_id = $2",
    [newsroomId, changed.organizations[0]!.services![0]!.id],
  );
  assert.notEqual(stored[0]!.fees, "Five dollars");
});

test("a dry run leaves every table unchanged, for a first, a repeat and a changed file", async () => {
  const newsroomId = 9708;
  const empty = await rowCounts(newsroomId);
  const preview = await importHsdsBundle(sampleCopy(), {
    newsroomId,
    directoryName: DIRECTORY,
    dryRun: true,
  });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.tables.organizations.inserted, 2);
  assert.deepEqual(await rowCounts(newsroomId), empty);

  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const afterImport = await rowCounts(newsroomId);
  assert.ok(afterImport.organizations > 0);

  const repeat = await importHsdsBundle(sampleCopy(), {
    newsroomId,
    directoryName: DIRECTORY,
    dryRun: true,
  });
  assert.equal(repeat.tables.organizations.unchanged, 2);
  assert.deepEqual(await rowCounts(newsroomId), afterImport);

  const changed = sampleCopy();
  changed.organizations[0]!.name = "Renamed in preview";
  const diff = await importHsdsBundle(changed, { newsroomId, directoryName: DIRECTORY, dryRun: true });
  assert.equal(diff.conflicts.length, 1);
  assert.deepEqual(await rowCounts(newsroomId), afterImport);
});

test("an import that fails at insert time part-way leaves no partial writes", async () => {
  const newsroomId = 9709;
  const before = await rowCounts(newsroomId);
  const broken = sampleCopy();
  // Passes the mapper, fails the status check constraint after earlier tables are written.
  (broken.organizations[1] as { status?: string }).status = "bogus";
  await assert.rejects(() =>
    importHsdsBundle(broken, { newsroomId, directoryName: "half-written" }),
  );
  assert.deepEqual(await rowCounts(newsroomId), before);
});

test("filling a null taxonomy parent from the file counts the row as changed, and a dry run keeps it null", async () => {
  const sql = await getSql();
  const newsroomId = 9710;
  // The first import names no parents, so every taxonomy starts with a null parent.
  const flat = sampleCopy();
  for (const taxonomy of flat.taxonomies ?? []) delete taxonomy.parent_id;
  await importHsdsBundle(flat, { newsroomId, directoryName: DIRECTORY });

  const parentOfPantry = async (): Promise<number | null> => {
    const rows = await sql.query<{ parent_id: number | null }>(
      "select parent_id from taxonomies where newsroom_id = $1 and hsds_id = $2",
      [newsroomId, "tax-pantry"],
    );
    return rows[0]!.parent_id;
  };
  assert.equal(await parentOfPantry(), null);

  const dry = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY, dryRun: true });
  assert.deepEqual(dry.tables.taxonomies, { inserted: 0, unchanged: 1, changed: 1, alreadyPending: 0 });
  assert.equal(await parentOfPantry(), null, "a dry run leaves the parent null");

  const real = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  assert.deepEqual(real.tables.taxonomies, { inserted: 0, unchanged: 1, changed: 1, alreadyPending: 0 });
  assert.deepEqual(real.conflicts, [], "a null parent filled from the file is not a proposal");
  assert.notEqual(await parentOfPantry(), null, "the real run fills the parent");

  const repeat = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  assert.deepEqual(repeat.tables.taxonomies, { inserted: 0, unchanged: 2, changed: 0, alreadyPending: 0 });
});

test("the stored import keeps its top-level counts and adds the per-table totals under byTable", async () => {
  const sql = await getSql();
  const newsroomId = 9711;
  const result = await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });
  const [stored] = await sql.query<{ record_counts: Record<string, unknown> }>(
    "select record_counts from resource_imports where id = $1",
    [result.importId],
  );
  const counts = stored!.record_counts;
  for (const name of REGISTRY_TABLE_NAMES) {
    assert.equal(counts[name], result.recordCounts[name], `${name} top-level count`);
  }
  assert.deepEqual(counts.byTable, result.tables);
});

test("a value that differs from a pending proposal is a new proposal, and the older one stays pending", async () => {
  const sql = await getSql();
  const newsroomId = 9712;
  await importHsdsBundle(sampleCopy(), { newsroomId, directoryName: DIRECTORY });

  const first = sampleCopy();
  first.organizations[0]!.name = "Proposed name A";
  const a = await importHsdsBundle(first, { newsroomId, directoryName: DIRECTORY });
  assert.equal(a.conflicts.length, 1);

  const second = sampleCopy();
  second.organizations[0]!.name = "Proposed name B";
  const b = await importHsdsBundle(second, { newsroomId, directoryName: DIRECTORY });
  assert.equal(b.conflicts.length, 1, "a different value is not deduped against the pending one");
  assert.equal(b.conflicts[0]!.after_value, "Proposed name B");

  const pending = await sql.query<{ after_value: string }>(
    `select after_value from resource_changes
      where newsroom_id = $1 and entity_type = 'organization' and field_name = 'name'
        and review_state = 'pending' order by id`,
    [newsroomId],
  );
  assert.deepEqual(pending.map((row) => row.after_value), ["Proposed name A", "Proposed name B"]);
});
