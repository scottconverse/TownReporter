import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { claimFirstOwner, ForbiddenError, requireEditor } from "../membership.ts";
import {
  clearSetupCodeOverrideForTests,
  forceSetupCodeSatisfiedForTests,
} from "../setup-code.server.ts";
import type { HsdsBundle } from "./hsds-types.ts";
import { importHsdsBundle } from "./hsds-import.server.ts";
import { exportDirectoryFileIn, runHsdsImportIn } from "./registry-desk-write.server.ts";

// Phase 4, job C: the desk's directory file. The file is the HSDS bundle the
// importer reads, without the rows an editor removed.

await applyMigrationsToTestPglite();
before(() => forceSetupCodeSatisfiedForTests());
after(() => clearSetupCodeOverrideForTests());

const sample = JSON.parse(
  readFileSync(new URL("./__fixtures__/sample-bundle.json", import.meta.url), "utf8"),
) as HsdsBundle;
const DIRECTORY = "example-hsds-directory";

const TABLES = [
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
] as const;
const REMOVABLE = [
  "contacts",
  "service_at_locations",
  "schedules",
  "eligibilities",
  "required_documents",
  "languages",
  "accessibilities",
] as const;

async function importInto(newsroomId: number) {
  await importHsdsBundle(structuredClone(sample), { newsroomId, directoryName: DIRECTORY });
}

/** Row counts per table; `live` leaves out removed rows. */
async function counts(newsroomId: number, live = false): Promise<Record<string, number>> {
  const sql = await getSql();
  const out: Record<string, number> = {};
  for (const table of [...TABLES, "resource_changes"]) {
    const extra =
      live && (REMOVABLE as readonly string[]).includes(table) ? " and removed_at is null" : "";
    const rows = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1${extra}`,
      [newsroomId],
    );
    out[table] = Number(rows[0]!.count);
  }
  return out;
}

async function exportBundle(
  newsroomId: number,
): Promise<{ json: string; bundle: HsdsBundle; fileName: string }> {
  const sql = await getSql();
  const result = await exportDirectoryFileIn(
    sql,
    newsroomId,
    DIRECTORY,
    new Date("2026-11-18T12:00:00Z"),
  );
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return {
    json: result.json,
    bundle: JSON.parse(result.json) as HsdsBundle,
    fileName: result.fileName,
  };
}

/** Every id in a bundle, found by walking the bundle's own nesting. */
function ids(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => ids(v, out));
  else if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.id === "string") out.add(row.id);
    Object.values(row).forEach((v) => ids(v, out));
  }
  return out;
}

test("the export leaves out a removed row in every table an editor can remove from", async () => {
  const sql = await getSql();
  const newsroomId = 9801;
  await importInto(newsroomId);
  const first = await exportBundle(newsroomId);
  const firstIds = ids(first.bundle);

  const removedIds: string[] = [];
  for (const table of REMOVABLE) {
    const [row] = await sql.query<{ id: number; hsds_id: string }>(
      `select id, hsds_id from ${table} where newsroom_id = $1 order by id limit 1`,
      [newsroomId],
    );
    assert.ok(row, `the fixture has a ${table} row`);
    await sql.query(
      `update ${table} set removed_at = now(), removed_by = 'tester' where id = $1`,
      [row.id],
    );
    removedIds.push(row.hsds_id);
    assert.ok(firstIds.has(row.hsds_id), `${row.hsds_id} was in the export before removal`);
  }

  const second = await exportBundle(newsroomId);
  const secondIds = ids(second.bundle);
  for (const hsdsId of removedIds) {
    assert.equal(secondIds.has(hsdsId), false, `${hsdsId} is removed and must not be exported`);
  }
});

test("the export leaves out a service's removed link to a place and keeps the service", async () => {
  const sql = await getSql();
  const newsroomId = 9802;
  await importInto(newsroomId);
  const [link] = await sql.query<{ id: number; hsds_id: string; service_id: number }>(
    "select id, hsds_id, service_id from service_at_locations where newsroom_id = $1 order by id limit 1",
    [newsroomId],
  );
  const [service] = await sql.query<{ hsds_id: string }>(
    "select hsds_id from services where id = $1",
    [link!.service_id],
  );
  await sql.query("update service_at_locations set removed_at = now() where id = $1", [link!.id]);

  const { bundle } = await exportBundle(newsroomId);
  const found = ids(bundle);
  assert.equal(found.has(link!.hsds_id), false);
  assert.equal(found.has(service!.hsds_id), true);
});

test("an export imported back into the same newsroom and directory adds nothing", async () => {
  const sql = await getSql();
  const newsroomId = 9803;
  await importInto(newsroomId);
  // An editor removed one contact; the file leaves it out and the import must not mind.
  await sql.query(
    `update contacts set removed_at = now()
      where id = (select id from contacts where newsroom_id = $1 order by id limit 1)`,
    [newsroomId],
  );
  const beforeCounts = await counts(newsroomId);
  const { json } = await exportBundle(newsroomId);

  const result = await runHsdsImportIn(sql, newsroomId, { json, directoryName: DIRECTORY }, "tester");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.summary.conflicts, []);
  for (const [table, c] of Object.entries(result.summary.tables)) {
    assert.equal(c.inserted, 0, `${table} inserted`);
    assert.equal(c.changed, 0, `${table} changed`);
  }
  assert.deepEqual(await counts(newsroomId), beforeCounts);
  assert.equal(beforeCounts.resource_changes, 0);
});

test("an export imported into an empty newsroom keeps every field the importer needs", async () => {
  const source = 9804;
  const target = 9805;
  await importInto(source);
  const sql = await getSql();
  await sql.query(
    `update eligibilities set removed_at = now()
      where id = (select id from eligibilities where newsroom_id = $1 order by id limit 1)`,
    [source],
  );
  const { json } = await exportBundle(source);

  const result = await runHsdsImportIn(sql, target, { json, directoryName: DIRECTORY }, "tester");
  assert.equal(result.ok, true, result.ok ? "" : result.problems.join("; "));
  assert.deepEqual(await counts(target), { ...(await counts(source, true)), resource_changes: 0 });

  const orphans = await sql.query<{ count: string }>(
    `select count(*)::text as count from required_documents
      where newsroom_id = $1 and (service_id is null or document is null)`,
    [target],
  );
  assert.equal(Number(orphans[0]!.count), 0);
});

test("the file name carries the directory and the date", async () => {
  await importInto(9806);
  const { fileName } = await exportBundle(9806);
  assert.equal(fileName, "directory-example-hsds-directory-2026-11-18.json");
});

test("an editor of another newsroom gets nothing from this newsroom's directory", async () => {
  const sql = await getSql();
  await importInto(9807);
  const refused = await exportDirectoryFileIn(sql, 9808, DIRECTORY);
  assert.equal(refused.ok, false);
  const unknown = await exportDirectoryFileIn(sql, 9807, "no-such-directory");
  assert.equal(unknown.ok, false);
});

test("someone who is not an editor is refused by the desk gate the export sits behind", async () => {
  const owner = await claimFirstOwner("export-owner");
  assert.ok(owner, "the first user claims the desk");
  await assert.rejects(() => requireEditor("export-stranger"), ForbiddenError);
});
