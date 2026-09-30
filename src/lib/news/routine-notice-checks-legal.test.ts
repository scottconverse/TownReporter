import assert from "node:assert/strict";
import { before, test } from "node:test";
import { getSql } from "../db.ts";
import { ensureLegalSchema } from "./legal-removal-schema.ts";
import { previewLegalRemoval } from "./legal-removal-store.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();

before(async () => {
  // The database is migrated before this file loads (U18a-1,
  // src/lib/test-support/pglite-migrations.ts). The hand replay that stood in
  // for Node's missing Vite migration glob is gone: a second application
  // re-runs the unguarded seed inserts several migrations carry.
  await ensureLegalSchema();
});

test("legal preview remains usable before optional routine-check tables exist", async () => {
  const sql = await getSql();
  const room = 98991;
  const owner = "routine-check-legal-owner";
  await sql.query("drop table routine_notice_candidate_refs");
  await sql.query("drop table routine_notice_checks");
  await sql.query(
    "insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')",
    [owner, room],
  );
  const [article] = await sql.query<{ id: number }>(
    "insert into articles(user_id,newsroom_id,slug,headline,body,topic) values($1,$2,'routine-legal-preview','Title','Body','council') returning id",
    [owner, room],
  );
  const preview = await previewLegalRemoval(owner, {
    articleIds: [article!.id],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: true,
    reviewedEvidence: true,
  });
  assert.equal(preview.counts.articles, 1);
  assert.equal(preview.capturedCopies.some((row) => row.table.startsWith("routine_notice_")), false);
});
