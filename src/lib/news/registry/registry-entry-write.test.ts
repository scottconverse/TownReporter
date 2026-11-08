import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  listPublishedRegistryEntries,
  listRegistryCategoryNames,
  listUnpublishedRegistryEntries,
} from "./registry-desk.server.ts";
import { listPublicRegistry } from "./registry-public.server.ts";
import {
  addRegistryEntryIn,
  loadStarterListIn,
  publishRegistryEntryIn,
  takeDownRegistryEntryIn,
  updateRegistryEntryIn,
} from "./registry-desk-write.server.ts";
import {
  normalizeRegistryEntryFields,
  type RegistryEntryFields,
} from "./registry-entry-fields.ts";
import { STARTER_LIST_DIRECTORY } from "./starter-list.ts";

await applyMigrationsToTestPglite();

/** Load the starter list and publish the entry with this HSDS id. */
async function loadAndPublish(
  sql: Awaited<ReturnType<typeof getSql>>,
  newsroomId: number,
  hsdsId: string,
): Promise<number> {
  await loadStarterListIn(sql, newsroomId, "desk-editor");
  const [target] = await sql.query<{ id: number }>(
    "select id from services where newsroom_id = $1 and directory_name = $2 and hsds_id = $3",
    [newsroomId, STARTER_LIST_DIRECTORY, hsdsId],
  );
  assert.ok(target, `${hsdsId} loaded`);
  const serviceId = Number(target!.id);
  await publishRegistryEntryIn(sql, newsroomId, serviceId, "desk-editor");
  return serviceId;
}

function fields(overrides: Partial<RegistryEntryFields> = {}): RegistryEntryFields {
  return {
    organizationName: "OUR Center",
    serviceName: "Help with basic needs",
    categoryName: "Basic needs",
    phone: "303-772-5529",
    description: "Walk-in help and same-day appointments in Longmont.",
    sourceTitle: "OUR Center referral program",
    sourceUrl: "https://www.ourcenter.org/referral-program/",
    ...overrides,
  };
}

test("editing a published entry changes what readers see and keeps it published", async () => {
  const sql = await getSql();
  const newsroomId = 9601;
  const serviceId = await loadAndPublish(sql, newsroomId, "starter-svc-our-center");

  await updateRegistryEntryIn(
    sql,
    newsroomId,
    serviceId,
    fields({
      serviceName: "Help with food and bills",
      phone: "303-772-5530",
      description: "A new line the editor read on the page.",
      categoryName: "Food",
      sourceTitle: "OUR Center, updated page",
      sourceUrl: "https://www.ourcenter.org/updated/",
    }),
    "desk-editor",
  );

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1, "the entry is still on the public page");
  const entry = page.entries[0]!;
  assert.equal(entry.serviceName, "Help with food and bills");
  assert.equal(entry.phone, "303-772-5530");
  assert.equal(entry.description, "A new line the editor read on the page.");
  assert.equal(entry.categoryName, "Food");
  assert.equal(entry.sourceUrl, "https://www.ourcenter.org/updated/");
  assert.equal(entry.sourceTitle, "OUR Center, updated page");

  const [stored] = await sql.query<{
    published: boolean;
    verification_method: string;
    last_verified_by: string;
    last_verified_at: string | null;
  }>(
    "select published, verification_method, last_verified_by, last_verified_at from services where id = $1",
    [serviceId],
  );
  assert.equal(stored!.published, true, "editing does not unpublish");
  assert.equal(stored!.verification_method, "editor");
  assert.equal(stored!.last_verified_by, "desk-editor");
  assert.ok(stored!.last_verified_at, "the save records when the editor verified it");
});

test("editing an organization's name follows only the service's own organization", async () => {
  const sql = await getSql();
  const newsroomId = 9602;
  const serviceId = await loadAndPublish(sql, newsroomId, "starter-svc-our-center");
  const [other] = await sql.query<{ id: number; name: string }>(
    "select id, name from organizations where newsroom_id = $1 and hsds_id = $2",
    [newsroomId, "starter-org-211-colorado"],
  );

  await updateRegistryEntryIn(
    sql,
    newsroomId,
    serviceId,
    fields({ organizationName: "OUR Center of Longmont" }),
    "desk-editor",
  );

  const [own] = await sql.query<{ name: string }>(
    `select o.name from organizations o
       join services s on s.organization_id = o.id
      where s.id = $1`,
    [serviceId],
  );
  assert.equal(own!.name, "OUR Center of Longmont");
  const [untouched] = await sql.query<{ name: string }>(
    "select name from organizations where id = $1",
    [Number(other!.id)],
  );
  assert.equal(untouched!.name, other!.name, "another organization keeps its name");
});

test("a new category name creates one taxonomy row, and the same name in other case reuses it", async () => {
  const sql = await getSql();
  const newsroomId = 9603;
  const serviceId = await loadAndPublish(sql, newsroomId, "starter-svc-our-center");

  const before = await sql.query<{ id: number }>(
    "select id from taxonomies where newsroom_id = $1 and lower(name) = lower($2)",
    [newsroomId, "Food"],
  );
  assert.equal(before.length, 1, "the starter list already made a Food taxonomy");

  await updateRegistryEntryIn(sql, newsroomId, serviceId, fields({ categoryName: "Food" }), "e");
  await updateRegistryEntryIn(sql, newsroomId, serviceId, fields({ categoryName: "food" }), "e");
  const reused = await sql.query<{ id: number }>(
    "select id from taxonomies where newsroom_id = $1 and lower(name) = lower($2)",
    [newsroomId, "Food"],
  );
  assert.equal(reused.length, 1, "reusing a name in another case adds no row");

  await updateRegistryEntryIn(
    sql,
    newsroomId,
    serviceId,
    fields({ categoryName: "Legal help" }),
    "e",
  );
  const created = await sql.query<{ id: number; hsds_id: string; published: boolean }>(
    "select id, hsds_id, published from taxonomies where newsroom_id = $1 and name = $2",
    [newsroomId, "Legal help"],
  );
  assert.equal(created.length, 1, "a new name makes exactly one taxonomy row");
  assert.equal(created[0]!.hsds_id, "desk-tax-legal-help");
  assert.equal(created[0]!.published, true);

  const names = await listRegistryCategoryNames(sql, newsroomId);
  assert.ok(names.includes("Legal help"));
});

test("an edit from another newsroom is refused and changes nothing", async () => {
  const sql = await getSql();
  const owner = 9604;
  const other = 9605;
  const serviceId = await loadAndPublish(sql, owner, "starter-svc-our-center");
  const [beforeRow] = await sql.query<{ name: string }>(
    "select name from services where id = $1",
    [serviceId],
  );

  await assert.rejects(
    () => updateRegistryEntryIn(sql, other, serviceId, fields({ serviceName: "Changed" }), "x"),
    /not in this newsroom/i,
  );

  const [afterRow] = await sql.query<{ name: string; published: boolean }>(
    "select name, published from services where id = $1",
    [serviceId],
  );
  assert.equal(afterRow!.name, beforeRow!.name);
  assert.equal(afterRow!.published, true);
});

test("an edit to a missing entry is refused and changes nothing", async () => {
  const sql = await getSql();
  await assert.rejects(
    () => updateRegistryEntryIn(sql, 9606, 987654, fields(), "x"),
    /not in this newsroom/i,
  );
});

test("a missing required field is refused before anything is written", async () => {
  assert.throws(() => normalizeRegistryEntryFields({ ...fields(), serviceName: "   " }), /service/i);
  assert.throws(() => normalizeRegistryEntryFields({ ...fields(), organizationName: "" }), /organization/i);
  assert.throws(() => normalizeRegistryEntryFields({ ...fields(), categoryName: "" }), /category/i);
  assert.throws(() => normalizeRegistryEntryFields({ ...fields(), sourceUrl: "" }), /source url/i);
  assert.throws(
    () => normalizeRegistryEntryFields({ ...fields(), sourceUrl: "www.example.org" }),
    /https:\/\//i,
  );
  const trimmed = normalizeRegistryEntryFields({ ...fields(), phone: "  211  ", description: "  " });
  assert.equal(trimmed.phone, "211");
  assert.equal(trimmed.description, "");
});

test("adding an entry lands it in the waiting list, and publishing it shows its own phone and page", async () => {
  const sql = await getSql();
  const newsroomId = 9607;

  const added = await addRegistryEntryIn(
    sql,
    newsroomId,
    fields({
      organizationName: "Longmont Community Fridge",
      serviceName: "Free food, no questions",
      categoryName: "Food",
      phone: "303-555-0100",
      description: "A fridge outside the church, open every day.",
      sourceTitle: "Longmont Community Fridge",
      sourceUrl: "https://example.org/longmont-fridge/",
    }),
    "desk-editor",
  );

  const waiting = await listUnpublishedRegistryEntries(sql, newsroomId);
  assert.equal(waiting.length, 1, "the new entry is waiting");
  assert.equal(waiting[0]!.serviceId, added.serviceId);
  assert.equal(waiting[0]!.serviceName, "Free food, no questions");
  assert.equal(waiting[0]!.phone, "303-555-0100");
  assert.equal(waiting[0]!.sourceUrl, "https://example.org/longmont-fridge/");

  const publicBefore = await listPublicRegistry(sql, newsroomId);
  assert.equal(publicBefore.entries.length, 0, "adding publishes nothing");

  const [stored] = await sql.query<{ published: boolean; status: string; verification_method: string }>(
    "select published, status, verification_method from services where id = $1",
    [added.serviceId],
  );
  assert.equal(stored!.published, false);
  assert.equal(stored!.status, "unverified");
  assert.equal(stored!.verification_method, "editor");

  await publishRegistryEntryIn(sql, newsroomId, added.serviceId, "desk-editor");

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0]!.phone, "303-555-0100");
  assert.equal(page.entries[0]!.sourceUrl, "https://example.org/longmont-fridge/");
  assert.equal(page.entries[0]!.sourceTitle, "Longmont Community Fridge");
  assert.equal(page.entries[0]!.categoryName, "Food");
});

test("adding an entry reuses the newsroom's organization with the same name in another case", async () => {
  const sql = await getSql();
  const newsroomId = 9608;
  await loadStarterListIn(sql, newsroomId, "desk-editor");

  const before = await sql.query<{ id: number }>(
    "select id from organizations where newsroom_id = $1 and lower(name) = lower($2)",
    [newsroomId, "OUR Center"],
  );
  assert.equal(before.length, 1);

  const added = await addRegistryEntryIn(
    sql,
    newsroomId,
    fields({ organizationName: "  our center ", serviceName: "A second service" }),
    "desk-editor",
  );

  const after = await sql.query<{ id: number }>(
    "select id from organizations where newsroom_id = $1 and lower(name) = lower($2)",
    [newsroomId, "OUR Center"],
  );
  assert.equal(after.length, 1, "no second organization was made");
  const [row] = await sql.query<{ organization_id: number }>(
    "select organization_id from services where id = $1",
    [added.serviceId],
  );
  assert.equal(Number(row!.organization_id), Number(before[0]!.id), "the new service hangs off it");
});

test("taking an entry down returns it to the waiting list, leaves its organization, and deletes nothing", async () => {
  const sql = await getSql();
  const newsroomId = 9609;
  const serviceId = await loadAndPublish(sql, newsroomId, "starter-svc-hunger-free-hotline");

  const counts = async () => {
    const [services] = await sql.query<{ count: string }>(
      "select count(*)::text as count from services where newsroom_id = $1",
      [newsroomId],
    );
    const [organizations] = await sql.query<{ count: string }>(
      "select count(*)::text as count from organizations where newsroom_id = $1",
      [newsroomId],
    );
    const [contacts] = await sql.query<{ count: string }>(
      "select count(*)::text as count from contacts where newsroom_id = $1",
      [newsroomId],
    );
    return {
      services: Number(services!.count),
      organizations: Number(organizations!.count),
      contacts: Number(contacts!.count),
    };
  };
  const before = await counts();

  const [organizationBefore] = await sql.query<{ id: number; name: string; published: boolean }>(
    `select o.id, o.name, o.published from organizations o
       join services s on s.organization_id = o.id
      where s.id = $1`,
    [serviceId],
  );

  await takeDownRegistryEntryIn(sql, newsroomId, serviceId, "desk-editor");

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 0, "the entry left the public page");

  const waiting = await listUnpublishedRegistryEntries(sql, newsroomId);
  assert.ok(waiting.some((row) => row.serviceId === serviceId), "it is back in the waiting list");

  assert.deepEqual(await counts(), before, "no row was deleted");

  const [organizationAfter] = await sql.query<{ id: number; name: string; published: boolean }>(
    "select id, name, published from organizations where id = $1",
    [Number(organizationBefore!.id)],
  );
  assert.deepEqual(organizationAfter, organizationBefore, "the organization is unchanged");

  await publishRegistryEntryIn(sql, newsroomId, serviceId, "desk-editor");
  const back = await listPublicRegistry(sql, newsroomId);
  assert.equal(back.entries.length, 1, "Publish brings it back");
  assert.equal(back.entries[0]!.serviceId, serviceId);
});

test("taking down an entry from another newsroom is refused and changes nothing", async () => {
  const sql = await getSql();
  const owner = 9610;
  const other = 9611;
  const serviceId = await loadAndPublish(sql, owner, "starter-svc-our-center");

  await assert.rejects(
    () => takeDownRegistryEntryIn(sql, other, serviceId, "x"),
    /not in this newsroom/i,
  );

  const page = await listPublicRegistry(sql, owner);
  assert.equal(page.entries.length, 1, "the entry is still published");
});

test("the desk lists the published entries it can edit", async () => {
  const sql = await getSql();
  const newsroomId = 9612;
  const serviceId = await loadAndPublish(sql, newsroomId, "starter-svc-our-center");

  const published = await listPublishedRegistryEntries(sql, newsroomId);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.serviceId, serviceId);
  assert.equal(published[0]!.organizationName, "OUR Center");
  assert.equal(published[0]!.categoryName, "Basic needs");
  assert.equal(published[0]!.phone, "303-772-5529");
  assert.equal(published[0]!.sourceUrl, "https://www.ourcenter.org/referral-program/");

  const waiting = await listUnpublishedRegistryEntries(sql, newsroomId);
  assert.equal(waiting.length, 10, "the published entry is not also waiting");
});
