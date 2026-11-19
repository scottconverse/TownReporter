import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import type { Sql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { registryApiHandler } from "./registry-api.server.ts";

await applyMigrationsToTestPglite();

const ROOM = 9701;
const OTHER_ROOM = 9702;
const BASE = "http://localhost/api/registry/v1";

async function one<T>(sql: Sql, text: string, params: unknown[]): Promise<T> {
  return (await sql.query<T>(text, params))[0]!;
}

let counter = 0;
const key = (name: string) => `${name}-${++counter}`;

interface World {
  published: number;
  draft: number;
  otherRoom: number;
  categoryId: number;
}

/**
 * One published service with a place, plus the private things that must never
 * leave the server: a verification basis and checker, a review note, a
 * contact person's name, and an unpublished service with its own eligibility.
 */
async function seed(): Promise<World> {
  const sql = await getSql();
  const category = await one<{ id: number }>(
    sql,
    `insert into taxonomies (newsroom_id, hsds_id, name, published) values ($1, $2, 'Food', true) returning id`,
    [ROOM, key("tx")],
  );
  const addOrg = (room: number, name: string) =>
    one<{ id: number }>(
      sql,
      `insert into organizations (newsroom_id, hsds_id, name, status, published)
       values ($1, $2, $3, 'active', true) returning id`,
      [room, key("org"), name],
    );
  const org = await addOrg(ROOM, "Api Org");
  const addService = (room: number, orgId: number, name: string, published: boolean) =>
    one<{ id: number }>(
      sql,
      `insert into services (newsroom_id, hsds_id, organization_id, name, description, taxonomy_id, status, published)
       values ($1, $2, $3, $4, 'Food help', $5, 'active', $6) returning id`,
      [room, key("svc"), orgId, name, room === ROOM ? category.id : null, published],
    );
  const pub = await addService(ROOM, Number(org.id), "Api pantry", true);
  const draft = await addService(ROOM, Number(org.id), "Api draft", false);
  const otherOrg = await addOrg(OTHER_ROOM, "Other Org");
  const other = await addService(OTHER_ROOM, Number(otherOrg.id), "Api other newsroom", true);

  const loc = await one<{ id: number }>(
    sql,
    `insert into locations (newsroom_id, hsds_id, organization_id, name, address_1, city, status, published)
     values ($1, $2, $3, 'Main hall', '1 Main St', 'Longmont', 'active', true) returning id`,
    [ROOM, key("loc"), org.id],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, published)
     values ($1, $2, $3, $4, true)`,
    [ROOM, key("sal"), pub.id, loc.id],
  );
  await sql.query(
    `insert into schedules (newsroom_id, hsds_id, service_id, location_id, days, opens_at, closes_at, published)
     values ($1, $2, $3, $4, 'Tuesday', '10:00', '12:00', true)`,
    [ROOM, key("sch"), pub.id, loc.id],
  );
  await sql.query(
    `insert into contacts (newsroom_id, hsds_id, service_id, location_id, phone, published)
     values ($1, $2, $3, $4, '555-7777', true)`,
    [ROOM, key("ct"), pub.id, loc.id],
  );
  await sql.query(
    `insert into contacts (newsroom_id, hsds_id, service_id, name, role, email, published)
     values ($1, $2, $3, 'Casey Contactperson', 'Director', 'desk@api.example', true)`,
    [ROOM, key("ct"), pub.id],
  );
  await sql.query(
    `insert into accessibilities (newsroom_id, hsds_id, location_id, accessibility) values ($1, $2, $3, 'Step-free entrance')`,
    [ROOM, key("ac"), loc.id],
  );
  await sql.query(
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description, published)
     values ($1, $2, $3, 'Open to all residents', false),
            ($1, $4, $5, 'Draft-only secret eligibility', false)`,
    [ROOM, key("el"), pub.id, key("el"), draft.id],
  );
  await sql.query(
    `insert into resource_verifications (newsroom_id, service_id, checked_by, method, basis, facts)
     values ($1, $2, 'Reviewer Rita Hidden', 'phone', 'Basis: Rita called and a volunteer said so', '{}'::jsonb)`,
    [ROOM, pub.id],
  );
  const src = await one<{ id: number }>(
    sql,
    `insert into sources (user_id, url, title, newsroom_id) values ('u', 'https://api.example/src', 'Api source', $1) returning id`,
    [ROOM],
  );
  const snap = await one<{ id: number }>(
    sql,
    `insert into snapshots (user_id, source_id, content_hash, excerpt, newsroom_id)
     values ('u', $1, 'h', 'e', $2) returning id`,
    [src.id, ROOM],
  );
  await sql.query(
    `insert into resource_changes
       (newsroom_id, evidence_capture_id, evidence_tier, entity_type, entity_id, field_name,
        before_value, after_value, change_kind, review_state, review_note)
     values ($1, $2, 'B', 'service', $3, 'fees', 'a', 'b', 'field_change', 'pending',
             'Review note: Rita doubts this')`,
    [ROOM, snap.id, pub.id],
  );
  await sql.query(
    `insert into audit_events (user_id, action, detail) values ('Auditor Hidden', 'registry.publish', $1)`,
    [`service ${pub.id}`],
  );
  return {
    published: Number(pub.id),
    draft: Number(draft.id),
    otherRoom: Number(other.id),
    categoryId: Number(category.id),
  };
}

const world = await seed();

function get(
  path: string,
  init?: RequestInit,
  deps: Parameters<typeof registryApiHandler>[1] = {},
) {
  return registryApiHandler(new Request(`${BASE}${path}`, init), { newsroomId: ROOM, ...deps });
}

async function json(res: Response) {
  return (await res.json()) as {
    version: string;
    data?: any;
    page?: { number: number; size: number; total: number };
    error?: { code: string; message: string };
  };
}

test("list: 200 with the envelope, the page block, and the CORS, cache and content-type headers", async () => {
  const res = await get("/services");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "public, max-age=60");
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  const body = await json(res);
  assert.equal(body.version, "1");
  assert.deepEqual(body.page, { number: 1, size: 25, total: 1 });
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, world.published);
  assert.equal(body.data[0].name, "Api pantry");
  assert.equal(body.data[0].organization.name, "Api Org");
  assert.deepEqual(body.data[0].emails, ["desk@api.example"]);
});

test("detail: 200 with the full public fields; places keep their own phones, hours and accessibility", async () => {
  const res = await get(`/services/${world.published}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "public, max-age=60");
  const { data } = await json(res);
  assert.equal(data.id, world.published);
  assert.equal(typeof data.hsds_id, "string");
  assert.equal(data.directory, "");
  assert.equal(data.status, "active");
  assert.deepEqual(data.eligibility, ["Open to all residents"]);
  assert.deepEqual(data.sources, []);
  assert.equal(data.locations.length, 1);
  assert.deepEqual(data.locations[0].phones, ["555-7777"]);
  assert.deepEqual(data.locations[0].hours, ["Tuesday, 10:00–12:00"]);
  assert.deepEqual(data.locations[0].accessibility, ["Step-free entrance"]);
  assert.equal(data.verification.method, "phone");
  assert.equal(typeof data.verification.verified_at, "string");
  assert.deepEqual(data.phones, []);
});

test("categories: 200 with id and name", async () => {
  const res = await get("/categories");
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.deepEqual(body.data, [{ id: world.categoryId, name: "Food" }]);
});

test("filters work through the API, and an empty result is 200 with data []", async () => {
  const hit = await json(await get(`/services?q=PANTRY&category=${world.categoryId}`));
  assert.equal(hit.data.length, 1);
  const none = await get("/services?q=nothing-matches-this");
  assert.equal(none.status, 200);
  const body = await json(none);
  assert.deepEqual(body.data, []);
  assert.deepEqual(body.page, { number: 1, size: 25, total: 0 });
  const empty = await registryApiHandler(new Request(`${BASE}/services`), { newsroomId: 9799 });
  assert.equal(empty.status, 200);
  assert.deepEqual((await json(empty)).data, []);
  const cats = await registryApiHandler(new Request(`${BASE}/categories`), { newsroomId: 9799 });
  assert.deepEqual((await json(cats)).data, []);
});

test("limit and page are honoured and the total is the whole count", async () => {
  const body = await json(await get("/services?limit=1&page=2"));
  assert.deepEqual(body.data, []);
  assert.deepEqual(body.page, { number: 2, size: 1, total: 1 });
});

test("bad parameters give 400 bad_parameter in the error envelope", async () => {
  const cases = [
    "/services?page=0",
    "/services?page=abc",
    "/services?page=-1",
    "/services?page=1.5",
    "/services?limit=0",
    "/services?limit=101",
    "/services?limit=x",
    "/services?category=zero",
    "/services?category=0",
    `/services?q=${"a".repeat(201)}`,
    `/services?language=${"a".repeat(101)}`,
    "/services?q=%00",
    "/services?language=%00",
    "/services/abc",
    "/services/1.5",
  ];
  for (const path of cases) {
    const res = await get(path);
    assert.equal(res.status, 400, path);
    assert.equal(res.headers.get("access-control-allow-origin"), "*", path);
    const body = await json(res);
    assert.equal(body.version, "1");
    assert.equal(body.error?.code, "bad_parameter", path);
    assert.equal(typeof body.error?.message, "string");
    assert.equal(body.data, undefined);
  }
  assert.equal((await get("/services?limit=100")).status, 200);
});

test("an unknown, unpublished or other-newsroom id gives 404 not_found", async () => {
  for (const id of [world.draft, world.otherRoom, 987654, 99999999999]) {
    const res = await get(`/services/${id}`);
    assert.equal(res.status, 404, String(id));
    const body = await json(res);
    assert.equal(body.error?.code, "not_found");
  }
  const unknownPath = await get("/nothing-here");
  assert.equal(unknownPath.status, 404);
  assert.equal((await json(unknownPath)).error?.code, "not_found");
});

test("anything but GET gives 405 with the error envelope", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    const res = await get("/services", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET");
    if (method !== "HEAD") {
      assert.equal((await json(res)).error?.code, "method_not_allowed");
    }
  }
});

test("a read failure gives 503 unavailable with no stack and no SQL in the message", async () => {
  const failing = async () => {
    throw new Error('relation "services" does not exist: select * from services where secret');
  };
  for (const path of ["/services", `/services/${world.published}`, "/categories"]) {
    const res = await get(path, undefined, { getSql: failing });
    assert.equal(res.status, 503, path);
    const text = await res.text();
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "unavailable");
    assert.doesNotMatch(text, /select|relation|secret|stack|\bat\b.*\.ts/i);
  }
  const queryFails = async () =>
    ({
      query: async () => {
        throw new Error("boom: insert into services");
      },
    }) as never;
  const res = await get("/services", undefined, { getSql: queryFails });
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /insert|boom/);
});

test("private data is absent from every body: basis, checker, review note, contact name, a draft's eligibility, audit data", async () => {
  const texts = [
    await (await get("/services")).text(),
    await (await get(`/services/${world.published}`)).text(),
    await (await get("/services?limit=100&q=a")).text(),
    await (await get("/categories")).text(),
    await (await get(`/services/${world.draft}`)).text(),
  ];
  const secrets = [
    "Rita",
    "Basis:",
    "Reviewer",
    "Review note",
    "Casey",
    "Contactperson",
    "Director",
    "Draft-only secret eligibility",
    "Auditor Hidden",
    "registry.publish",
    "Api draft",
    "Api other newsroom",
    "basis",
    "checked_by",
    "review_note",
  ];
  for (const text of texts) {
    for (const secret of secrets) {
      assert.equal(text.includes(secret), false, `"${secret}" leaked`);
    }
  }
});

test("cookies and authorization headers change nothing: signed-in and signed-out callers get the same answer", async () => {
  const anon = await (await get(`/services/${world.published}`)).text();
  const signedIn = await (
    await get(`/services/${world.published}`, {
      headers: { cookie: "better-auth.session_token=abc", authorization: "Bearer xyz" },
    })
  ).text();
  assert.equal(signedIn, anon);
  const anonList = await (await get("/services")).text();
  const signedList = await (
    await get("/services", { headers: { cookie: "better-auth.session_token=abc" } })
  ).text();
  assert.equal(signedList, anonList);
});

test("a service of another newsroom is never returned, by list or by id", async () => {
  const list = await json(await get("/services?limit=100"));
  assert.ok(!list.data.some((s: { id: number }) => s.id === world.otherRoom));
  const otherList = await json(
    await registryApiHandler(new Request(`${BASE}/services`), { newsroomId: OTHER_ROOM }),
  );
  assert.deepEqual(
    otherList.data.map((s: { id: number }) => s.id),
    [world.otherRoom],
  );
  assert.equal((await get(`/services/${world.otherRoom}`)).status, 404);
});
