import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import type { Sql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  getPublicRegistryService,
  readPublicRegistrySearch,
  searchPublicRegistry,
} from "./registry-public.server.ts";

await applyMigrationsToTestPglite();

async function one<T>(sql: Sql, text: string, params: unknown[]): Promise<T> {
  return (await sql.query<T>(text, params))[0]!;
}

let counter = 0;
const key = (name: string) => `${name}-${++counter}`;

interface ServiceSeed {
  org?: string;
  name: string;
  description?: string | null;
  category?: number | null;
  published?: boolean;
  status?: string;
  orgPublished?: boolean;
}

async function addCategory(sql: Sql, room: number, name: string): Promise<number> {
  const row = await one<{ id: number }>(
    sql,
    `insert into taxonomies (newsroom_id, hsds_id, name, published) values ($1, $2, $3, true) returning id`,
    [room, key("tx"), name],
  );
  return Number(row.id);
}

async function addService(sql: Sql, room: number, seed: ServiceSeed): Promise<number> {
  const org = await one<{ id: number }>(
    sql,
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, $2, $3, 'active', $4) returning id`,
    [room, key("org"), seed.org ?? "Plain Org", seed.orgPublished ?? true],
  );
  const svc = await one<{ id: number }>(
    sql,
    `insert into services
       (newsroom_id, hsds_id, organization_id, name, description, taxonomy_id, status, published)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      room,
      key("svc"),
      org.id,
      seed.name,
      seed.description ?? null,
      seed.category ?? null,
      seed.status ?? "active",
      seed.published ?? true,
    ],
  );
  return Number(svc.id);
}

async function names(sql: Sql, room: number, input: Parameters<typeof searchPublicRegistry>[2]) {
  const page = await searchPublicRegistry(sql, room, input);
  return page.entries.map((e) => e.serviceName);
}

test("search matches the service name, organization name, description and category name, in any case", async () => {
  const sql = await getSql();
  const room = 9601;
  const food = await addCategory(sql, room, "Groceries and meals");
  await addService(sql, room, { name: "Zebra pantry", org: "Plain Org" });
  await addService(sql, room, { name: "Plain clinic", org: "Quokka Foundation" });
  await addService(sql, room, { name: "Plain ride", description: "Weekly Wombat transport" });
  await addService(sql, room, { name: "Plain meals", category: food });
  await addService(sql, room, { name: "Unrelated", org: "Other" });

  assert.deepEqual(await names(sql, room, { q: "ZEBRA" }), ["Zebra pantry"]);
  assert.deepEqual(await names(sql, room, { q: "quokka" }), ["Plain clinic"]);
  assert.deepEqual(await names(sql, room, { q: "wombat" }), ["Plain ride"]);
  assert.deepEqual(await names(sql, room, { q: "grocer" }), ["Plain meals"]);
  assert.deepEqual(await names(sql, room, { q: "  zebra  " }), ["Zebra pantry"], "q is trimmed");
  assert.equal((await names(sql, room, { q: "" })).length, 5, "empty q means no filter");
});

test("% and _ in q are matched literally, and quotes cannot break the query", async () => {
  const sql = await getSql();
  const room = 9602;
  await addService(sql, room, { name: "50% off coats" });
  await addService(sql, room, { name: "500 coats" });
  await addService(sql, room, { name: "a_b shelter" });
  await addService(sql, room, { name: "axb shelter" });
  assert.deepEqual(await names(sql, room, { q: "50%" }), ["50% off coats"]);
  assert.deepEqual(await names(sql, room, { q: "%" }), ["50% off coats"]);
  assert.deepEqual(await names(sql, room, { q: "a_b" }), ["a_b shelter"]);
  assert.deepEqual(await names(sql, room, { q: "\\" }), [], "a lone backslash matches nothing");
  assert.deepEqual(await names(sql, room, { q: "x'; drop table services; --" }), []);
  assert.equal((await names(sql, room, {})).length, 4, "the table is intact");
});

test("q is cut at 200 characters", async () => {
  const sql = await getSql();
  const room = 9603;
  await addService(sql, room, { name: "Long name pantry" });
  const longQ = "Long name pantry".padEnd(200, " ") + "zzzz-not-in-any-name";
  assert.deepEqual(await names(sql, room, { q: longQ }), ["Long name pantry"]);
});

test("the category and language filters work, and the language filter ignores removed rows", async () => {
  const sql = await getSql();
  const room = 9604;
  const food = await addCategory(sql, room, "Food");
  const housing = await addCategory(sql, room, "Housing");
  const a = await addService(sql, room, { name: "A pantry", category: food });
  const b = await addService(sql, room, { name: "B shelter", category: housing });
  const c = await addService(sql, room, { name: "C kitchen", category: food });
  const lang = (service: number, language: string, removed = false) =>
    sql.query(
      `insert into languages (newsroom_id, hsds_id, service_id, language, published, removed_at)
       values ($1, $2, $3, $4, true, ${removed ? "now()" : "null"})`,
      [room, key("lg"), service, language],
    );
  await lang(a, "Spanish");
  await lang(b, "Spanish");
  await lang(c, "Spanish", true);
  await lang(c, "Somali");

  assert.deepEqual(await names(sql, room, { categoryId: food }), ["A pantry", "C kitchen"]);
  assert.deepEqual(await names(sql, room, { language: "spanish" }), ["A pantry", "B shelter"]);
  assert.deepEqual(await names(sql, room, { categoryId: food, language: "Spanish" }), ["A pantry"]);
  assert.deepEqual(await names(sql, room, { language: "Klingon" }), []);
  assert.deepEqual(await names(sql, room, { categoryId: housing, q: "kitchen" }), []);
});

test("paging returns the total, 25 to a page by default, and an empty page past the end", async () => {
  const sql = await getSql();
  const room = 9605;
  for (let i = 1; i <= 27; i++) {
    await addService(sql, room, { name: `Pantry ${String(i).padStart(2, "0")}` });
  }
  const first = await searchPublicRegistry(sql, room, {});
  assert.equal(first.total, 27);
  assert.equal(first.pageSize, 25);
  assert.equal(first.page, 1);
  assert.equal(first.entries.length, 25);
  const second = await searchPublicRegistry(sql, room, { page: 2 });
  assert.equal(second.total, 27);
  assert.deepEqual(
    second.entries.map((e) => e.serviceName),
    ["Pantry 26", "Pantry 27"],
  );
  const past = await searchPublicRegistry(sql, room, { page: 9 });
  assert.equal(past.total, 27);
  assert.equal(past.entries.length, 0);
  const small = await searchPublicRegistry(sql, room, { pageSize: 10, page: 3, q: "pantry" });
  assert.equal(small.total, 27);
  assert.equal(small.entries.length, 7);
});

test("unpublished, inactive and other-newsroom services never appear in a list or a detail", async () => {
  const sql = await getSql();
  const room = 9606;
  const other = 9607;
  const visible = await addService(sql, room, { name: "Shown shelter" });
  const draft = await addService(sql, room, { name: "Draft shelter", published: false });
  const inactive = await addService(sql, room, { name: "Closed shelter", status: "inactive" });
  const orgDraft = await addService(sql, room, { name: "Org draft shelter", orgPublished: false });
  const elsewhere = await addService(sql, other, { name: "Elsewhere shelter" });

  assert.deepEqual(await names(sql, room, { q: "shelter" }), ["Shown shelter"]);
  assert.deepEqual(await names(sql, other, { q: "shelter" }), ["Elsewhere shelter"]);
  assert.equal((await searchPublicRegistry(sql, room, { q: "shelter" })).total, 1);
  assert.ok(await getPublicRegistryService(sql, room, visible));
  for (const id of [draft, inactive, orgDraft, elsewhere, 987654]) {
    assert.equal(await getPublicRegistryService(sql, room, id), null, `service ${id}`);
  }
  assert.equal(await getPublicRegistryService(sql, other, visible), null);
});

test("a search that cannot read the database is 'unavailable', not an empty result", async () => {
  const result = await readPublicRegistrySearch(
    async () => {
      throw new Error("down");
    },
    9608,
    { q: "x" },
  );
  assert.equal(result.status, "unavailable");
  const good = await readPublicRegistrySearch(getSql, 9608, { q: "x" });
  assert.equal(good.status, "ok");
});

test("a page or category number past the database's range is clamped or dropped, never 'unavailable'", async () => {
  const sql = await getSql();
  const room = 9612;
  await addService(sql, room, { name: "Range shelter", category: await addCategory(sql, room, "Range") });
  const farPage = await readPublicRegistrySearch(getSql, room, { page: 100000000 });
  assert.equal(farPage.status, "ok");
  if (farPage.status === "ok") {
    assert.equal(farPage.page, 100000);
    assert.equal(farPage.entries.length, 0);
    assert.equal(farPage.total, 1, "the total still counts every match");
  }
  const farCategory = await readPublicRegistrySearch(getSql, room, { categoryId: 99999999999 });
  assert.equal(farCategory.status, "ok");
  if (farCategory.status === "ok") assert.equal(farCategory.total, 1, "an out-of-range category is dropped");
  const both = await readPublicRegistrySearch(getSql, room, { page: 1e12, categoryId: 1e12 });
  assert.equal(both.status, "ok");
});

test("detail returns every public field, and keeps a place's hours, phones and accessibility with that place", async () => {
  const sql = await getSql();
  const room = 9609;
  const src = await one<{ id: number }>(
    sql,
    `insert into sources (user_id, url, title, newsroom_id) values ('u', 'https://svc.example/page', 'Service page', $1) returning id`,
    [room],
  );
  const orgSrc = await one<{ id: number }>(
    sql,
    `insert into sources (user_id, url, title, newsroom_id) values ('u', 'https://org.example/about', 'Org page', $1) returning id`,
    [room],
  );
  const org = await one<{ id: number }>(
    sql,
    `insert into organizations (newsroom_id, hsds_id, name, status, published, source_id)
     values ($1, $2, 'Detail Org', 'active', true, $3) returning id`,
    [room, key("org"), orgSrc.id],
  );
  const svc = await one<{ id: number }>(
    sql,
    `insert into services
       (newsroom_id, hsds_id, directory_name, organization_id, name, description, url, fees,
        application_process, status, published, source_id)
     values ($1, $2, 'dir-x', $3, 'Detail pantry', 'Groceries', 'https://svc.example', 'Free',
             'Walk in', 'active', true, $4) returning id`,
    [room, "svc-detail", org.id, src.id],
  );
  const serviceId = Number(svc.id);
  const loc = (name: string, addr: string) =>
    one<{ id: number }>(
      sql,
      `insert into locations (newsroom_id, hsds_id, organization_id, name, address_1, city, status, published)
       values ($1, $2, $3, $4, $5, 'Longmont', 'active', true) returning id`,
      [room, key("loc"), org.id, name, addr],
    );
  const north = await loc("North", "1 North St");
  const south = await loc("South", "2 South St");
  const sched = async (days: string, locationId: number | null) =>
    sql.query(
      `insert into schedules (newsroom_id, hsds_id, service_id, location_id, days, opens_at, closes_at, published)
       values ($1, $2, $3, $4, $5, '09:00', '10:00', true)`,
      [room, key("sch"), serviceId, locationId, days],
    );
  await sched("Monday", Number(north.id));
  await sched("Thursday", Number(south.id));
  await sched("Saturday", null);
  for (const l of [north, south]) {
    await sql.query(
      `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, published)
       values ($1, $2, $3, $4, true)`,
      [room, key("sal"), serviceId, l.id],
    );
  }
  const phone = (p: string, cols: { service?: number; location?: number; org?: number }) =>
    sql.query(
      `insert into contacts (newsroom_id, hsds_id, organization_id, service_id, location_id, phone, published)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [room, key("ct"), cols.org ?? null, cols.service ?? null, cols.location ?? null, p],
    );
  await phone("555-1000", { org: Number(org.id) });
  await phone("555-2000", { service: serviceId });
  await phone("555-3000", { location: Number(north.id) });
  await phone("555-4000", { location: Number(south.id) });
  await sql.query(
    `insert into contacts (newsroom_id, hsds_id, service_id, name, email, published)
     values ($1, $2, $3, 'Pat Personname', 'help@svc.example', true)`,
    [room, key("ct"), serviceId],
  );
  const access = (text: string, cols: { service?: number; location?: number }) =>
    sql.query(
      `insert into accessibilities (newsroom_id, hsds_id, service_id, location_id, accessibility, details)
       values ($1, $2, $3, $4, $5, null)`,
      [room, key("ac"), cols.service ?? null, cols.location ?? null, text],
    );
  await access("Ramp at the north door", { location: Number(north.id) });
  await access("Elevator", { location: Number(south.id) });
  await access("Sign language on request", { service: serviceId });
  await sql.query(
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description, published)
     values ($1, $2, $3, 'Boulder County residents', false)`,
    [room, key("el"), serviceId],
  );
  await sql.query(
    `insert into required_documents (newsroom_id, hsds_id, service_id, document, description, required, published)
     values ($1, $2, $3, 'Photo ID', 'Any kind', true, false)`,
    [room, key("rd"), serviceId],
  );
  await sql.query(
    `insert into languages (newsroom_id, hsds_id, service_id, language, published)
     values ($1, $2, $3, 'Spanish', true)`,
    [room, key("lg"), serviceId],
  );

  const entry = await getPublicRegistryService(sql, room, serviceId);
  assert.ok(entry);
  assert.equal(entry.serviceName, "Detail pantry");
  assert.equal(entry.organizationName, "Detail Org");
  assert.equal(entry.fees, "Free");
  assert.equal(entry.applicationProcess, "Walk in");
  assert.equal(entry.serviceUrl, "https://svc.example");
  assert.equal(entry.status, "active");
  assert.equal(entry.hsdsId, "svc-detail");
  assert.equal(entry.directory, "dir-x");
  assert.deepEqual(entry.serviceEmails, ["help@svc.example"]);
  assert.deepEqual(entry.eligibility, ["Boulder County residents"]);
  assert.deepEqual(entry.requiredDocuments, [
    { document: "Photo ID", description: "Any kind", required: true },
  ]);
  assert.deepEqual(entry.languages, ["Spanish"]);
  assert.deepEqual(entry.accessibility, ["Sign language on request"]);
  assert.deepEqual(entry.organizationPhones, ["555-1000"]);
  assert.deepEqual(entry.servicePhones, ["555-2000"]);
  assert.deepEqual(entry.serviceHours, ["Saturday, 09:00–10:00"]);
  assert.deepEqual(entry.sources, [
    { url: "https://svc.example/page", title: "Service page", appliesTo: "service" },
    { url: "https://org.example/about", title: "Org page", appliesTo: "organization" },
  ]);

  const northCard = entry.locations.find((l) => l.name === "North");
  const southCard = entry.locations.find((l) => l.name === "South");
  assert.ok(northCard && southCard);
  assert.deepEqual(northCard.phones, ["555-3000"]);
  assert.deepEqual(northCard.hours, ["Monday, 09:00–10:00"]);
  assert.deepEqual(northCard.accessibility, ["Ramp at the north door"]);
  assert.deepEqual(southCard.phones, ["555-4000"]);
  assert.deepEqual(southCard.hours, ["Thursday, 09:00–10:00"]);
  assert.deepEqual(southCard.accessibility, ["Elevator"]);
  assert.equal(northCard.address, "1 North St, Longmont");
});

test("removed eligibility, documents and accessibility are not read", async () => {
  const sql = await getSql();
  const room = 9610;
  const id = await addService(sql, room, { name: "Removal pantry" });
  await sql.query(
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description, removed_at)
     values ($1, $2, $3, 'Removed rule', now()), ($1, $4, $3, 'Kept rule', null)`,
    [room, key("el"), id, key("el")],
  );
  await sql.query(
    `insert into required_documents (newsroom_id, hsds_id, service_id, document, removed_at)
     values ($1, $2, $3, 'Removed doc', now())`,
    [room, key("rd"), id],
  );
  await sql.query(
    `insert into accessibilities (newsroom_id, hsds_id, service_id, accessibility, removed_at)
     values ($1, $2, $3, 'Removed access', now())`,
    [room, key("ac"), id],
  );
  const entry = await getPublicRegistryService(sql, room, id);
  assert.deepEqual(entry?.eligibility, ["Kept rule"]);
  assert.deepEqual(entry?.requiredDocuments, []);
  assert.deepEqual(entry?.accessibility, []);
});

test("an unpublished service's eligibility is never read, in a search or a detail", async () => {
  const sql = await getSql();
  const room = 9611;
  const id = await addService(sql, room, { name: "Hidden pantry", published: false });
  await sql.query(
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description)
     values ($1, $2, $3, 'Secret draft eligibility')`,
    [room, key("el"), id],
  );
  const page = await searchPublicRegistry(sql, room, { q: "secret draft" });
  assert.equal(page.total, 0);
  assert.equal(JSON.stringify(page.entries).includes("Secret draft"), false);
  assert.equal(await getPublicRegistryService(sql, room, id), null);
});

test("a null character in q or language is dropped, not reported as unavailable", async () => {
  const sql = await getSql();
  const result = await readPublicRegistrySearch(async () => sql, 9609, {
    q: "shel\u0000ter",
    language: "\u0000",
  });
  assert.equal(result.status, "ok");
});
