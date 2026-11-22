import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  LONGMONT_DIRECTORY_SEED_NAME,
  importRegistryDirectorySeedIn,
} from "./directory-seed.server.ts";

await applyMigrationsToTestPglite();

const sample = readFileSync(new URL("./__fixtures__/sample-bundle.json", import.meta.url), "utf8");

test("a missing seed file does nothing and invents no placeholder", async () => {
  const sql = await getSql();
  const result = await importRegistryDirectorySeedIn(sql, 9701, "seed-owner", null);
  assert.deepEqual(result, { present: false, inserted: 0, published: 0, problems: [] });
});

test("the seed imports through the HSDS importer and publishes its services, once", async () => {
  const sql = await getSql();
  const newsroomId = 9702;

  const first = await importRegistryDirectorySeedIn(sql, newsroomId, "seed-owner", sample);
  assert.equal(first.present, true);
  assert.ok(first.inserted > 0, "the bundle's rows were inserted");
  assert.ok(first.published > 0, "its services were published");

  const [services] = await sql.query<{ total: string; unpublished: string }>(
    `select count(*)::text as total,
            count(*) filter (where published = false)::text as unpublished
       from services where newsroom_id = $1 and directory_name = $2`,
    [newsroomId, LONGMONT_DIRECTORY_SEED_NAME],
  );
  assert.ok(Number(services!.total) > 0);
  assert.equal(Number(services!.unpublished), 0, "every seeded service is live");

  const second = await importRegistryDirectorySeedIn(sql, newsroomId, "seed-owner", sample);
  assert.equal(second.inserted, 0, "a second run adds no row");
  assert.equal(second.published, 0, "and publishes nothing again");

  const [count] = await sql.query<{ total: string }>(
    "select count(*)::text as total from services where newsroom_id = $1 and directory_name = $2",
    [newsroomId, LONGMONT_DIRECTORY_SEED_NAME],
  );
  assert.equal(Number(count!.total), Number(services!.total));
});

test("a seed file that is not a valid HSDS bundle is reported, not imported", async () => {
  const sql = await getSql();
  const result = await importRegistryDirectorySeedIn(sql, 9703, "seed-owner", "{ not json");
  assert.equal(result.present, true);
  assert.equal(result.inserted, 0);
  assert.ok(result.problems.length > 0);
});
