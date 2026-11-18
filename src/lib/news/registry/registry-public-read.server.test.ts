import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { publishRegistryEntryIn } from "./registry-desk-write.server.ts";
import { readPublicRegistry } from "./registry-public.server.ts";

await applyMigrationsToTestPglite();

async function seedPublished(newsroomId: number): Promise<number> {
  const sql = await getSql();
  const [org] = await sql.query<{ id: number }>(
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, 'org-read', 'Read Org', 'unverified', false) returning id`,
    [newsroomId],
  );
  const [service] = await sql.query<{ id: number }>(
    `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
     values ($1, 'svc-read', $2, 'Read pantry', 'unverified', false) returning id`,
    [newsroomId, org!.id],
  );
  await publishRegistryEntryIn(sql, newsroomId, Number(service!.id), "editor");
  return Number(service!.id);
}

test("a database read failure is 'unavailable', not an empty list, and the next good read returns the entries", async () => {
  const newsroomId = 9511;
  const serviceId = await seedPublished(newsroomId);

  const failing = await readPublicRegistry(
    async () => {
      throw new Error("database is down");
    },
    newsroomId,
    null,
  );
  assert.equal(failing.status, "unavailable");

  const failingQuery = await readPublicRegistry(
    async () => ({
      query: async () => {
        throw new Error("read failed");
      },
    }) as never,
    newsroomId,
    null,
  );
  assert.equal(failingQuery.status, "unavailable");

  const recovered = await readPublicRegistry(getSql, newsroomId, null);
  assert.equal(recovered.status, "ok");
  if (recovered.status !== "ok") return;
  assert.deepEqual(
    recovered.entries.map((e) => e.serviceId),
    [serviceId],
  );
  assert.equal(recovered.anyPublished, true);
});

test("nothing published and an empty category are told apart", async () => {
  const empty = await readPublicRegistry(getSql, 9512, null);
  assert.equal(empty.status, "ok");
  if (empty.status === "ok") {
    assert.equal(empty.entries.length, 0);
    assert.equal(empty.anyPublished, false);
  }

  await seedPublished(9513);
  const otherCategory = await readPublicRegistry(getSql, 9513, 999999);
  assert.equal(otherCategory.status, "ok");
  if (otherCategory.status === "ok") {
    assert.equal(otherCategory.entries.length, 0);
    assert.equal(otherCategory.anyPublished, true, "entries exist, just not in that category");
  }
});
