import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

it("repairs legacy newsroom and discovery rows that were saved as official", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const newsroomId = 99203;
  await sql.query("insert into newsrooms(id,name) values($1,'Legacy source labels')", [newsroomId]);
  const legacy = [
    ["Longmont Times-Call", "https://www.timescall.com/", "official", "A"],
    ["Longmont Leader", "https://www.longmontleader.com/", "official", "A"],
    ["Search results", "https://www.bing.com/search?q=longmont", "official", "A"],
  ];
  for (const [title, url, kind, tier] of legacy) {
    await sql.query(
      "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values($1,$2,$3,$4,$5,$6,'accepted')",
      ["legacy-label-test", newsroomId, url, title, kind, tier],
    );
  }

  // Execute the real migration against rows that reproduce the stored labels.
  const migration = await readFile(new URL("../../../migrations/0146_correct_legacy_source_evidence_labels.sql", import.meta.url), "utf8");
  await sql.query(migration);
  const corrected = await sql.query<{ title: string; kind: string; tier: string }>(
    "select title,kind,tier from sources where newsroom_id=$1 order by id",
    [newsroomId],
  );
  assert.deepEqual(corrected.map(({ title, kind, tier }) => [title, kind, tier]), [
    ["Longmont Times-Call", "news", "B"],
    ["Longmont Leader", "news", "B"],
    ["Search results", "unclassified", "C"],
  ]);
});
