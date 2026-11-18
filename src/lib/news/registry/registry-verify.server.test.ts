import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  addRegistryEntryIn,
  publishRegistryEntryIn,
  takeDownRegistryEntryIn,
  updateRegistryEntryIn,
} from "./registry-desk-write.server.ts";
import {
  removeEntryRowIn,
  saveContactIn,
  saveEntryRowIn,
  saveOrganizationDetailsIn,
  saveServiceDetailsIn,
} from "./registry-entry-editor.server.ts";
import { listPublicRegistry } from "./registry-public.server.ts";
import {
  VERIFY_AFTER_DAYS,
  listNeedsCheckingIn,
  readKeyFacts,
  readVerificationIn,
  recordVerificationIn,
} from "./registry-verify.server.ts";
import { verifyMethodWords } from "./registry-verify-methods.ts";

await applyMigrationsToTestPglite();

type TestSql = Awaited<ReturnType<typeof getSql>>;

async function one(sql: TestSql, text: string, params: unknown[]): Promise<number> {
  const rows = await sql.query<{ id: number }>(text, params);
  return Number(rows[0]!.id);
}

interface Seed {
  n: number;
  org: number;
  svc: number;
  other: number;
  place: number;
  phone: number;
  placePhone: number;
  hours: number;
}

/**
 * One published, active entry with a place (Main Street office), a service
 * phone, a phone at the place, hours at the place, eligibility and a document;
 * and a second published entry of the same organization that has nothing.
 * `legacy` puts an old-style stamp on the service.
 */
async function seed(n: number, opts: { published?: boolean; legacy?: boolean } = {}): Promise<Seed> {
  const sql = await getSql();
  const published = opts.published ?? true;
  const org = await one(
    sql,
    `insert into organizations (newsroom_id, hsds_id, name, status, published)
     values ($1, 'org-1', 'Helping Hands', 'active', $2) returning id`,
    [n, published],
  );
  const svc = await one(
    sql,
    `insert into services (newsroom_id, hsds_id, organization_id, name, description, status,
                           published, fees, application_process)
     values ($1, 'svc-1', $2, 'Food Pantry', 'Groceries for neighbors', 'active', $3, 'Free', 'Walk in')
     returning id`,
    [n, org, published],
  );
  const other = await one(
    sql,
    `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
     values ($1, 'svc-2', $2, 'Clothing Closet', 'active', $3) returning id`,
    [n, org, published],
  );
  const place = await one(
    sql,
    `insert into locations (newsroom_id, hsds_id, organization_id, name, address_1, city, status, published)
     values ($1, 'loc-1', $2, 'Main Street office', '1 Main St', 'Longmont', 'active', $3) returning id`,
    [n, org, published],
  );
  await sql.query(
    `insert into service_at_locations (newsroom_id, hsds_id, service_id, location_id, published)
     values ($1, 'sal-1', $2, $3, $4)`,
    [n, svc, place, published],
  );
  const phone = await one(
    sql,
    `insert into contacts (newsroom_id, hsds_id, service_id, phone, published)
     values ($1, 'c-1', $2, '555-0100', $3) returning id`,
    [n, svc, published],
  );
  const placePhone = await one(
    sql,
    `insert into contacts (newsroom_id, hsds_id, location_id, phone, published)
     values ($1, 'c-2', $2, '555-0200', $3) returning id`,
    [n, place, published],
  );
  const hours = await one(
    sql,
    `insert into schedules (newsroom_id, hsds_id, service_id, location_id, days, opens_at, closes_at, published)
     values ($1, 'sch-1', $2, $3, 'Mon-Fri', '9:00', '17:00', $4) returning id`,
    [n, svc, place, published],
  );
  await sql.query(
    `insert into eligibilities (newsroom_id, hsds_id, service_id, description, published)
     values ($1, 'el-1', $2, 'Longmont residents', $3)`,
    [n, svc, published],
  );
  await sql.query(
    `insert into required_documents (newsroom_id, hsds_id, service_id, document, published)
     values ($1, 'doc-1', $2, 'Photo ID', $3)`,
    [n, svc, published],
  );
  if (opts.legacy) {
    await sql.query(
      `update services set last_verified_at = '2026-01-02T03:04:05Z',
              last_verified_by = 'legacy-editor', verification_method = 'editor' where id = $1`,
      [svc],
    );
  }
  return { n, org, svc, other, place, phone, placePhone, hours };
}

const verifyInput = (serviceId: number, over: Record<string, unknown> = {}) => ({
  serviceId,
  method: "phone",
  basis: "Called the front desk and heard the hours.",
  sourceUrl: "https://example.org/pantry",
  ...over,
});

async function legacyStamp(sql: TestSql, serviceId: number) {
  const [row] = await sql.query<Record<string, unknown>>(
    `select last_verified_at::text as at, last_verified_by, verification_method
       from services where id = $1`,
    [serviceId],
  );
  return { ...row };
}

async function verificationCount(sql: TestSql, newsroomId: number): Promise<number> {
  const [row] = await sql.query<{ n: number }>(
    "select count(*)::int as n from resource_verifications where newsroom_id = $1",
    [newsroomId],
  );
  return row!.n;
}

test("no save, update, publish or add writes the old stamp or a verification", async () => {
  const sql = await getSql();
  const s = await seed(9801, { legacy: true });
  const before = await legacyStamp(sql, s.svc);

  const checks: [string, () => Promise<unknown>][] = [
    [
      "service save",
      () => saveServiceDetailsIn(sql, s.n, s.svc, { name: "Food Pantry 2", fees: "Sliding scale" }, "ed-1"),
    ],
    [
      "identical service save",
      () => saveServiceDetailsIn(sql, s.n, s.svc, { name: "Food Pantry 2" }, "ed-1"),
    ],
    [
      "description spelling change",
      () => saveServiceDetailsIn(sql, s.n, s.svc, { description: "Grocerys for neighbors" }, "ed-1"),
    ],
    ["organization save", () => saveOrganizationDetailsIn(sql, s.n, s.svc, { name: "Helping Hands Inc" }, "ed-1")],
    [
      "contact save",
      () => saveContactIn(sql, s.n, s.svc, { contactId: s.phone, fields: { phone: "555-0111" } }, "ed-1"),
    ],
    [
      "add contact",
      () => saveContactIn(sql, s.n, s.svc, { scope: "service", fields: { name: "Intake", phone: "555-0122" } }, "ed-1"),
    ],
    [
      "add eligibility row",
      () => saveEntryRowIn(sql, s.n, s.svc, { kind: "eligibility", fields: { description: "Adults" } }, "ed-1"),
    ],
    [
      "add place row",
      () => saveEntryRowIn(sql, s.n, s.svc, { kind: "location", fields: { name: "Annex", address1: "2 Pine", city: "Lyons" } }, "ed-1"),
    ],
    [
      "desk update",
      () =>
        updateRegistryEntryIn(
          sql,
          s.n,
          s.svc,
          {
            organizationName: "Helping Hands",
            serviceName: "Food Pantry 3",
            categoryName: "Food",
            phone: "555-0100",
            description: "Groceries",
            sourceTitle: "Page",
            sourceUrl: "https://example.org/page",
          },
          "ed-1",
        ),
    ],
    ["publish", () => publishRegistryEntryIn(sql, s.n, s.svc, "ed-1")],
  ];
  for (const [label, run] of checks) {
    await run();
    assert.deepEqual(await legacyStamp(sql, s.svc), before, `${label}: the legacy stamp is unchanged`);
    assert.equal(await verificationCount(sql, s.n), 0, `${label}: no verification row`);
  }

  // Rows the writers created are not stamped either.
  const stamped = await sql.query<{ n: number }>(
    `select (select count(*) from contacts where newsroom_id = $1 and last_verified_at is not null)
          + (select count(*) from eligibilities where newsroom_id = $1 and last_verified_at is not null)
          + (select count(*) from locations where newsroom_id = $1 and last_verified_at is not null) as n`,
    [s.n],
  );
  assert.equal(Number(stamped[0]!.n), 0, "no new or saved row carries a stamp");

  // A new entry is not stamped.
  const added = await addRegistryEntryIn(
    sql,
    s.n,
    {
      organizationName: "New Org",
      serviceName: "New Service",
      categoryName: "Food",
      phone: "555-0999",
      description: "d",
      sourceTitle: "t",
      sourceUrl: "https://example.org/n",
    },
    "ed-1",
  );
  const fresh = await legacyStamp(sql, added.serviceId);
  assert.deepEqual(fresh, { at: null, last_verified_by: null, verification_method: null });
  const [phone] = await sql.query<{ last_verified_at: unknown }>(
    "select last_verified_at from contacts where service_id = $1",
    [added.serviceId],
  );
  assert.equal(phone!.last_verified_at, null);
});

test("recordVerification writes a row with a snapshot and one audit event", async () => {
  const sql = await getSql();
  const s = await seed(9802);
  const result = await recordVerificationIn(sql, s.n, "ed-7", verifyInput(s.svc));
  assert.equal(result.ok, true);
  const [row] = await sql.query<Record<string, unknown>>(
    "select * from resource_verifications where newsroom_id = $1",
    [s.n],
  );
  assert.equal(row!.service_id, s.svc);
  assert.equal(row!.checked_by, "ed-7");
  assert.equal(row!.method, "phone");
  assert.equal(row!.basis, "Called the front desk and heard the hours.");
  assert.equal(row!.source_url, "https://example.org/pantry");
  const facts = (typeof row!.facts === "string" ? JSON.parse(row!.facts) : row!.facts) as Awaited<
    ReturnType<typeof readKeyFacts>
  >;
  assert.deepEqual(facts, await readKeyFacts(sql, s.n, s.svc));
  assert.equal(facts.service.fees, "Free");
  assert.equal(facts.organization.name, "Helping Hands");
  assert.deepEqual(facts.places.map((p) => [p.name, p.address]), [["Main Street office", "1 Main St, Longmont"]]);
  assert.deepEqual(facts.phones.map((p) => p.phone).sort(), ["555-0100", "555-0200"]);
  assert.equal(facts.hours.length, 1);
  assert.equal(facts.eligibility.length, 1);
  assert.deepEqual(facts.requiredDocuments, [{ document: "Photo ID", required: true }]);
  assert.equal(JSON.stringify(facts).includes("Groceries"), false, "the description is not a key fact");

  const audit = await sql.query<{ user_id: string; action: string; subject_kind: string; subject_id: number }>(
    "select user_id, action, subject_kind, subject_id from audit_events where newsroom_id = $1 and action like 'registry.service.verify'",
    [s.n],
  );
  assert.equal(audit.length, 1);
  assert.deepEqual(
    { ...audit[0]!, subject_id: Number(audit[0]!.subject_id) },
    { user_id: "ed-7", action: "registry.service.verify", subject_kind: "registry-service", subject_id: s.svc },
  );
});

test("recordVerification refuses another newsroom and bad method, basis or address", async () => {
  const sql = await getSql();
  const s = await seed(9803);
  await assert.rejects(
    () => recordVerificationIn(sql, 9999, "ed-1", verifyInput(s.svc)),
    /not in this newsroom\. Nothing was changed\./,
  );
  const bad: [Record<string, unknown>, "method" | "basis" | "sourceUrl"][] = [
    [{ method: "telepathy" }, "method"],
    [{ method: "" }, "method"],
    [{ basis: "   " }, "basis"],
    [{ basis: "x".repeat(2001) }, "basis"],
    [{ basis: "bad \u0000 char" }, "basis"],
    [{ basis: "bell \u0007" }, "basis"],
    [{ sourceUrl: "ftp://example.org" }, "sourceUrl"],
    [{ sourceUrl: "javascript:alert(1)" }, "sourceUrl"],
    [{ sourceUrl: "example.org" }, "sourceUrl"],
  ];
  for (const [over, field] of bad) {
    const result = await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.svc, over));
    assert.equal(result.ok, false, JSON.stringify(over));
    if (!result.ok) assert.ok(result.problems[field], `${JSON.stringify(over)} names ${field}`);
  }
  assert.equal(await verificationCount(sql, s.n), 0);
  const audit = await sql.query("select 1 from audit_events where newsroom_id = $1", [s.n]);
  assert.equal(audit.length, 0, "a refusal writes no audit event");
  // 2000 characters exactly, an empty address and an https address are fine.
  const ok = await recordVerificationIn(
    sql, s.n, "ed-1", verifyInput(s.svc, { basis: "x".repeat(2000), sourceUrl: "" }),
  );
  assert.equal(ok.ok, true);
});

test("changed facts: unchanged none, phone and removed phone listed, description ignored", async () => {
  const sql = await getSql();
  const s = await seed(9804);
  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.svc));
  const names = async () => (await readVerificationIn(sql, s.n, s.svc)).changedFacts;
  assert.deepEqual(await names(), [], "unchanged entry");

  await saveServiceDetailsIn(sql, s.n, s.svc, { description: "Grocerys for neighbours" }, "ed-1");
  assert.deepEqual(await names(), [], "a spelling change in the description is not a key fact");

  await saveContactIn(sql, s.n, s.svc, { contactId: s.phone, fields: { phone: "555-0111" } }, "ed-1");
  const afterPhone = await names();
  assert.deepEqual(afterPhone, ["phone"]);

  await saveContactIn(sql, s.n, s.svc, { contactId: s.phone, fields: { phone: "555-0100" } }, "ed-1");
  assert.deepEqual(await names(), [], "changing it back clears it");

  await saveEntryRowIn(
    sql, s.n, s.svc, { kind: "schedule", rowId: s.hours, fields: { closesAt: "18:00" } }, "ed-1",
  );
  assert.deepEqual(await names(), ["hours at Main Street office"]);
  await saveEntryRowIn(
    sql, s.n, s.svc, { kind: "schedule", rowId: s.hours, fields: { closesAt: "17:00" } }, "ed-1",
  );

  await saveServiceDetailsIn(sql, s.n, s.svc, { fees: "$5" }, "ed-1");
  assert.deepEqual(await names(), ["fees"]);
  await saveServiceDetailsIn(sql, s.n, s.svc, { fees: "Free" }, "ed-1");

  await removeEntryRowIn(sql, s.n, s.svc, { kind: "contact", rowId: s.phone }, "ed-1");
  assert.deepEqual(await names(), ["phone"], "a removed phone (0165) is listed");
  const facts = await readKeyFacts(sql, s.n, s.svc);
  assert.deepEqual(facts.phones.map((p) => p.phone), ["555-0200"], "removed rows are not in the facts");

  await removeEntryRowIn(sql, s.n, s.svc, { kind: "contact", rowId: s.placePhone }, "ed-1");
  assert.deepEqual(await names(), ["phone", "phone at Main Street office"]);
});

test("the same facts always give an identical snapshot", async () => {
  const sql = await getSql();
  const s = await seed(9805);
  const first = JSON.stringify(await readKeyFacts(sql, s.n, s.svc));
  await sql.query("update contacts set updated_at = now() where newsroom_id = $1", [s.n]);
  assert.equal(JSON.stringify(await readKeyFacts(sql, s.n, s.svc)), first);
  await assert.rejects(() => readKeyFacts(sql, 1, s.svc), /not in this newsroom/);
});

test("the history lists newest first, and the legacy stamp is read as legacy", async () => {
  const sql = await getSql();
  const s = await seed(9806, { legacy: true });
  assert.equal((await readVerificationIn(sql, s.n, s.svc)).latest, null);
  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.svc, { method: "website" }));
  await sql.query("update resource_verifications set checked_at = now() - interval '10 days' where newsroom_id = $1", [s.n]);
  await recordVerificationIn(sql, s.n, "ed-2", verifyInput(s.svc, { method: "visit", sourceUrl: null }));
  const read = await readVerificationIn(sql, s.n, s.svc);
  assert.equal(read.latest!.method, "visit");
  assert.equal(read.latest!.checkedBy, "ed-2");
  assert.equal(read.latest!.sourceUrl, null);
  assert.deepEqual(read.history.map((h) => h.method), ["visit", "website"]);
  assert.equal(read.legacy!.method, "editor");
  assert.equal(read.legacy!.by, "legacy-editor");
  assert.ok(read.legacy!.at);
  await assert.rejects(() => readVerificationIn(sql, 1, s.svc), /not in this newsroom/);
});

test("needs checking: never verified, overdue, changed; not fresh or unpublished; oldest first", async () => {
  const sql = await getSql();
  const s = await seed(9807);
  // svc: will be verified; other: never verified; third: unpublished.
  const third = await one(
    sql,
    `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
     values ($1, 'svc-3', $2, 'Unpublished One', 'active', false) returning id`,
    [s.n, s.org],
  );
  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.svc));
  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(third));

  let list = await listNeedsCheckingIn(sql, s.n);
  assert.deepEqual(list.map((i) => i.serviceId), [s.other], "fresh verified and unpublished are not listed");
  assert.deepEqual(list[0]!.reasons, ["Never verified"]);

  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.other));
  assert.deepEqual(await listNeedsCheckingIn(sql, s.n), []);

  // 181 days old is overdue; 179 is not.
  await sql.query(
    "update resource_verifications set checked_at = now() - interval '181 days' where service_id = $1",
    [s.svc],
  );
  await sql.query(
    "update resource_verifications set checked_at = now() - interval '179 days' where service_id = $1",
    [s.other],
  );
  list = await listNeedsCheckingIn(sql, s.n);
  assert.deepEqual(list.map((i) => i.serviceId), [s.svc]);
  assert.match(list[0]!.reasons[0]!, new RegExp(`more than ${VERIFY_AFTER_DAYS} days`));

  // Changed facts: the other entry's fees change; svc is also overdue.
  await saveServiceDetailsIn(sql, s.n, s.other, { fees: "$10" }, "ed-1");
  list = await listNeedsCheckingIn(sql, s.n);
  assert.deepEqual(list.map((i) => i.serviceId), [s.svc, s.other], "oldest first");
  assert.deepEqual(list[1]!.reasons, ["Changed since verified: fees"]);

  // A never-verified entry sorts before every verified one.
  const fourth = await one(
    sql,
    `insert into services (newsroom_id, hsds_id, organization_id, name, status, published)
     values ($1, 'svc-4', $2, 'Brand New', 'active', true) returning id`,
    [s.n, s.org],
  );
  list = await listNeedsCheckingIn(sql, s.n);
  assert.equal(list[0]!.serviceId, fourth);
  // Another newsroom's entries are never listed.
  assert.deepEqual(await listNeedsCheckingIn(sql, 9998), []);
});

test("publish and withdraw each write one audit event with the actor", async () => {
  const sql = await getSql();
  const s = await seed(9808, { published: false });
  await publishRegistryEntryIn(sql, s.n, s.svc, "ed-pub");
  await takeDownRegistryEntryIn(sql, s.n, s.svc, "ed-down");
  const rows = await sql.query<{ user_id: string; action: string; subject_kind: string; subject_id: number; detail: string }>(
    `select user_id, action, subject_kind, subject_id, detail from audit_events
      where newsroom_id = $1 order by id`,
    [s.n],
  );
  assert.deepEqual(
    rows.map((r) => [r.user_id, r.action, r.subject_kind, Number(r.subject_id)]),
    [
      ["ed-pub", "registry.service.publish", "registry-service", s.svc],
      ["ed-down", "registry.service.withdraw", "registry-service", s.svc],
    ],
  );
  assert.match(rows[0]!.detail, /Food Pantry/);
  // A refused call writes nothing.
  await assert.rejects(() => publishRegistryEntryIn(sql, 1, s.svc, "x"), /not in this newsroom/);
  await assert.rejects(() => takeDownRegistryEntryIn(sql, 1, s.svc, "x"), /not in this newsroom/);
  const again = await sql.query("select 1 from audit_events where newsroom_id = $1", [s.n]);
  assert.equal(again.length, 2);
});

test("the public reader returns explicit, legacy-only and none apart", async () => {
  const sql = await getSql();
  const s = await seed(9809);
  const entryOf = async (serviceId: number) => {
    const page = await listPublicRegistry(sql, s.n);
    return page.entries.find((e) => e.serviceId === serviceId)!;
  };
  // none
  let entry = await entryOf(s.svc);
  assert.equal(entry.verifiedAt, null);
  assert.equal(entry.verifiedMethod, null);
  assert.equal(entry.lastVerifiedAt, null);

  // legacy only
  await sql.query("update services set last_verified_at = '2026-01-02T03:04:05Z', verification_method = 'editor' where id = $1", [s.svc]);
  entry = await entryOf(s.svc);
  assert.equal(entry.verifiedAt, null, "a legacy date is not a verification");
  assert.ok(entry.lastVerifiedAt);

  // explicit (newest wins), legacy still returned apart
  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.svc, { method: "website" }));
  await sql.query("update resource_verifications set checked_at = now() - interval '5 days' where newsroom_id = $1", [s.n]);
  await recordVerificationIn(sql, s.n, "ed-1", verifyInput(s.svc, { method: "visit", basis: "Secret desk basis" }));
  entry = await entryOf(s.svc);
  assert.equal(entry.verifiedMethod, "visit");
  assert.ok(entry.verifiedAt);
  assert.ok(entry.lastVerifiedAt);
  assert.equal(JSON.stringify(entry).includes("Secret desk basis"), false, "the basis is never public");
  // The other entry stays unverified.
  assert.equal((await entryOf(s.other)).verifiedAt, null);
});

test("the public words for each method", () => {
  assert.equal(verifyMethodWords("phone"), "by phone");
  assert.equal(verifyMethodWords("website"), "on its website");
  assert.equal(verifyMethodWords("visit"), "in person");
  assert.equal(verifyMethodWords("email"), "by email");
  assert.equal(verifyMethodWords("document"), "from a document");
  assert.equal(verifyMethodWords("organization"), "confirmed by the organization");
  assert.equal(verifyMethodWords("scan"), "");
});

test("legacy values survive every writer and stay readable as legacy", async () => {
  const sql = await getSql();
  const s = await seed(9810, { legacy: true });
  await saveServiceDetailsIn(sql, s.n, s.svc, { name: "Renamed" }, "ed-1");
  await publishRegistryEntryIn(sql, s.n, s.svc, "ed-1");
  const read = await readVerificationIn(sql, s.n, s.svc);
  assert.equal(read.legacy!.by, "legacy-editor");
  assert.equal(read.legacy!.method, "editor");
  assert.equal(read.latest, null, "and still no explicit verification");
});
