import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql } from "../../db.ts";
import { applyMigrationsToTestPglite } from "../../test-support/pglite-migrations.ts";
import {
  listRegistryDirectoryNames,
  listUnpublishedRegistryEntries,
} from "./registry-desk.server.ts";
import { listPublicRegistry } from "./registry-public.server.ts";
import {
  loadStarterListIn,
  previewHsdsImportIn,
  publishRegistryEntryIn,
  runHsdsImportIn,
} from "./registry-desk-write.server.ts";
import { DESK_DIRECTORY } from "./registry-entry-fields.ts";
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
  assert.deepEqual(entry.servicePhones, ["303-772-5529"]);
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

// --- Phase 2: preview and import of an HSDS JSON file ---------------------------


const sampleJson = readFileSync(
  new URL("./__fixtures__/sample-bundle.json", import.meta.url),
  "utf8",
);

const WATCHED = [
  "organizations",
  "services",
  "locations",
  "contacts",
  "taxonomies",
  "sources",
  "snapshots",
  "resource_imports",
  "resource_changes",
];

async function watchedCounts(newsroomId: number): Promise<Record<string, number>> {
  const sql = await getSql();
  const out: Record<string, number> = {};
  for (const table of WATCHED) {
    const rows = await sql.query<{ count: string }>(
      `select count(*)::text as count from ${table} where newsroom_id = $1`,
      [newsroomId],
    );
    out[table] = Number(rows[0]!.count);
  }
  return out;
}

test("previewing a valid file writes nothing and says the directory looks new", async () => {
  const sql = await getSql();
  const newsroomId = 9801;
  const before = await watchedCounts(newsroomId);
  const preview = await previewHsdsImportIn(
    sql,
    newsroomId,
    { json: sampleJson, directoryName: "county-211" },
    "editor-1",
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.looksLikeNewDirectory, true);
  assert.equal(preview.existingRows, 0);
  assert.equal(preview.summary.tables.services.inserted, 3);
  assert.deepEqual(await watchedCounts(newsroomId), before);
});

test("previewing a changed file after an import shows one proposal and writes nothing", async () => {
  const sql = await getSql();
  const newsroomId = 9802;
  const run = await runHsdsImportIn(
    sql,
    newsroomId,
    { json: sampleJson, directoryName: "county-211" },
    "editor-1",
  );
  assert.equal(run.ok, true);
  const afterImport = await watchedCounts(newsroomId);
  assert.ok(afterImport.services > 0);

  const changed = JSON.parse(sampleJson);
  changed.organizations[0].name = "A different name";
  const preview = await previewHsdsImportIn(
    sql,
    newsroomId,
    { json: JSON.stringify(changed), directoryName: "county-211" },
    "editor-1",
  );
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.looksLikeNewDirectory, false);
  assert.ok(preview.existingRows > 0);
  assert.equal(preview.summary.conflicts.length, 1);
  assert.deepEqual(await watchedCounts(newsroomId), afterImport);
});

test("an import writes unpublished rows and never publishes", async () => {
  const sql = await getSql();
  const newsroomId = 9803;
  const run = await runHsdsImportIn(
    sql,
    newsroomId,
    { json: sampleJson, directoryName: "county-211" },
    "editor-1",
  );
  assert.equal(run.ok, true);
  const published = await sql.query<{ count: string }>(
    `select (select count(*) from services where newsroom_id = $1 and published)
          + (select count(*) from organizations where newsroom_id = $1 and published) as count`,
    [newsroomId],
  );
  assert.equal(Number(published[0]!.count), 0);
});

test("bad input is refused with a message that names the problem and writes nothing", async () => {
  const sql = await getSql();
  const newsroomId = 9804;
  const before = await watchedCounts(newsroomId);

  const noName = JSON.parse(sampleJson);
  delete noName.organizations[1].services[0].name;
  const cases: { json: string; directoryName: string; expect: RegExp }[] = [
    { json: '{"organizations": [', directoryName: "county-211", expect: /not valid JSON/ },
    { json: JSON.stringify(noName), directoryName: "county-211", expect: /organizations\[1\]\.services\[0\]: name is missing/ },
    {
      json: `{"organizations":[],"pad":"${"x".repeat(8 * 1024 * 1024)}"}`,
      directoryName: "county-211",
      expect: /larger than 8 MiB/,
    },
    { json: sampleJson, directoryName: DESK_DIRECTORY, expect: /desk's own list/ },
    { json: sampleJson, directoryName: "  ", expect: /enter the name of the directory/ },
  ];
  for (const testCase of cases) {
    for (const fn of [previewHsdsImportIn, runHsdsImportIn]) {
      const result = await fn(
        sql,
        newsroomId,
        { json: testCase.json, directoryName: testCase.directoryName },
        "editor-1",
      );
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.problems.join("\n"), testCase.expect);
    }
  }
  assert.deepEqual(await watchedCounts(newsroomId), before);
});

test("the import panel's directory names are this newsroom's own, without the desk's list", async () => {
  const sql = await getSql();
  const mine = 9811;
  const other = 9812;
  await runHsdsImportIn(sql, mine, { json: sampleJson, directoryName: "county-211" }, "editor-1");
  await runHsdsImportIn(sql, mine, { json: sampleJson, directoryName: "Another directory" }, "editor-1");
  await runHsdsImportIn(sql, other, { json: sampleJson, directoryName: "other-newsroom-only" }, "editor-2");
  // The desk's own list is not an import, but a row under its name must not show.
  await sql.query(
    `insert into resource_imports (newsroom_id, directory_name, format, payload)
     values ($1, $2, 'json', '{}'::jsonb)`,
    [mine, DESK_DIRECTORY],
  );

  assert.deepEqual(await listRegistryDirectoryNames(sql, mine), ["Another directory", "county-211"]);
  assert.deepEqual(await listRegistryDirectoryNames(sql, other), ["other-newsroom-only"]);
  assert.deepEqual(await listRegistryDirectoryNames(sql, 9813), []);
});

test("the import panel's directory names leave out the starter list's directory", async () => {
  const sql = await getSql();
  const newsroomId = 9806;
  await loadStarterListIn(sql, newsroomId, "starter-editor");
  await runHsdsImportIn(sql, newsroomId, { json: sampleJson, directoryName: "county-211" }, "editor-1");
  // The premise: loading the starter list did leave an import row under its name.
  const rows = await sql.query<{ n: string }>(
    `select count(*)::text as n from resource_imports where newsroom_id = $1 and directory_name = $2`,
    [newsroomId, STARTER_LIST_DIRECTORY],
  );
  assert.ok(Number(rows[0]!.n) > 0, "the starter list left no import row to exclude");
  assert.deepEqual(await listRegistryDirectoryNames(sql, newsroomId), ["county-211"]);
});

test("a file over 8 MiB in UTF-8 is refused with zero writes even when its text is shorter", async () => {
  const sql = await getSql();
  const newsroomId = 9805;
  const before = await watchedCounts(newsroomId);
  // Each "é" is one UTF-16 unit but two UTF-8 bytes. 5 Mi of them is under the
  // cap as text length and over it as bytes, so only the byte check refuses it.
  const multibyte = `{"organizations":[],"pad":"${"é".repeat(5 * 1024 * 1024)}"}`;
  for (const fn of [previewHsdsImportIn, runHsdsImportIn]) {
    const result = await fn(sql, newsroomId, { json: multibyte, directoryName: "county-211" }, "editor-1");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.problems.join("\n"), /larger than 8 MiB/);
  }
  assert.deepEqual(await watchedCounts(newsroomId), before);
});
