import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import type { Sql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { publishRegistryEntryIn } from "./registry-desk-write.server.ts";
import { listPublicRegistry } from "./registry-public.server.ts";

await applyMigrationsToTestPglite();

async function one<T>(sql: Sql, text: string, params: unknown[]): Promise<T> {
  const rows = await sql.query<T>(text, params);
  return rows[0]!;
}

interface World {
  organizationId: number;
  serviceA: number;
  serviceB: number;
  locationOne: number;
  locationTwo: number;
}

/**
 * One organization, two services. Service A is offered at two locations, each
 * with its own schedule (reached only through service_at_locations) and its own
 * location phone. Everything starts unpublished. The unrelated rows (service B's
 * phone and schedule, a phone of a location A is not linked to, a schedule no
 * row of A references) are the ones that must stay hidden.
 */
async function seedWorld(newsroomId: number): Promise<World> {
  const sql = await getSql();
  const k = (name: string) => `${name}-${newsroomId}`;
  const org = await one<{ id: number }>(
    sql,
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, $2, 'Relations Org', 'unverified', false) returning id`,
    [newsroomId, k("org")],
  );
  const addService = async (key: string, name: string) =>
    one<{ id: number }>(
      sql,
      `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
       values ($1, $2, $3, $4, 'unverified', false) returning id`,
      [newsroomId, k(key), org.id, name],
    );
  const a = await addService("svc-a", "Pantry");
  const b = await addService("svc-b", "Legal clinic");
  const addLocation = async (key: string, address: string) =>
    one<{ id: number }>(
      sql,
      `insert into locations
         (newsroom_id, hsds_id, organization_id, name, address_1, city, state_province, postal_code, status, published)
       values ($1, $2, $3, $4, $5, 'Longmont', 'CO', '80501', 'unverified', false) returning id`,
      [newsroomId, k(key), org.id, key, address],
    );
  const north = await addLocation("loc-north", "1 North St");
  const south = await addLocation("loc-south", "2 South St");
  const elsewhere = await addLocation("loc-elsewhere", "3 Other St");
  const addSchedule = async (key: string, days: string, opens: string, closes: string) =>
    one<{ id: number }>(
      sql,
      `insert into schedules (newsroom_id, hsds_id, days, opens_at, closes_at, published)
       values ($1, $2, $3, $4, $5, false) returning id`,
      [newsroomId, k(key), days, opens, closes],
    );
  const s1 = await addSchedule("sch-north", "Monday", "09:00", "11:00");
  const s2 = await addSchedule("sch-south", "Thursday", "15:00", "18:00");
  await addSchedule("sch-orphan", "Sunday", "01:00", "02:00");
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, days, opens_at, closes_at, published)
     values ($1, $2, $3, 'Friday', '08:00', '09:00', false)`,
    [newsroomId, k("sch-b"), b.id],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, schedule_id, published)
     values ($1, $2, $3, $4, $5, false), ($1, $6, $3, $7, $8, false)`,
    [newsroomId, k("sal-1"), a.id, north.id, s1.id, k("sal-2"), south.id, s2.id],
  );
  const addContact = async (
    key: string,
    phone: string,
    cols: { organization_id?: number; service_id?: number; location_id?: number },
  ) =>
    sql.query(
      `insert into contacts (newsroom_id, hsds_id, organization_id, service_id, location_id, phone, published)
       values ($1, $2, $3, $4, $5, $6, false)`,
      [
        newsroomId,
        k(key),
        cols.organization_id ?? null,
        cols.service_id ?? null,
        cols.location_id ?? null,
        phone,
      ],
    );
  await addContact("ct-org", "555-0001", { organization_id: Number(org.id) });
  await addContact("ct-north", "555-0002", { location_id: Number(north.id) });
  await addContact("ct-south", "555-0003", { location_id: Number(south.id) });
  await addContact("ct-a", "555-0004", { service_id: Number(a.id) });
  await addContact("ct-b", "555-0005", { service_id: Number(b.id) });
  await addContact("ct-elsewhere", "555-0006", { location_id: Number(elsewhere.id) });
  return {
    organizationId: Number(org.id),
    serviceA: Number(a.id),
    serviceB: Number(b.id),
    locationOne: Number(north.id),
    locationTwo: Number(south.id),
  };
}

test("publishing a service also publishes its organization's phone and its location-linked schedules", async () => {
  const sql = await getSql();
  const newsroomId = 9501;
  const world = await seedWorld(newsroomId);
  await publishRegistryEntryIn(sql, newsroomId, world.serviceA, "editor");

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1);
  const entry = page.entries[0]!;
  assert.deepEqual(entry.organizationPhones, ["555-0001"], "the organization's main phone shows");
  const north = entry.locations.find((l) => l.locationId === world.locationOne)!;
  assert.deepEqual(
    north.hours,
    ["Monday, 09:00–11:00"],
    "a schedule reached through the location link shows",
  );
});

test("each location keeps its own address, phone and hours", async () => {
  const sql = await getSql();
  const newsroomId = 9502;
  const world = await seedWorld(newsroomId);
  await publishRegistryEntryIn(sql, newsroomId, world.serviceA, "editor");

  const entry = (await listPublicRegistry(sql, newsroomId)).entries[0]!;
  assert.equal(entry.locations.length, 2);
  const [north, south] = entry.locations;
  assert.equal(north!.address, "1 North St, Longmont, CO, 80501");
  assert.deepEqual(north!.phones, ["555-0002"]);
  assert.deepEqual(north!.hours, ["Monday, 09:00–11:00"]);
  assert.equal(south!.address, "2 South St, Longmont, CO, 80501");
  assert.deepEqual(south!.phones, ["555-0003"]);
  assert.deepEqual(south!.hours, ["Thursday, 15:00–18:00"]);
  assert.deepEqual(entry.servicePhones, ["555-0004"], "the service's own phone is kept apart");
  assert.deepEqual(entry.serviceHours, []);
});

test("unrelated children stay hidden after a publish", async () => {
  const sql = await getSql();
  const newsroomId = 9503;
  const world = await seedWorld(newsroomId);
  await publishRegistryEntryIn(sql, newsroomId, world.serviceA, "editor");

  const flag = async (table: string, hsds: string) =>
    (
      await one<{ published: boolean }>(
        sql,
        `select published from ${table} where newsroom_id = $1 and hsds_id = $2`,
        [newsroomId, `${hsds}-${newsroomId}`],
      )
    ).published;
  assert.equal(await flag("contacts", "ct-b"), false, "another service's phone");
  assert.equal(await flag("contacts", "ct-elsewhere"), false, "a location the service is not linked to");
  assert.equal(await flag("schedules", "sch-b"), false, "another service's schedule");
  assert.equal(await flag("schedules", "sch-orphan"), false, "a schedule nothing of the service references");
  assert.equal(await flag("locations", "loc-elsewhere"), false, "an unlinked location");
  assert.equal(await flag("services", "svc-b"), false, "the other service");

  const entry = (await listPublicRegistry(sql, newsroomId)).entries[0]!;
  const phones = [
    ...entry.organizationPhones,
    ...entry.servicePhones,
    ...entry.locations.flatMap((l) => l.phones),
  ];
  assert.ok(!phones.includes("555-0005") && !phones.includes("555-0006"));
  const hours = [...entry.serviceHours, ...entry.locations.flatMap((l) => l.hours)];
  assert.ok(!hours.some((h) => h.startsWith("Friday") || h.startsWith("Sunday")));
});

test("a second service of the same organization keeps its own phone and hours and none of A's places", async () => {
  const sql = await getSql();
  const newsroomId = 9504;
  const world = await seedWorld(newsroomId);
  await publishRegistryEntryIn(sql, newsroomId, world.serviceA, "editor");
  await publishRegistryEntryIn(sql, newsroomId, world.serviceB, "editor");

  const page = await listPublicRegistry(sql, newsroomId);
  const b = page.entries.find((e) => e.serviceId === world.serviceB)!;
  assert.deepEqual(b.locations, [], "service B is linked to no place");
  assert.deepEqual(b.servicePhones, ["555-0005"]);
  assert.deepEqual(b.serviceHours, ["Friday, 08:00–09:00"]);
  const a = page.entries.find((e) => e.serviceId === world.serviceA)!;
  assert.deepEqual(a.servicePhones, ["555-0004"], "B's phone never lands on A");
});
