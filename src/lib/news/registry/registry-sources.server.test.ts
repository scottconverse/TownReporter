import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  isRegistrySource,
  listRegistrySources,
  markRegistrySource,
  registryRolesBySource,
} from "./registry-sources.server.ts";
import {
  ensureRegistryBackboneSources,
  isBackboneRegion,
  registryBackboneSources,
} from "../source-seeds.server.ts";

await applyMigrationsToTestPglite();

async function seedSource(userId: string, newsroomId: number, url: string, title = "Source") {
  const sql = await getSql();
  const [row] = await sql.query<{ id: number }>(
    `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
     values ($1, $2, $3, $4, 'news', 'A', 'accepted') returning id`,
    [userId, newsroomId, url, title],
  );
  return row!.id;
}

test("a source can be a news source and a registry source at the same time", async () => {
  const sql = await getSql();
  const newsroomId = 9201;
  const sourceId = await seedSource("registry-owner", newsroomId, "https://both.test/news");

  assert.equal(await isRegistrySource(sql, newsroomId, sourceId), false);
  assert.equal(
    await markRegistrySource(sql, { newsroomId, sourceId, registryRole: "directory" }),
    true,
  );
  assert.equal(await isRegistrySource(sql, newsroomId, sourceId), true);

  const [source] = await sql.query<{ kind: string; status: string }>(
    "select kind, status from sources where id = $1",
    [sourceId],
  );
  assert.deepEqual(source, { kind: "news", status: "accepted" }, "the news role is untouched");

  // The same call again is a no-op, not a duplicate.
  assert.equal(
    await markRegistrySource(sql, { newsroomId, sourceId, registryRole: "directory" }),
    false,
  );
});

test("a source can hold more than one registry role, and the scan reads them as a set", async () => {
  const sql = await getSql();
  const newsroomId = 9202;
  const sourceId = await seedSource("registry-owner", newsroomId, "https://roles.test/feed");

  await markRegistrySource(sql, { newsroomId, sourceId, registryRole: "organization" });
  await markRegistrySource(sql, { newsroomId, sourceId, registryRole: "service" });

  const roles = await registryRolesBySource(sql, newsroomId);
  assert.deepEqual([...(roles.get(sourceId) ?? [])].sort(), ["organization", "service"]);

  const listed = await listRegistrySources(sql, newsroomId);
  assert.equal(listed.length, 2);
  assert.ok(listed.every((row) => row.sourceId === sourceId && row.url === "https://roles.test/feed"));
});

test("registry roles are scoped to one newsroom", async () => {
  const sql = await getSql();
  const sourceId = await seedSource("registry-owner", 9203, "https://scoped.test/feed");
  await markRegistrySource(sql, { newsroomId: 9203, sourceId, registryRole: "directory" });

  assert.equal(await isRegistrySource(sql, 9204, sourceId), false);
  assert.deepEqual(await listRegistrySources(sql, 9204), []);
});

test("the spec 22 backbone is five directories with the intended tiers", () => {
  const sources = registryBackboneSources();
  assert.equal(sources.length, 5);
  const byHost = new Map(sources.map((s) => [new URL(s.url).hostname, s.tier]));
  assert.equal(byHost.get("bouldercounty.gov"), "A");
  assert.equal(byHost.get("longmontcolorado.gov"), "A");
  assert.equal(byHost.get("www.211colorado.org"), "B");
  assert.equal(byHost.get("www.bouldercountyhelp.org"), "B");
  assert.equal(byHost.get("www.ourcenter.org"), "B");
});

test("the backbone region is Longmont or Boulder County, Colorado", () => {
  assert.equal(isBackboneRegion({ city: "Longmont", state: "Colorado", county: null }), true);
  assert.equal(isBackboneRegion({ city: "  longmont ", state: " CO ", county: null }), true);
  assert.equal(isBackboneRegion({ city: "", state: "Colorado", county: "Boulder County" }), true);
  assert.equal(isBackboneRegion({ city: "", state: "co", county: " Boulder " }), true);
  assert.equal(isBackboneRegion({ city: "Riverbend", state: "Oregon", county: null }), false);
  assert.equal(isBackboneRegion({ city: "Longmont", state: "Wyoming", county: null }), false);
  assert.equal(isBackboneRegion({ city: "", state: "", county: null }), false);
  assert.equal(isBackboneRegion(null), false);
});

test("seeding the backbone twice adds nothing the second time", async () => {
  const sql = await getSql();
  const newsroomId = 9205;
  await sql.query(
    "insert into paper_settings (newsroom_id, city, state, onboarded) values ($1, 'Longmont', 'Colorado', true)",
    [newsroomId],
  );

  assert.equal(await ensureRegistryBackboneSources("seed-owner", newsroomId), 5);
  assert.equal(await ensureRegistryBackboneSources("seed-owner", newsroomId), 0);

  const [sourceCount] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(sourceCount!.count), 5);

  const [roleCount] = await sql.query<{ count: string }>(
    `select count(*)::text as count from resource_sources
      where newsroom_id = $1 and registry_role = 'directory'`,
    [newsroomId],
  );
  assert.equal(Number(roleCount!.count), 5);

  const [accepted] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = $1 and status = 'accepted'",
    [newsroomId],
  );
  assert.equal(Number(accepted!.count), 5);
});

test("the backbone is not seeded into a newsroom that was never onboarded", async () => {
  const sql = await getSql();
  const newsroomId = 9206;
  await sql.query("insert into paper_settings (newsroom_id, onboarded) values ($1, false)", [
    newsroomId,
  ]);

  assert.equal(await ensureRegistryBackboneSources("seed-owner", newsroomId), 0);
  assert.deepEqual(await listRegistrySources(sql, newsroomId), []);
});

test("a second editor's seed reuses the newsroom's rows, and a rejected one stays rejected", async () => {
  const sql = await getSql();
  const newsroomId = 9207;
  await sql.query(
    "insert into paper_settings (newsroom_id, city, state, onboarded) values ($1, 'Longmont', 'Colorado', true)",
    [newsroomId],
  );

  assert.equal(await ensureRegistryBackboneSources("first-editor", newsroomId), 5);
  assert.equal(await ensureRegistryBackboneSources("second-editor", newsroomId), 0);

  const [sourceCount] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = $1",
    [newsroomId],
  );
  assert.equal(Number(sourceCount!.count), 5, "one row per backbone URL, not one per editor");

  const rejectedUrl = registryBackboneSources()[0]!.url;
  await sql.query(
    "update sources set status = 'rejected' where newsroom_id = $1 and url = $2",
    [newsroomId, rejectedUrl],
  );

  assert.equal(await ensureRegistryBackboneSources("third-editor", newsroomId), 0);
  const rows = await sql.query<{ status: string; user_id: string }>(
    "select status, user_id from sources where newsroom_id = $1 and url = $2",
    [newsroomId, rejectedUrl],
  );
  assert.equal(rows.length, 1, "the rejected URL is not duplicated");
  assert.equal(rows[0]!.status, "rejected", "its status is not flipped back");
  assert.equal(rows[0]!.user_id, "first-editor");
});

test("the backbone seeds only into a Longmont / Boulder County paper", async () => {
  const sql = await getSql();
  await sql.query(
    `insert into paper_settings (newsroom_id, city, state, onboarded)
     values (9208, 'Riverbend', 'Oregon', true),
            (9209, 'Longmont', 'Colorado', true),
            (9210, 'Lyons', 'CO', true)`,
  );
  await sql.query("insert into dark_settings (newsroom_id, county) values (9210, 'Boulder County')");

  assert.equal(await ensureRegistryBackboneSources("seed-owner", 9208), 0);
  assert.equal(await ensureRegistryBackboneSources("seed-owner", 9209), 5);
  assert.equal(await ensureRegistryBackboneSources("seed-owner", 9210), 5);

  assert.deepEqual(await listRegistrySources(sql, 9208), [], "Riverbend gets no backbone");
  const [longmont] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = 9209 and status = 'accepted'",
  );
  assert.equal(Number(longmont!.count), 5);
});

test("the default Longmont paper gets the backbone with the live row's empty city and state", async () => {
  const sql = await getSql();
  // The live paper's row: onboarded, with name, city and state left empty.
  await sql.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true, city = null, state = null`,
  );
  assert.equal(await ensureRegistryBackboneSources("seed-owner", 1), 5);
  const [row] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = 1 and status = 'accepted'",
  );
  assert.equal(Number(row!.count), 5);
});

test("another newsroom with an empty city and state gets no backbone", async () => {
  const sql = await getSql();
  await sql.query("insert into paper_settings (newsroom_id, onboarded) values (9211, true)");
  assert.equal(await ensureRegistryBackboneSources("seed-owner", 9211), 0);
  assert.deepEqual(await listRegistrySources(sql, 9211), []);
});
