import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { getPglite, getSql } from "../db.ts";
import { ensureLegalSchema } from "./legal-removal-schema.ts";
import { previewLegalRemoval } from "./legal-removal-store.ts";

before(async () => {
  const pg = await getPglite();
  for (const file of (await readdir(new URL("../../../migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await pg.exec(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"));
  }
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
