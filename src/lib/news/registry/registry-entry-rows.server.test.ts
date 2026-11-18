/*
  The entry editor's other rows and removal (spec 24, Phase 2, job C2): places,
  hours, eligibility, required documents, languages, accessibility, and
  removing or restoring a row (migration 0165). PGlite, the real migrations.
*/
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPglite, getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  getRegistryEntryDetail,
  removeEntryRowIn,
  restoreEntryRowIn,
  saveContactIn,
  saveEntryRowIn,
  saveServiceDetailsIn,
  type EntrySaveResult,
} from "./registry-entry-editor.server.ts";
import type { FieldProblems, RemovableKind } from "./registry-entry-editor-fields.ts";
import { listPublicRegistry } from "./registry-public.server.ts";
import { publishRegistryEntryIn } from "./registry-desk-write.server.ts";
import { importHsdsBundle } from "./hsds-import.server.ts";
import type { HsdsBundle } from "./hsds-types.ts";

await applyMigrationsToTestPglite();

type TestSql = Awaited<ReturnType<typeof getSql>>;

function refused(result: EntrySaveResult): FieldProblems {
  assert.equal(result.ok, false, "the save should be refused");
  return result.ok ? {} : result.problems;
}

async function one(sql: TestSql, text: string, params: unknown[]) {
  const rows = await sql.query<{ id: number }>(text, params);
  return Number(rows[0]!.id);
}

interface Seed {
  n: number;
  orgA: number;
  orgB: number;
  s1: number;
  s2: number;
  s3: number;
  l1: number;
  l2: number;
  otherOrgPlace: number;
  link1: number;
  link2: number;
  sc1: number;
  sc2: number;
  sc3: number;
  elig: number;
  doc: number;
  lang: number;
  access: number;
  ownContact: number;
  orgContact: number;
  locContact: number;
}

/**
 * Org A has services s1 and s2 and two places: l1 (linked to both) and l2 (linked
 * to neither). s1 has hours of its own (service-wide and at l1), a schedule that
 * both links point at, an eligibility rule, a document, a language and an
 * accessibility note, and three contacts (its own, the organization's, l1's).
 * Org B has s3 and a place of its own.
 */
async function seed(n: number, published = false): Promise<Seed> {
  const sql = await getSql();
  const org = (hsds: string, name: string) =>
    one(
      sql,
      `insert into organizations (newsroom_id, hsds_id, name, status, published)
       values ($1, $2, $3, 'active', $4) returning id`,
      [n, hsds, name, published],
    );
  const orgA = await org("org-a", "Helping Hands");
  const orgB = await org("org-b", "Other Org");
  const svc = (hsds: string, name: string, organizationId: number) =>
    one(
      sql,
      `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
       values ($1, $2, $3, $4, 'active', $5) returning id`,
      [n, hsds, organizationId, name, published],
    );
  const s1 = await svc("svc-1", "Food Pantry", orgA);
  const s2 = await svc("svc-2", "Clothing Closet", orgA);
  const s3 = await svc("svc-3", "Legal Aid", orgB);
  const place = (hsds: string, organizationId: number, name: string, status: string) =>
    one(
      sql,
      `insert into locations (newsroom_id, hsds_id, organization_id, name, address_1, city,
                              status, published)
       values ($1, $2, $3, $4, '1 Main St', 'Longmont', $5, $6) returning id`,
      [n, hsds, organizationId, name, status, published],
    );
  const l1 = await place("loc-1", orgA, "Main Hall", "active");
  const l2 = await place("loc-2", orgA, "Annex", "unverified");
  const otherOrgPlace = await place("loc-3", orgB, "Their Hall", "active");
  const schedule = (hsds: string, serviceId: number | null, locationId: number | null, days: string) =>
    one(
      sql,
      `insert into schedules (newsroom_id, hsds_id, service_id, location_id, days, opens_at,
                              closes_at, published)
       values ($1, $2, $3, $4, $5, '9:00', '17:00', $6) returning id`,
      [n, hsds, serviceId, locationId, days, published],
    );
  const sc1 = await schedule("sc-1", s1, null, "Monday");
  const sc2 = await schedule("sc-2", s1, l1, "Tuesday");
  const sc3 = await schedule("sc-3", null, l1, "Wednesday");
  const link = (hsds: string, serviceId: number) =>
    one(
      sql,
      `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id,
                                         schedule_id, published)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [n, hsds, serviceId, l1, sc3, published],
    );
  const link1 = await link("sal-1", s1);
  const link2 = await link("sal-2", s2);
  const elig = await one(
    sql,
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description, published)
     values ($1, 'el-1', $2, 'Residents of the county', $3) returning id`,
    [n, s1, published],
  );
  const doc = await one(
    sql,
    `insert into required_documents (newsroom_id, hsds_id, service_id, document, published)
     values ($1, 'doc-1', $2, 'Photo ID', $3) returning id`,
    [n, s1, published],
  );
  const lang = await one(
    sql,
    `insert into languages (newsroom_id, hsds_id, service_id, language, published)
     values ($1, 'lang-1', $2, 'Spanish', $3) returning id`,
    [n, s1, published],
  );
  const access = await one(
    sql,
    `insert into accessibilities (newsroom_id, hsds_id, service_id, accessibility, published)
     values ($1, 'acc-1', $2, 'Ramp at the front door', $3) returning id`,
    [n, s1, published],
  );
  const contact = (hsds: string, column: string, value: number, phone: string) =>
    one(
      sql,
      `insert into contacts (newsroom_id, hsds_id, ${column}, name, phone, published)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [n, hsds, value, `Contact ${hsds}`, phone, published],
    );
  const ownContact = await contact("c-own", "service_id", s1, "555-0101");
  const orgContact = await contact("c-org", "organization_id", orgA, "555-0102");
  const locContact = await contact("c-loc", "location_id", l1, "555-0103");
  await contact("c-other", "service_id", s3, "555-0199");
  return {
    n, orgA, orgB, s1, s2, s3, l1, l2, otherOrgPlace, link1, link2, sc1, sc2, sc3,
    elig, doc, lang, access, ownContact, orgContact, locContact,
  };
}

async function rowCount(sql: TestSql, table: string, n: number): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    `select count(*)::text as count from ${table} where newsroom_id = $1`,
    [n],
  );
  return Number(rows[0]!.count);
}

async function publicEntry(sql: TestSql, n: number, serviceId: number) {
  const page = await listPublicRegistry(sql, n);
  return page.entries.find((entry) => entry.serviceId === serviceId);
}

const REMOVED_ROWS = (s: Seed): [RemovableKind, number][] => [
  ["contact", s.ownContact],
  ["location", s.link1],
  ["schedule", s.sc1],
  ["eligibility", s.elig],
  ["requiredDocument", s.doc],
  ["language", s.lang],
  ["accessibility", s.access],
];

test("migration 0165 is additive, safe to run twice, and removes nothing that exists", async () => {
  const sql = await getSql();
  const seeded = await seed(9701, true);
  const text = readFileSync(new URL("../../../../migrations/0165_resource_child_removed.sql", import.meta.url), "utf8");
  const pg = await getPglite();
  await pg.exec(text);
  await pg.exec(text);
  for (const table of [
    "contacts", "service_at_locations", "schedules", "eligibilities",
    "required_documents", "languages", "accessibilities",
  ]) {
    const cols = await sql.query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_name = $1 and column_name in ('removed_at', 'removed_by')
        order by column_name`,
      [table],
    );
    assert.deepEqual(cols.map((c) => [c.column_name, c.is_nullable]), [
      ["removed_at", "YES"],
      ["removed_by", "YES"],
    ], table);
    const marked = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = 9701 and removed_at is not null`,
      [],
    );
    assert.equal(Number(marked[0]!.count), 0, `${table}: an existing row has no marker`);
  }
  const placeCols = await sql.query(
    "select 1 from information_schema.columns where table_name = 'locations' and column_name = 'removed_at'",
    [],
  );
  assert.equal(placeCols.length, 0, "a place is shared, so it has no marker");
  assert.ok(seeded.s1);
});

test("the detail reader lists the rows of each group, what is shared, and the places left to link", async () => {
  const sql = await getSql();
  const s = await seed(9702);
  const detail = (await getRegistryEntryDetail(sql, 9702, s.s1))!;
  assert.deepEqual(detail.places.map((p) => [p.id, p.locationId, p.fields.name]), [
    [s.link1, s.l1, "Main Hall"],
  ]);
  assert.deepEqual(detail.places[0]!.sharedWith, [
    { serviceId: s.s2, name: "Helping Hands — Clothing Closet" },
  ]);
  assert.deepEqual(detail.schedules.map((x) => [x.id, x.fields.days, x.locationName]), [
    [s.sc1, "Monday", null],
    [s.sc2, "Tuesday", "Main Hall"],
    [s.sc3, "Wednesday", "Main Hall"],
  ]);
  assert.deepEqual(detail.schedules[0]!.sharedWith, [], "the service's own hours are not shared");
  assert.deepEqual(detail.schedules[2]!.sharedWith, [
    { serviceId: s.s2, name: "Helping Hands — Clothing Closet" },
  ], "hours both entries' place links use");
  assert.equal(detail.eligibilities[0]!.fields.description, "Residents of the county");
  assert.equal(detail.requiredDocuments[0]!.fields.document, "Photo ID");
  assert.equal(detail.requiredDocuments[0]!.fields.required, true);
  assert.equal(detail.languages[0]!.fields.language, "Spanish");
  assert.equal(detail.accessibilities[0]!.fields.accessibility, "Ramp at the front door");
  assert.deepEqual(detail.linkablePlaces.map((p) => p.locationId), [s.l2]);
  assert.deepEqual(detail.removed, []);
  const alone = (await getRegistryEntryDetail(sql, 9702, s.s3))!;
  assert.deepEqual(alone.places, []);
  assert.deepEqual(alone.linkablePlaces.map((p) => p.locationId), [s.otherOrgPlace]);
});

test("changing a place writes only the fields sent, on the shared place, and stamps nothing", async () => {
  const sql = await getSql();
  const s = await seed(9703, true);
  await sql.query("update locations set name = 'Changed elsewhere' where id = $1", [s.l1]);
  const result = await saveEntryRowIn(sql, 9703, s.s1, {
    kind: "location", rowId: s.link1, fields: { city: "Denver" },
  }, "ed-1");
  assert.equal(result.ok, true);
  const [place] = await sql.query<{ name: string; city: string; published: boolean; last_verified_by: string | null }>(
    "select name, city, published, last_verified_by from locations where id = $1", [s.l1]);
  assert.deepEqual({ ...place }, {
    name: "Changed elsewhere", city: "Denver", published: true, last_verified_by: null,
  });
  const other = (await getRegistryEntryDetail(sql, 9703, s.s2))!;
  assert.equal(other.places[0]!.fields.city, "Denver", "the other entry sees the shared change");
  const [service] = await sql.query<{ last_verified_by: string | null; published: boolean }>(
    "select last_verified_by, published from services where id = $1", [s.s1]);
  assert.deepEqual({ ...service }, { last_verified_by: null, published: true });
});

test("adding a row to an unpublished entry leaves it unpublished and stamps only the tables that have a stamp", async () => {
  const sql = await getSql();
  const s = await seed(9704);
  const before = await rowCount(sql, "service_at_locations", 9704);
  for (const input of [
    { kind: "eligibility", fields: { description: "Anyone over 18" } },
    { kind: "requiredDocument", fields: { document: "Lease", description: "Current" } },
    { kind: "language", fields: { language: "Vietnamese", note: "Tuesdays" } },
    { kind: "accessibility", fields: { accessibility: "Elevator" } },
    { kind: "schedule", fields: { days: "Friday", opensAt: "8:00", closesAt: "12:00" } },
    { kind: "schedule", locationId: s.l1, fields: { byAppointment: true } },
    { kind: "location", fields: { name: "Church basement", address1: "9 Pine St", city: "Lyons" } },
  ] as const) {
    const result = await saveEntryRowIn(sql, 9704, s.s1, input, "ed-1");
    assert.equal(result.ok, true, JSON.stringify(input));
  }
  const detail = (await getRegistryEntryDetail(sql, 9704, s.s1))!;
  assert.equal(detail.eligibilities.length, 2);
  assert.equal(detail.requiredDocuments.length, 2);
  assert.equal(detail.languages.length, 2);
  assert.equal(detail.accessibilities.length, 2);
  assert.equal(detail.schedules.length, 5);
  assert.equal(detail.places.length, 2);
  assert.equal(await rowCount(sql, "service_at_locations", 9704), before + 1, "one new link");
  const added = detail.schedules.find((x) => x.fields.byAppointment === true)!;
  assert.equal(added.locationName, "Main Hall", "tied to the chosen place");

  for (const table of ["eligibilities", "required_documents", "languages", "accessibilities", "schedules", "service_at_locations", "locations"]) {
    const rows = await sql.query<{ published: boolean }>(
      `select published from ${table} where newsroom_id = 9704 and hsds_id like 'desk-%'`, []);
    assert.ok(rows.length >= 1, `${table} has a desk row`);
    assert.ok(rows.every((r) => r.published === false), `${table}: a new row of an unpublished entry is unpublished`);
  }
  for (const table of ["eligibilities", "required_documents", "schedules", "locations"]) {
    const rows = await sql.query<{ last_verified_by: string | null; verification_method: string | null }>(
      `select last_verified_by, verification_method from ${table}
        where newsroom_id = 9704 and hsds_id like 'desk-%'`, []);
    assert.ok(rows.every((r) => r.last_verified_by === "ed-1" && r.verification_method === "editor"), table);
  }
  const [place] = await sql.query<{ status: string; organization_id: number }>(
    "select status, organization_id from locations where newsroom_id = 9704 and name = 'Church basement'", []);
  assert.deepEqual({ ...place }, { status: "unverified", organization_id: s.orgA });
  const [service] = await sql.query<{ last_verified_by: string | null; published: boolean }>(
    "select last_verified_by, published from services where id = $1", [s.s1]);
  assert.deepEqual({ ...service }, { last_verified_by: null, published: false }, "no service stamp");
});

test("a row added to a published entry is published, and a new place is active", async () => {
  const sql = await getSql();
  const s = await seed(9705, true);
  await saveEntryRowIn(sql, 9705, s.s1, { kind: "language", fields: { language: "Arabic" } }, "ed-1");
  await saveEntryRowIn(sql, 9705, s.s1, { kind: "location", fields: { name: "Satellite", address1: "2 Elm St" } }, "ed-1");
  const page = await publicEntry(sql, 9705, s.s1);
  assert.ok(page!.languages.includes("Arabic"));
  assert.ok(page!.locations.some((place) => place.name === "Satellite"), "the new place shows");
});

test("an existing place of the organization can be linked; another organization's cannot", async () => {
  const sql = await getSql();
  const s = await seed(9706);
  const linked = await saveEntryRowIn(sql, 9706, s.s1, { kind: "location", locationId: s.l2, fields: {} }, "ed-1");
  assert.equal(linked.ok, true);
  const detail = (await getRegistryEntryDetail(sql, 9706, s.s1))!;
  assert.deepEqual(detail.places.map((p) => p.locationId), [s.l1, s.l2]);
  assert.deepEqual(detail.linkablePlaces, []);
  assert.equal(await rowCount(sql, "locations", 9706), 3, "no place was made");
  await assert.rejects(
    saveEntryRowIn(sql, 9706, s.s1, { kind: "location", locationId: s.otherOrgPlace, fields: {} }, "ed-1"),
    /not one of this organization's/);
  await assert.rejects(
    saveEntryRowIn(sql, 9706, s.s1, { kind: "location", locationId: s.l1, fields: {} }, "ed-1"),
    /already part of this entry/);
  await assert.rejects(
    saveEntryRowIn(sql, 9706, s.s3, { kind: "schedule", locationId: s.l1, fields: { days: "Monday" } }, "ed-1"),
    /not part of this entry/);
});

test("a save with bad fields returns problems by field and writes nothing", async () => {
  const sql = await getSql();
  const s = await seed(9707);
  const tables = ["eligibilities", "required_documents", "languages", "accessibilities", "schedules", "locations", "service_at_locations"];
  const counts = async () => Promise.all(tables.map((t) => rowCount(sql, t, 9707)));
  const before = await counts();
  const cases: [Parameters<typeof saveEntryRowIn>[3], string][] = [
    [{ kind: "eligibility", fields: { description: "  " } }, "description"],
    [{ kind: "requiredDocument", fields: { document: "" } }, "document"],
    [{ kind: "requiredDocument", fields: { document: "x".repeat(201) } }, "document"],
    [{ kind: "language", fields: { language: "" } }, "language"],
    [{ kind: "language", fields: { language: "Span\u0000ish" } }, "language"],
    [{ kind: "accessibility", fields: { accessibility: "" } }, "accessibility"],
    [{ kind: "schedule", fields: {} }, "form"],
    [{ kind: "schedule", fields: { days: "x".repeat(201) } }, "days"],
    [{ kind: "location", fields: {} }, "form"],
    [{ kind: "location", fields: { name: "Hall\tTwo" } }, "name"],
  ];
  for (const [input, field] of cases) {
    const problems = refused(await saveEntryRowIn(sql, 9707, s.s1, input, "ed-1"));
    assert.ok(problems[field], `${input.kind}: a problem on ${field}`);
  }
  assert.deepEqual(await counts(), before, "nothing was written");
  // A change that blanks a required field is refused too, and keeps the row.
  const problems = refused(await saveEntryRowIn(sql, 9707, s.s1, { kind: "language", rowId: s.lang, fields: { language: "" } }, "ed-1"));
  assert.ok(problems.language);
  const [lang] = await sql.query<{ language: string }>("select language from languages where id = $1", [s.lang]);
  assert.equal(lang!.language, "Spanish");
  // Notes on a required-document row may be cleared; "required" is a flag.
  const ok = await saveEntryRowIn(sql, 9707, s.s1, { kind: "requiredDocument", rowId: s.doc, fields: { required: false } }, "ed-1");
  assert.equal(ok.ok, true);
  const [doc] = await sql.query<{ required: boolean; document: string }>("select required, document from required_documents where id = $1", [s.doc]);
  assert.deepEqual({ ...doc }, { required: false, document: "Photo ID" });
});

test("every row save, remove and restore refuses another newsroom's service and a row that is not this entry's", async () => {
  const sql = await getSql();
  const mine = await seed(9708);
  const theirs = await seed(9709);
  await assert.rejects(saveEntryRowIn(sql, 9708, theirs.s1, { kind: "language", fields: { language: "X" } }, "u"), /not in this newsroom/);
  await assert.rejects(removeEntryRowIn(sql, 9708, theirs.s1, { kind: "language", rowId: theirs.lang }, "u"), /not in this newsroom/);
  await assert.rejects(restoreEntryRowIn(sql, 9708, theirs.s1, { kind: "language", rowId: theirs.lang }, "u"), /not in this newsroom/);
  // Another newsroom's row id through my own service.
  await assert.rejects(removeEntryRowIn(sql, 9708, mine.s1, { kind: "language", rowId: theirs.lang }, "u"), /not part of this entry/);
  await assert.rejects(saveEntryRowIn(sql, 9708, mine.s1, { kind: "language", rowId: theirs.lang, fields: { note: "x" } }, "u"), /not part of this entry/);
  // Another service's row in the same newsroom.
  await assert.rejects(removeEntryRowIn(sql, 9708, mine.s3, { kind: "language", rowId: mine.lang }, "u"), /not part of this entry/);
  await assert.rejects(removeEntryRowIn(sql, 9708, mine.s1, { kind: "contact", rowId: mine.ownContact + 3 }, "u"), /not part of this entry/);
  await assert.rejects(removeEntryRowIn(sql, 9708, mine.s1, { kind: "nonsense" as RemovableKind, rowId: 1 }, "u"), /cannot be changed here/);
  for (const id of [mine.lang, theirs.lang]) {
    const [row] = await sql.query<{ removed_at: unknown }>("select removed_at from languages where id = $1", [id]);
    assert.equal(row!.removed_at, null);
  }
});

test("remove marks a row of every kind, deletes nothing, lists it as removed, and restore brings it back", async () => {
  const sql = await getSql();
  const s = await seed(9710);
  const tables: Record<string, string> = {
    contact: "contacts", location: "service_at_locations", schedule: "schedules", eligibility: "eligibilities",
    requiredDocument: "required_documents", language: "languages", accessibility: "accessibilities",
  };
  const before = await getRegistryEntryDetail(sql, 9710, s.s1);
  const counts = Object.values(tables).map((t) => rowCount(sql, t, 9710));
  const countsBefore = await Promise.all(counts);
  for (const [kind, rowId] of REMOVED_ROWS(s)) {
    const result = await removeEntryRowIn(sql, 9710, s.s1, { kind, rowId }, "ed-9");
    assert.equal(result.ok, true, kind);
    const [row] = await sql.query<{ removed_at: unknown; removed_by: string | null }>(
      `select removed_at, removed_by from ${tables[kind]} where id = $1`, [rowId]);
    assert.ok(row!.removed_at, `${kind}: marked`);
    assert.equal(row!.removed_by, "ed-9");
    // Saying it twice changes nothing and is not an error.
    assert.equal((await removeEntryRowIn(sql, 9710, s.s1, { kind, rowId }, "ed-8")).ok, true);
    const [again] = await sql.query<{ removed_by: string | null }>(`select removed_by from ${tables[kind]} where id = $1`, [rowId]);
    assert.equal(again!.removed_by, "ed-9");
  }
  assert.deepEqual(await Promise.all(Object.values(tables).map((t) => rowCount(sql, t, 9710))), countsBefore, "nothing was deleted");
  assert.equal(await rowCount(sql, "locations", 9710), 3, "the place itself stays");

  const during = (await getRegistryEntryDetail(sql, 9710, s.s1))!;
  assert.ok(!during.contacts.some((c) => c.id === s.ownContact));
  assert.deepEqual(during.places, []);
  assert.ok(!during.schedules.some((x) => x.id === s.sc1));
  assert.deepEqual([during.eligibilities, during.requiredDocuments, during.languages, during.accessibilities].map((l) => l.length), [0, 0, 0, 0]);
  assert.deepEqual(during.removed.map((r) => [r.kind, r.id, r.label]).sort(), [
    ["accessibility", s.access, "Ramp at the front door"],
    ["contact", s.ownContact, "Contact c-own, phone 555-0101"],
    ["eligibility", s.elig, "Residents of the county"],
    ["language", s.lang, "Spanish"],
    ["location", s.link1, "Main Hall, 1 Main St, Longmont"],
    ["requiredDocument", s.doc, "Photo ID"],
    ["schedule", s.sc1, "Monday, 9:00 to 17:00"],
  ].sort());
  assert.deepEqual(during.linkablePlaces.map((p) => p.locationId), [s.l1, s.l2], "a removed link can be made again");
  const sibling = (await getRegistryEntryDetail(sql, 9710, s.s2))!;
  assert.equal(sibling.places.length, 1, "the other entry keeps its own link to the place");

  for (const [kind, rowId] of REMOVED_ROWS(s)) {
    assert.equal((await restoreEntryRowIn(sql, 9710, s.s1, { kind, rowId }, "ed-9")).ok, true, kind);
    const [row] = await sql.query<{ removed_at: unknown; removed_by: string | null }>(
      `select removed_at, removed_by from ${tables[kind]} where id = $1`, [rowId]);
    assert.deepEqual({ ...row }, { removed_at: null, removed_by: null });
  }
  assert.deepEqual(await getRegistryEntryDetail(sql, 9710, s.s1), before, "restored: the entry reads as it did");
});

test("removing a shared row removes it for every entry that uses it, and says so in the removed list", async () => {
  const sql = await getSql();
  const s = await seed(9711);
  await removeEntryRowIn(sql, 9711, s.s1, { kind: "contact", rowId: s.orgContact }, "ed-1");
  await removeEntryRowIn(sql, 9711, s.s1, { kind: "schedule", rowId: s.sc3 }, "ed-1");
  const sibling = (await getRegistryEntryDetail(sql, 9711, s.s2))!;
  assert.ok(!sibling.contacts.some((c) => c.id === s.orgContact));
  assert.ok(!sibling.schedules.some((x) => x.id === s.sc3));
  const mine = (await getRegistryEntryDetail(sql, 9711, s.s1))!;
  const removedContact = mine.removed.find((r) => r.kind === "contact")!;
  assert.deepEqual(removedContact.sharedWith, [{ serviceId: s.s2, name: "Helping Hands — Clothing Closet" }]);
  assert.deepEqual(mine.removed.find((r) => r.kind === "schedule")!.sharedWith, [
    { serviceId: s.s2, name: "Helping Hands — Clothing Closet" },
  ]);
});

test("removing a row of a published entry takes it off the public page at once; restoring puts it back", async () => {
  const sql = await getSql();
  const s = await seed(9712, true);
  const before = (await publicEntry(sql, 9712, s.s1))!;
  assert.deepEqual(before.servicePhones, ["555-0101"]);
  assert.deepEqual(before.organizationPhones, ["555-0102"]);
  assert.deepEqual(before.languages, ["Spanish"]);
  assert.equal(before.serviceHours.length, 1);
  assert.equal(before.locations.length, 1);
  assert.deepEqual(before.locations[0]!.phones, ["555-0103"]);
  assert.equal(before.locations[0]!.hours.length, 2, "Tuesday (its own) and Wednesday (through the link)");

  // Each kind the page reads, one at a time.
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "contact", rowId: s.ownContact }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.servicePhones, []);
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "contact", rowId: s.orgContact }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.organizationPhones, []);
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "contact", rowId: s.locContact }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.locations[0]!.phones, []);
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "language", rowId: s.lang }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.languages, []);
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "schedule", rowId: s.sc1 }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.serviceHours, []);
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "schedule", rowId: s.sc2 }, "ed-1");
  assert.equal((await publicEntry(sql, 9712, s.s1))!.locations[0]!.hours.length, 1);
  // The schedule both links point at: removed, it is gone from both entries.
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "schedule", rowId: s.sc3 }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.locations[0]!.hours, []);
  assert.deepEqual((await publicEntry(sql, 9712, s.s2))!.locations[0]!.hours, []);
  // The link: the place is gone from this entry only.
  await removeEntryRowIn(sql, 9712, s.s1, { kind: "location", rowId: s.link1 }, "ed-1");
  assert.deepEqual((await publicEntry(sql, 9712, s.s1))!.locations, []);
  assert.equal((await publicEntry(sql, 9712, s.s2))!.locations.length, 1);
  // Eligibility, documents and accessibility are not on the public page; they are removed all the same.
  for (const [kind, rowId] of [["eligibility", s.elig], ["requiredDocument", s.doc], ["accessibility", s.access]] as const) {
    assert.equal((await removeEntryRowIn(sql, 9712, s.s1, { kind, rowId }, "ed-1")).ok, true);
  }

  // The place's own contact is listed under the place, so the link comes back first.
  for (const [kind, rowId] of [
    ["location", s.link1], ["contact", s.ownContact], ["contact", s.orgContact], ["contact", s.locContact],
    ["language", s.lang], ["schedule", s.sc1], ["schedule", s.sc2], ["schedule", s.sc3],
  ] as const) {
    await restoreEntryRowIn(sql, 9712, s.s1, { kind, rowId }, "ed-1");
  }
  assert.deepEqual(await publicEntry(sql, 9712, s.s1), before, "restored: the public entry is as it was");
});

test("publish skips a removed row; restoring it and publishing again publishes it", async () => {
  const sql = await getSql();
  const s = await seed(9713);
  for (const [kind, rowId] of [
    ["language", s.lang], ["contact", s.ownContact], ["contact", s.orgContact], ["schedule", s.sc1],
    ["location", s.link1], ["eligibility", s.elig],
  ] as const) {
    await removeEntryRowIn(sql, 9713, s.s1, { kind, rowId }, "ed-1");
  }
  await publishRegistryEntryIn(sql, 9713, s.s1, "ed-1");
  const flag = async (table: string, id: number) =>
    (await sql.query<{ published: boolean }>(`select published from ${table} where id = $1`, [id]))[0]!.published;
  assert.equal(await flag("languages", s.lang), false);
  assert.equal(await flag("contacts", s.ownContact), false);
  assert.equal(await flag("contacts", s.orgContact), false);
  assert.equal(await flag("schedules", s.sc1), false);
  assert.equal(await flag("service_at_locations", s.link1), false);
  assert.equal(await flag("eligibilities", s.elig), false, "publish never reached eligibility rows");
  assert.equal(await flag("services", s.s1), true);
  assert.equal(await flag("service_at_locations", s.link2), false, "another entry's link is not this publish's");
  const page = (await publicEntry(sql, 9713, s.s1))!;
  assert.deepEqual([page.languages, page.servicePhones, page.organizationPhones, page.locations], [[], [], [], []]);

  for (const [kind, rowId] of [
    ["language", s.lang], ["contact", s.ownContact], ["contact", s.orgContact], ["schedule", s.sc1],
    ["location", s.link1],
  ] as const) {
    await restoreEntryRowIn(sql, 9713, s.s1, { kind, rowId }, "ed-1");
  }
  await publishRegistryEntryIn(sql, 9713, s.s1, "ed-1");
  assert.equal(await flag("languages", s.lang), true);
  assert.equal(await flag("contacts", s.ownContact), true);
  assert.equal(await flag("service_at_locations", s.link1), true);
  const again = (await publicEntry(sql, 9713, s.s1))!;
  assert.deepEqual(again.languages, ["Spanish"]);
  assert.deepEqual(again.servicePhones, ["555-0101"]);
  assert.equal(again.locations.length, 1);
});

test("a removal does not stamp the service or change anything but the marker", async () => {
  const sql = await getSql();
  const s = await seed(9714, true);
  const snapshot = async () =>
    (await sql.query<Record<string, unknown>>(
      "select name, published, last_verified_by, verification_method from services where id = $1", [s.s1]))[0];
  const before = await snapshot();
  await removeEntryRowIn(sql, 9714, s.s1, { kind: "language", rowId: s.lang }, "ed-1");
  await restoreEntryRowIn(sql, 9714, s.s1, { kind: "language", rowId: s.lang }, "ed-1");
  assert.deepEqual(await snapshot(), before);
  const [lang] = await sql.query<{ language: string; published: boolean }>("select language, published from languages where id = $1", [s.lang]);
  assert.deepEqual({ ...lang }, { language: "Spanish", published: true });
});

test("a row save or a removal that fails part-way writes nothing", async () => {
  const sql = await getSql();
  const s = await seed(9715);
  await sql.query(
    `create or replace function test_fail_rows() returns trigger as $$
     begin
       if tg_table_name = 'service_at_locations' and new.hsds_id like 'desk-link-%' then
         raise exception 'link failed'; end if;
       if tg_table_name = 'languages' and new.removed_by = 'fail-user' then
         raise exception 'marker failed'; end if;
       if tg_table_name = 'schedules' and new.notes = 'Half' then
         raise exception 'schedule failed'; end if;
       return new;
     end $$ language plpgsql`, []);
  await sql.query("create trigger fail_rows_sal before insert on service_at_locations for each row execute function test_fail_rows()", []);
  await sql.query("create trigger fail_rows_lang before update on languages for each row execute function test_fail_rows()", []);
  await sql.query("create trigger fail_rows_sch before insert or update on schedules for each row execute function test_fail_rows()", []);
  const placesBefore = await rowCount(sql, "locations", 9715);
  try {
    // The place is inserted, then its link fails: the place must not stay.
    await assert.rejects(
      saveEntryRowIn(sql, 9715, s.s1, { kind: "location", fields: { name: "Half a place" } }, "ed-1"),
      /link failed/);
    await assert.rejects(
      saveEntryRowIn(sql, 9715, s.s1, { kind: "schedule", fields: { days: "Monday", notes: "Half" } }, "ed-1"),
      /schedule failed/);
    await assert.rejects(
      saveEntryRowIn(sql, 9715, s.s1, { kind: "schedule", rowId: s.sc1, fields: { notes: "Half" } }, "ed-1"),
      /schedule failed/);
    await assert.rejects(
      removeEntryRowIn(sql, 9715, s.s1, { kind: "language", rowId: s.lang }, "fail-user"),
      /marker failed/);
  } finally {
    await sql.query("drop trigger fail_rows_sal on service_at_locations", []);
    await sql.query("drop trigger fail_rows_lang on languages", []);
    await sql.query("drop trigger fail_rows_sch on schedules", []);
    await sql.query("drop function test_fail_rows()", []);
  }
  assert.equal(await rowCount(sql, "locations", 9715), placesBefore, "the new place was rolled back");
  const [schedule] = await sql.query<{ notes: string | null }>("select notes from schedules where id = $1", [s.sc1]);
  assert.equal(schedule!.notes, null);
  assert.equal((await sql.query("select 1 from schedules where newsroom_id = 9715 and notes = 'Half'", [])).length, 0);
  const [lang] = await sql.query<{ removed_at: unknown }>("select removed_at from languages where id = $1", [s.lang]);
  assert.equal(lang!.removed_at, null, "the removal was rolled back");
});

test("the contact editor's rules still hold with removal: a removed contact cannot be edited", async () => {
  const sql = await getSql();
  const s = await seed(9716);
  await removeEntryRowIn(sql, 9716, s.s1, { kind: "contact", rowId: s.ownContact }, "ed-1");
  await assert.rejects(
    saveContactIn(sql, 9716, s.s1, { contactId: s.ownContact, fields: { name: "Back door" } }, "ed-1"),
    /not part of this entry/);
  const result = await saveServiceDetailsIn(sql, 9716, s.s1, { name: "Food Pantry 2" }, "ed-1");
  assert.equal(result.ok, true);
});

const sample = JSON.parse(
  readFileSync(new URL("./__fixtures__/sample-bundle.json", import.meta.url), "utf8"),
) as HsdsBundle;

test("an import of the same file leaves removed rows removed: no new row, no proposal, counted as unchanged", async () => {
  const sql = await getSql();
  const n = 9717;
  const directoryName = "removal-directory";
  const first = await importHsdsBundle(structuredClone(sample), { newsroomId: n, directoryName });
  const tables = [
    "contacts", "service_at_locations", "schedules", "eligibilities",
    "required_documents", "languages", "accessibilities",
  ] as const;
  const populated = tables.filter((t) => first.tables[t].inserted > 0);
  assert.ok(populated.length >= 3, `the sample fills several removable tables (${populated.join(", ")})`);
  for (const table of tables) {
    await sql.query(`update ${table} set removed_at = now(), removed_by = 'ed-1' where newsroom_id = $1`, [n]);
  }
  // A stored value that differs from the file: a live row would get a proposal.
  await sql.query("update contacts set name = 'Edited at the desk' where newsroom_id = $1", [n]);
  const countsBefore = await Promise.all(tables.map((t) => rowCount(sql, t, n)));

  const second = await importHsdsBundle(structuredClone(sample), { newsroomId: n, directoryName });
  assert.deepEqual(await Promise.all(tables.map((t) => rowCount(sql, t, n))), countsBefore, "no row was inserted again");
  for (const table of tables) {
    assert.equal(second.tables[table].inserted, 0, table);
    assert.equal(second.tables[table].changed, 0, table);
    assert.equal(second.tables[table].alreadyPending, 0, table);
    assert.equal(second.tables[table].unchanged, first.tables[table].inserted, `${table}: counted as unchanged`);
    const live = await sql.query(`select 1 from ${table} where newsroom_id = $1 and removed_at is null`, [n]);
    assert.equal(live.length, 0, `${table}: still removed`);
  }
  assert.deepEqual(second.conflicts, []);
  assert.equal(await rowCount(sql, "resource_changes", n), 0, "no proposal that would undo the removal");
  const [contact] = await sql.query<{ name: string }>("select name from contacts where newsroom_id = $1 limit 1", [n]);
  assert.equal(contact!.name, "Edited at the desk");

  // The same difference on a row that is not removed still makes a proposal.
  const live = await importHsdsBundle(structuredClone(sample), { newsroomId: n + 1, directoryName });
  assert.ok(live.tables.contacts.inserted > 0);
  await sql.query("update contacts set name = 'Edited at the desk' where newsroom_id = $1", [n + 1]);
  const third = await importHsdsBundle(structuredClone(sample), { newsroomId: n + 1, directoryName });
  assert.ok(third.tables.contacts.changed > 0, "a live row with a changed field is proposed");
});
