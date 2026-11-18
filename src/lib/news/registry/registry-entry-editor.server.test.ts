import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  getRegistryEntryDetail,
  saveContactIn,
  saveOrganizationDetailsIn,
  saveServiceDetailsIn,
} from "./registry-entry-editor.server.ts";

await applyMigrationsToTestPglite();

interface Seed {
  newsroomId: number;
  orgA: number;
  orgB: number;
  s1: number;
  s2: number;
  s3: number;
  location: number;
  ownContact: number;
  orgContact: number;
  locationContact: number;
}

type TestSql = Awaited<ReturnType<typeof getSql>>;

async function one(sql: TestSql, text: string, params: unknown[]) {
  const rows = await sql.query<{ id: number }>(text, params);
  return Number(rows[0]!.id);
}

/**
 * Org A has services s1 and s2; org B has s3. A location is linked to s1 and
 * s2. s1 has its own contact; org A has a main-line contact; the location has a
 * contact. s3 has a contact that must never show on s1.
 */
async function seed(newsroomId: number, published = false): Promise<Seed> {
  const sql = await getSql();
  const org = (hsds: string, name: string) =>
    one(
      sql,
      `insert into organizations (newsroom_id, hsds_id, name, email, published)
       values ($1, $2, $3, 'old@example.org', $4) returning id`,
      [newsroomId, hsds, name, published],
    );
  const orgA = await org("org-a", "Helping Hands");
  const orgB = await org("org-b", "Other Org");
  const svc = (hsds: string, name: string, organizationId: number) =>
    one(
      sql,
      `insert into services (newsroom_id, hsds_id, organization_id, name, published, fees)
       values ($1, $2, $3, $4, $5, 'Free') returning id`,
      [newsroomId, hsds, organizationId, name, published],
    );
  const s1 = await svc("svc-1", "Food Pantry", orgA);
  const s2 = await svc("svc-2", "Clothing Closet", orgA);
  const s3 = await svc("svc-3", "Legal Aid", orgB);
  const location = await one(
    sql,
    `insert into locations (newsroom_id, hsds_id, organization_id, name)
     values ($1, 'loc-1', $2, 'Main Hall') returning id`,
    [newsroomId, orgA],
  );
  for (const [i, s] of [s1, s2].entries()) {
    await sql.query(
      `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id)
       values ($1, $2, $3, $4)`,
      [newsroomId, `sal-${i}`, s, location],
    );
  }
  const contact = (hsds: string, column: string, value: number) =>
    one(
      sql,
      `insert into contacts (newsroom_id, hsds_id, ${column}, name, phone, published)
       values ($1, $2, $3, $4, '555-0100', $5) returning id`,
      [newsroomId, hsds, value, `Contact ${hsds}`, published],
    );
  const ownContact = await contact("c-own", "service_id", s1);
  const orgContact = await contact("c-org", "organization_id", orgA);
  const locationContact = await contact("c-loc", "location_id", location);
  await contact("c-other", "service_id", s3);
  return { newsroomId, orgA, orgB, s1, s2, s3, location, ownContact, orgContact, locationContact };
}

const goodService = {
  name: "Food Pantry (renamed)",
  description: "Groceries",
  url: "https://example.org/pantry",
  fees: "Free",
  applicationProcess: "Walk in",
  crisis: true,
};

test("the detail reader returns the service, its organization, its contacts and what is shared", async () => {
  const sql = await getSql();
  const seeded = await seed(9601);
  const detail = await getRegistryEntryDetail(sql, 9601, seeded.s1);
  assert.ok(detail);
  assert.equal(detail.service.name, "Food Pantry");
  assert.equal(detail.service.fees, "Free");
  assert.equal(detail.service.published, false);
  assert.equal(detail.organization.name, "Helping Hands");
  assert.equal(detail.organization.email, "old@example.org");
  assert.deepEqual(detail.organization.sharedWith, [
    { serviceId: seeded.s2, name: "Helping Hands — Clothing Closet" },
  ]);

  const byScope = Object.fromEntries(detail.contacts.map((c) => [c.scope, c]));
  assert.equal(detail.contacts.length, 3, "own, organization and location contacts only");
  assert.deepEqual(byScope.service!.sharedWith, [], "the service's own contact is not shared");
  assert.deepEqual(byScope.organization!.sharedWith, detail.organization.sharedWith);
  assert.deepEqual(byScope.location!.sharedWith, [
    { serviceId: seeded.s2, name: "Helping Hands — Clothing Closet" },
  ]);
  assert.equal(byScope.location!.locationName, "Main Hall");
  assert.ok(!detail.contacts.some((c) => c.name === "Contact c-other"), "another service's contact");

  const alone = await getRegistryEntryDetail(sql, 9601, seeded.s3);
  assert.deepEqual(alone!.organization.sharedWith, []);
  assert.equal(alone!.contacts.length, 1);
});

test("the detail reader refuses another newsroom's service and never leaks its rows", async () => {
  const sql = await getSql();
  const seeded = await seed(9602);
  assert.equal(await getRegistryEntryDetail(sql, 9999, seeded.s1), null);
  assert.equal(await getRegistryEntryDetail(sql, 9602, 987654321), null);

  // Another newsroom's services in a same-named organization never show up as
  // shared with this newsroom's service.
  const other = await seed(9603);
  const detail = await getRegistryEntryDetail(sql, 9602, seeded.s1);
  assert.ok(detail!.organization.sharedWith.every((entry) => entry.serviceId !== other.s2));
  assert.equal(detail!.organization.sharedWith.length, 1);
});

test("saving the service writes its fields, stamps it, and leaves published alone", async () => {
  const sql = await getSql();
  for (const published of [false, true]) {
    const seeded = await seed(published ? 9605 : 9604, published);
    const result = await saveServiceDetailsIn(sql, seeded.newsroomId, seeded.s1, goodService, "ed-1");
    assert.deepEqual(result, { ok: true, serviceId: seeded.s1 });
    const [row] = await sql.query<Record<string, unknown>>("select * from services where id = $1", [
      seeded.s1,
    ]);
    assert.equal(row!.name, "Food Pantry (renamed)");
    assert.equal(row!.description, "Groceries");
    assert.equal(row!.url, "https://example.org/pantry");
    assert.equal(row!.application_process, "Walk in");
    assert.equal(row!.crisis, true);
    assert.equal(row!.published, published, "published is untouched");
    assert.equal(row!.verification_method, "editor");
    assert.equal(row!.last_verified_by, "ed-1");
    assert.ok(row!.last_verified_at);
    const [sibling] = await sql.query<Record<string, unknown>>(
      "select name, last_verified_by from services where id = $1",
      [seeded.s2],
    );
    assert.equal(sibling!.name, "Clothing Closet");
    assert.equal(sibling!.last_verified_by, null);
  }
});

test("a service save with bad fields returns problems by field and writes nothing", async () => {
  const sql = await getSql();
  const seeded = await seed(9606);
  const result = await saveServiceDetailsIn(
    sql,
    9606,
    seeded.s1,
    { ...goodService, name: "  ", url: "ftp://nope", fees: "x".repeat(1001) },
    "ed-1",
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.problems.name!, /Enter the service's name/);
  assert.match(result.problems.url!, /https:\/\//);
  assert.match(result.problems.fees!, /1000 characters or fewer/);
  assert.equal(result.problems.description, undefined);
  const [row] = await sql.query<Record<string, unknown>>("select * from services where id = $1", [
    seeded.s1,
  ]);
  assert.equal(row!.name, "Food Pantry");
  assert.equal(row!.last_verified_by, null);
});

test("saving the organization changes the shared row and no other organization", async () => {
  const sql = await getSql();
  const seeded = await seed(9607);
  const result = await saveOrganizationDetailsIn(
    sql,
    9607,
    seeded.s1,
    {
      name: "Helping Hands Inc",
      alternateName: "HH",
      description: "Neighbors helping neighbors",
      email: "hello@example.org",
      website: "https://hh.example.org",
      legalStatus: "nonprofit",
    },
    "ed-2",
  );
  assert.deepEqual(result, { ok: true, serviceId: seeded.s1 });
  const detail = await getRegistryEntryDetail(sql, 9607, seeded.s2);
  assert.equal(detail!.organization.name, "Helping Hands Inc", "the sibling service sees the change");
  assert.equal(detail!.organization.alternateName, "HH");
  assert.equal(detail!.organization.legalStatus, "nonprofit");
  const [other] = await sql.query<{ name: string }>("select name from organizations where id = $1", [
    seeded.orgB,
  ]);
  assert.equal(other!.name, "Other Org");
  const [stamp] = await sql.query<{ last_verified_by: string | null }>(
    "select last_verified_by from services where id = $1",
    [seeded.s1],
  );
  assert.equal(stamp!.last_verified_by, "ed-2");
});

test("an organization save with a bad email or website returns problems and writes nothing", async () => {
  const sql = await getSql();
  const seeded = await seed(9608);
  const result = await saveOrganizationDetailsIn(
    sql,
    9608,
    seeded.s1,
    { name: "", email: "not an email", website: "example.org" },
    "ed-2",
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.problems.name!, /Enter the organization's name/);
  assert.match(result.problems.email!, /name@example\.org/);
  assert.match(result.problems.website!, /https:\/\//);
  const [org] = await sql.query<{ name: string; email: string }>(
    "select name, email from organizations where id = $1",
    [seeded.orgA],
  );
  assert.deepEqual({ ...org }, { name: "Helping Hands", email: "old@example.org" });
});

test("adding a contact to a service takes the service's published state", async () => {
  const sql = await getSql();
  for (const published of [false, true]) {
    const seeded = await seed(published ? 9610 : 9609, published);
    const result = await saveContactIn(
      sql,
      seeded.newsroomId,
      seeded.s1,
      {
        scope: "service",
        fields: {
          name: "Intake",
          phone: "555-0199",
          phoneExtension: "12",
          email: "intake@example.org",
        },
      },
      "ed-3",
    );
    assert.deepEqual(result, { ok: true, serviceId: seeded.s1 });
    const detail = await getRegistryEntryDetail(sql, seeded.newsroomId, seeded.s1);
    assert.equal(detail!.contacts.length, 4);
    const added = detail!.contacts.find((c) => c.name === "Intake")!;
    assert.equal(added.scope, "service");
    assert.equal(added.phoneExtension, "12");
    const [row] = await sql.query<Record<string, unknown>>("select * from contacts where id = $1", [
      added.id,
    ]);
    assert.equal(row!.published, published);
    assert.equal(row!.verification_method, "editor");
    assert.equal(row!.service_id, seeded.s1);
  }
});

test("adding an organization-level contact shows it on the organization's other entries", async () => {
  const sql = await getSql();
  const seeded = await seed(9611);
  const result = await saveContactIn(
    sql,
    9611,
    seeded.s1,
    { scope: "organization", fields: { name: "Front desk", phone: "555-0123" } },
    "ed-3",
  );
  assert.equal(result.ok, true);
  const detail = await getRegistryEntryDetail(sql, 9611, seeded.s2);
  const added = detail!.contacts.find((c) => c.name === "Front desk");
  assert.ok(added, "the sibling service sees the organization's new contact");
  assert.equal(added.scope, "organization");
});

test("changing a contact writes its fields, keeps its published state and adds no row", async () => {
  const sql = await getSql();
  const seeded = await seed(9612, true);
  const before = await sql.query<{ count: string }>(
    "select count(*)::text as count from contacts where newsroom_id = $1",
    [9612],
  );
  const ids = [seeded.ownContact, seeded.orgContact, seeded.locationContact];
  for (const id of ids) {
    const result = await saveContactIn(
      sql,
      9612,
      seeded.s1,
      {
        contactId: id,
        fields: { name: `Changed ${id}`, role: "Lead", department: "Intake", phone: "555-0000" },
      },
      "ed-4",
    );
    assert.equal(result.ok, true);
  }
  const after = await sql.query<{ count: string }>(
    "select count(*)::text as count from contacts where newsroom_id = $1",
    [9612],
  );
  assert.equal(after[0]!.count, before[0]!.count);
  const rows = await sql.query<{ name: string; role: string; published: boolean }>(
    "select name, role, published from contacts where id = any($1::int[]) order by id",
    [ids],
  );
  assert.ok(rows.every((r) => r.role === "Lead" && r.published === true));
  assert.deepEqual(
    rows.map((r) => r.name),
    ids.map((id) => `Changed ${id}`),
  );
});

test("a contact save with bad fields returns problems and writes nothing", async () => {
  const sql = await getSql();
  const seeded = await seed(9613);
  const empty = await saveContactIn(sql, 9613, seeded.s1, { scope: "service", fields: {} }, "ed-5");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.problems.form!, /at least a name/);

  const bad = await saveContactIn(
    sql,
    9613,
    seeded.s1,
    {
      contactId: seeded.ownContact,
      fields: { name: "N", phoneExtension: "9", email: "nope", website: "nope" },
    },
    "ed-5",
  );
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.match(bad.problems.phoneExtension!, /needs a phone number/);
    assert.match(bad.problems.email!, /name@example\.org/);
    assert.match(bad.problems.website!, /https:\/\//);
  }
  const [row] = await sql.query<{ name: string }>("select name from contacts where id = $1", [
    seeded.ownContact,
  ]);
  assert.equal(row!.name, "Contact c-own");
  const [count] = await sql.query<{ count: string }>(
    "select count(*)::text as count from contacts where newsroom_id = 9613",
    [],
  );
  assert.equal(count!.count, "4");
});

test("a contact that is not part of this entry is refused", async () => {
  const sql = await getSql();
  const seeded = await seed(9614);
  const other = await seed(9615);
  const sibling = await sql.query<{ id: number }>(
    "select id from contacts where newsroom_id = 9614 and name = 'Contact c-other'",
    [],
  );
  for (const contactId of [Number(sibling[0]!.id), other.ownContact]) {
    await assert.rejects(
      saveContactIn(sql, 9614, seeded.s1, { contactId, fields: { name: "Hijack" } }, "ed-6"),
      /not part of this entry/,
    );
  }
  const rows = await sql.query<{ name: string }>("select name from contacts where name = 'Hijack'", []);
  assert.equal(rows.length, 0);
});

test("every save refuses a service from another newsroom and changes nothing", async () => {
  const sql = await getSql();
  await seed(9616);
  const theirs = await seed(9617);
  await assert.rejects(
    saveServiceDetailsIn(sql, 9616, theirs.s1, goodService, "ed-7"),
    /not in this newsroom/,
  );
  await assert.rejects(
    saveOrganizationDetailsIn(sql, 9616, theirs.s1, { name: "Taken over" }, "ed-7"),
    /not in this newsroom/,
  );
  await assert.rejects(
    saveContactIn(sql, 9616, theirs.s1, { scope: "service", fields: { name: "X" } }, "ed-7"),
    /not in this newsroom/,
  );
  // A bad body for a foreign service is still a refusal, not a problems list.
  await assert.rejects(saveServiceDetailsIn(sql, 9616, theirs.s1, {}, "ed-7"), /not in this newsroom/);
  const [service] = await sql.query<{ name: string }>("select name from services where id = $1", [
    theirs.s1,
  ]);
  const [org] = await sql.query<{ name: string }>("select name from organizations where id = $1", [
    theirs.orgA,
  ]);
  assert.equal(service!.name, "Food Pantry");
  assert.equal(org!.name, "Helping Hands");
});

test("a save that fails part-way writes nothing", async () => {
  const sql = await getSql();
  const seeded = await seed(9618);
  await sql.query(
    `create or replace function test_fail_stamp() returns trigger as $$
     begin
       if new.last_verified_by = 'fail-user' then raise exception 'stamp failed'; end if;
       return new;
     end $$ language plpgsql`,
    [],
  );
  await sql.query(
    `create trigger fail_stamp before update on services
       for each row execute function test_fail_stamp()`,
    [],
  );
  try {
    await assert.rejects(
      saveOrganizationDetailsIn(sql, 9618, seeded.s1, { name: "Half Written" }, "fail-user"),
      /stamp failed/,
    );
    await assert.rejects(
      saveContactIn(sql, 9618, seeded.s1, { scope: "service", fields: { name: "Half" } }, "fail-user"),
      /stamp failed/,
    );
    await assert.rejects(
      saveContactIn(
        sql,
        9618,
        seeded.s1,
        { contactId: seeded.ownContact, fields: { name: "Half" } },
        "fail-user",
      ),
      /stamp failed/,
    );
    await assert.rejects(
      saveServiceDetailsIn(sql, 9618, seeded.s1, goodService, "fail-user"),
      /stamp failed/,
    );
  } finally {
    await sql.query("drop trigger fail_stamp on services", []);
    await sql.query("drop function test_fail_stamp()", []);
  }
  const [org] = await sql.query<{ name: string }>("select name from organizations where id = $1", [
    seeded.orgA,
  ]);
  assert.equal(org!.name, "Helping Hands", "the organization write was rolled back");
  const contacts = await sql.query<{ name: string }>(
    "select name from contacts where newsroom_id = 9618 and name like 'Half%'",
    [],
  );
  assert.equal(contacts.length, 0, "no contact was added or changed");
  const [service] = await sql.query<{ name: string; last_verified_by: string | null }>(
    "select name, last_verified_by from services where id = $1",
    [seeded.s1],
  );
  assert.deepEqual({ ...service }, { name: "Food Pantry", last_verified_by: null });
});
