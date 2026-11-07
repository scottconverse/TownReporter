import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import { listUnpublishedRegistryEntries } from "./registry-desk.server.ts";
import { listPublicRegistry } from "./registry-public.server.ts";
import { loadStarterListIn, publishRegistryEntryIn } from "./registry-desk-write.server.ts";
import {
  STARTER_ENTRIES,
  STARTER_LIST_DIRECTORY,
  starterServiceId,
} from "./starter-list.ts";

await applyMigrationsToTestPglite();

test("loading the starter list writes eleven unpublished entries, each with its own source", async () => {
  const sql = await getSql();
  const newsroomId = 9501;

  const result = await loadStarterListIn(sql, newsroomId, "starter-editor");
  assert.deepEqual(result, { entries: 11, waiting: 11 });

  const services = await sql.query<{
    hsds_id: string;
    published: boolean;
    source_url: string | null;
    title: string | null;
  }>(
    `select s.hsds_id, s.published, src.url as source_url, src.title
       from services s
       left join sources src on src.id = s.source_id and src.newsroom_id = s.newsroom_id
      where s.newsroom_id = $1 and s.directory_name = $2
      order by s.hsds_id`,
    [newsroomId, STARTER_LIST_DIRECTORY],
  );
  assert.equal(services.length, 11);
  assert.ok(services.every((row) => row.published === false), "nothing is published by loading");

  for (const entry of STARTER_ENTRIES) {
    const row = services.find((item) => item.hsds_id === starterServiceId(entry.key));
    assert.ok(row, `${entry.key} was imported`);
    assert.equal(row!.source_url, entry.sourceUrl, `${entry.key} points at its own page`);
    assert.equal(row!.title, entry.sourceTitle);
  }

  const organizations = await sql.query<{ hsds_id: string; published: boolean; source_url: string }>(
    `select o.hsds_id, o.published, src.url as source_url
       from organizations o
       left join sources src on src.id = o.source_id and src.newsroom_id = o.newsroom_id
      where o.newsroom_id = $1 and o.directory_name = $2`,
    [newsroomId, STARTER_LIST_DIRECTORY],
  );
  assert.equal(organizations.length, 11);
  assert.ok(organizations.every((row) => row.published === false));
  for (const entry of STARTER_ENTRIES) {
    const row = organizations.find((item) => item.hsds_id === `starter-org-${entry.key}`);
    assert.equal(row?.source_url, entry.sourceUrl, `${entry.key}'s organization points at its page`);
  }
});

test("loading the starter list twice adds no rows and no duplicate sources", async () => {
  const sql = await getSql();
  const newsroomId = 9502;

  await loadStarterListIn(sql, newsroomId, "starter-editor");
  await loadStarterListIn(sql, newsroomId, "starter-editor");

  const [services] = await sql.query<{ count: string }>(
    "select count(*)::text as count from services where newsroom_id = $1 and directory_name = $2",
    [newsroomId, STARTER_LIST_DIRECTORY],
  );
  assert.equal(Number(services!.count), 11);

  const [organizations] = await sql.query<{ count: string }>(
    "select count(*)::text as count from organizations where newsroom_id = $1 and directory_name = $2",
    [newsroomId, STARTER_LIST_DIRECTORY],
  );
  assert.equal(Number(organizations!.count), 11);

  const urls = [...new Set(STARTER_ENTRIES.map((entry) => entry.sourceUrl))];
  const [sources] = await sql.query<{ count: string }>(
    "select count(*)::text as count from sources where newsroom_id = $1 and url = any($2::text[])",
    [newsroomId, urls],
  );
  assert.equal(Number(sources!.count), urls.length, "each page has exactly one source row");
});

test("publishing one entry shows exactly that entry in public, with its phone, page and date", async () => {
  const sql = await getSql();
  const newsroomId = 9503;

  await loadStarterListIn(sql, newsroomId, "starter-editor");
  const [target] = await sql.query<{ id: number }>(
    "select id from services where newsroom_id = $1 and directory_name = $2 and hsds_id = $3",
    [newsroomId, STARTER_LIST_DIRECTORY, "starter-svc-our-center"],
  );
  assert.ok(target, "the entry loaded");

  await publishRegistryEntryIn(sql, newsroomId, Number(target!.id), "starter-editor");

  const page = await listPublicRegistry(sql, newsroomId);
  assert.equal(page.entries.length, 1, "the other ten stay hidden");
  const entry = page.entries[0]!;
  assert.equal(entry.organizationName, "OUR Center");
  assert.equal(entry.serviceName, "Help with basic needs");
  assert.equal(entry.phone, "303-772-5529");
  assert.equal(entry.sourceUrl, "https://www.ourcenter.org/referral-program/");
  assert.equal(entry.sourceTitle, "OUR Center referral program");
  assert.deepEqual(entry.languages, ["English", "Spanish"]);
  assert.equal(entry.categoryName, "Basic needs");
  assert.ok(entry.lastVerifiedAt, "publishing records when the editor verified it");

  const waiting = await listUnpublishedRegistryEntries(sql, newsroomId);
  assert.equal(waiting.length, 10, "the published entry left the waiting list");

  const [stored] = await sql.query<{ verification_method: string; last_verified_by: string }>(
    "select verification_method, last_verified_by from services where id = $1",
    [Number(target!.id)],
  );
  assert.equal(stored!.verification_method, "editor");
  assert.equal(stored!.last_verified_by, "starter-editor");
});

test("a service id from another newsroom is refused and changes nothing", async () => {
  const sql = await getSql();
  const ownerNewsroom = 9504;
  const otherNewsroom = 9505;

  await loadStarterListIn(sql, ownerNewsroom, "starter-editor");
  const [target] = await sql.query<{ id: number }>(
    "select id from services where newsroom_id = $1 and directory_name = $2 and hsds_id = $3",
    [ownerNewsroom, STARTER_LIST_DIRECTORY, "starter-svc-211-colorado"],
  );

  await assert.rejects(
    () => publishRegistryEntryIn(sql, otherNewsroom, Number(target!.id), "other-editor"),
    /not in this newsroom/i,
  );

  const [stored] = await sql.query<{ published: boolean; status: string; verification_method: string | null }>(
    "select published, status, verification_method from services where id = $1",
    [Number(target!.id)],
  );
  assert.equal(stored!.published, false, "the entry is still unpublished");
  assert.equal(stored!.status, "unverified");
  assert.equal(stored!.verification_method, "imported");

  const page = await listPublicRegistry(sql, otherNewsroom);
  assert.equal(page.entries.length, 0);
});
