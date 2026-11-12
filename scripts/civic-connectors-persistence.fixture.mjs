import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// A bounded test harness, not a new supported production database mode.
const [rootArgument, phase] = process.argv.slice(2);
const root = resolve(rootArgument || ".");
assert.equal(dirname(root), resolve(tmpdir()));
assert.match(basename(root), /^townreporter-connectors-persistence-/);
assert.equal(await readFile(join(root, "fixture-owner.txt"), "utf8"), "connector-fixture-only\n");
assert.ok(phase === "save" || phase === "reopen");
assert.equal(process.env.TOWNREPORTER_TEST_ENV_VERIFIED, "1");
assert.equal(process.env.DATABASE_URL, "");

const pg = new PGlite(join(root, "pgdata"), {
  parsers: { 20: Number, 1082: (value) => value, 1186: (value) => value },
});
await pg.waitReady;
await pg.exec(
  "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
);
globalThis.__pgliteInstance__ = Promise.resolve(pg);
await import("../src/lib/test-support/pglite-migrations.ts");
const { getSql, withTransaction } = await import("../src/lib/db.ts");
const { rememberCapture } = await import("../src/lib/news/investigate.ts");

const room = 944221;
const otherRoom = 944222;
const url = "https://records.example.test/restart/agenda";
const text = "Synthetic council agenda. Item 9 proposes stormwater culvert repairs.";
const raw = Buffer.from('{"meeting":9,"unknown":{"zero":0,"flag":false,"empty":null}}');
const hash = createHash("sha256").update(raw).digest("hex");
try {
  const sql = await getSql();
  if (phase === "save") {
    for (const newsroomId of [room, otherRoom]) {
      await sql.query("insert into newsrooms(id,name) values($1,$2)", [
        newsroomId,
        `Synthetic restart newsroom ${newsroomId}`,
      ]);
      await withTransaction((transaction) =>
        rememberCapture({
          sql: transaction,
          userId: "connector-restart-fixture",
          newsroomId,
          investigationId: null,
          url,
          title: "Synthetic stormwater agenda",
          text,
          hash,
          status: 200,
          outcome: "fetched",
          contentType: "application/json",
          extractionMethod: "civic-connector:synthetic",
          pages: [{ page: 9, text }],
          rawBytes: raw,
          observedAt: new Date("2026-11-11T12:00:00Z"),
          triggerKind: "civic-connector",
          autoWatch: false,
        }),
      );
    }
  }
  const versions = await sql.query(
    "select id,newsroom_id,url,full_text,content_hash from artifact_versions where newsroom_id=any($1::integer[]) order by newsroom_id",
    [[room, otherRoom]],
  );
  assert.equal(versions.length, 2);
  assert.notEqual(versions[0].id, versions[1].id);
  const chunks = await sql.query(
    "select version_id,newsroom_id,excerpt,page_number from artifact_chunks where newsroom_id=any($1::integer[]) order by newsroom_id",
    [[room, otherRoom]],
  );
  const blobs = await sql.query(
    "select version_id,newsroom_id,sha256,body_b64,original_url from artifact_blobs where newsroom_id=any($1::integer[]) order by newsroom_id",
    [[room, otherRoom]],
  );
  const captures = await sql.query(
    "select version_id,newsroom_id,source_url,content_hash,trigger_kind from capture_events where newsroom_id=any($1::integer[]) order by newsroom_id",
    [[room, otherRoom]],
  );
  for (const table of ["articles", "drafts", "leads", "desk_jobs", "source_monitors"]) {
    const [count] = await sql.query(
      `select count(*)::integer as count from ${table} where newsroom_id=any($1::integer[])`,
      [[room, otherRoom]],
    );
    assert.equal(count.count, 0, `${table} must not be created by an evidence capture`);
  }
  const [migrations] = await sql.query("select count(*)::integer as count from _migrations");
  console.log(
    JSON.stringify({
      phase,
      pid: process.pid,
      migrations: migrations.count,
      versions,
      chunks,
      blobs,
      captures,
    }),
  );
} finally {
  await pg.close();
}
