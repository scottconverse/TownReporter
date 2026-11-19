import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import type { Sql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { listPublicRegistryLanguages } from "./registry-public.server.ts";
import { registrySitemapLocations } from "./registry-sitemap.server.ts";

await applyMigrationsToTestPglite();

async function one<T>(sql: Sql, text: string, params: unknown[]): Promise<T> {
  return (await sql.query<T>(text, params))[0]!;
}

let counter = 0;
const key = (name: string) => `${name}-${++counter}`;

async function addService(
  sql: Sql,
  room: number,
  name: string,
  opts: { published?: boolean; status?: string } = {},
): Promise<number> {
  const org = await one<{ id: number }>(
    sql,
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, $2, 'Org', 'active', true) returning id`,
    [room, key("org")],
  );
  const svc = await one<{ id: number }>(
    sql,
    `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [room, key("svc"), org.id, name, opts.status ?? "active", opts.published ?? true],
  );
  return Number(svc.id);
}

test("the sitemap lists each published service and never an unpublished, inactive or other-newsroom one", async () => {
  const sql = await getSql();
  const room = 9701;
  const published = await addService(sql, room, "Listed");
  const draft = await addService(sql, room, "Draft", { published: false });
  const retired = await addService(sql, room, "Retired", { status: "inactive" });
  const elsewhere = await addService(sql, room + 1, "Other newsroom");

  const locs = await registrySitemapLocations(getSql, room, "https://paper.example");
  assert.deepEqual(locs, [`https://paper.example/registry/${published}`]);
  for (const id of [draft, retired, elsewhere])
    assert.ok(!locs.some((l) => l.endsWith(`/${id}`)), `service ${id} is not listed`);
});

test("an unreadable registry adds nothing to the sitemap instead of failing it", async () => {
  const locs = await registrySitemapLocations(
    async () => {
      throw new Error("db down");
    },
    9702,
    "https://paper.example",
  );
  assert.deepEqual(locs, []);
});

test("the language choices come from published services only, one spelling each", async () => {
  const sql = await getSql();
  const room = 9703;
  const a = await addService(sql, room, "A");
  const draft = await addService(sql, room, "B", { published: false });
  const lang = (service: number, language: string, removed = false) =>
    sql.query(
      `insert into languages (newsroom_id, hsds_id, service_id, language, published, removed_at)
       values ($1, $2, $3, $4, true, ${removed ? "now()" : "null"})`,
      [room, key("lg"), service, language],
    );
  await lang(a, "Spanish");
  await lang(a, "spanish");
  await lang(a, "Somali", true);
  await lang(draft, "Klingon");
  assert.deepEqual(await listPublicRegistryLanguages(sql, room), ["Spanish"]);
});
