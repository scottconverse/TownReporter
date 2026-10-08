// guards: a skipped source's status and last-read date must survive in the scan record.
import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  manualScanCoverage,
  parseScanSourceCoverage,
  scanCoverageCounts,
  scheduledScanCoverage,
  updateScanCoverageEntry,
} from "./scan-source-coverage.ts";
import { saveScanSourceCoverage } from "./scan-source-coverage.server.ts";

it("records one skipped source when a three-source scan has a cap of two", async () => {
  await applyMigrationsToTestPglite();
  const sql = await getSql();
  const newsroomId = 907604;
  const startedAt = "2026-10-08T12:00:00.000Z";
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
    newsroomId,
    "Coverage fixture",
  ]);
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id) values($1,$2) returning id",
    ["coverage-fixture", newsroomId],
  );
  assert.ok(run);
  const sources = [
    {
      id: 1,
      title: "School board",
      url: "https://fixture.example/schools",
      kind: "school",
      tier: "A",
      last_ok_at: "2026-10-01T12:00:00.000Z",
    },
    {
      id: 2,
      title: "Police updates",
      url: "https://fixture.example/police",
      kind: "public-safety",
      tier: "A",
      last_ok_at: null,
    },
    {
      id: 3,
      title: "New development",
      url: "https://fixture.example/development",
      kind: "development",
      tier: "B",
      last_ok_at: "2026-09-20T12:00:00.000Z",
    },
  ];
  try {
    const scheduled = scheduledScanCoverage(sources, [1, 2], [{ sourceId: 3, reason: "over-budget" }]);
    assert.equal(scanCoverageCounts(scheduled).total, 3);
    assert.equal(scanCoverageCounts(scheduled).skipped, 1);
    let coverage = manualScanCoverage(sources, 2);
    coverage = updateScanCoverageEntry(coverage, 1, { status: "read", readAt: startedAt });
    coverage = updateScanCoverageEntry(coverage, 2, { status: "read", readAt: startedAt });
    coverage = parseScanSourceCoverage(JSON.stringify(coverage));
    await saveScanSourceCoverage(sql, newsroomId, run.id, coverage);
    const [saved] = await sql.query<{ source_coverage: unknown }>(
      "select source_coverage from scan_runs where newsroom_id=$1 and id=$2",
      [newsroomId, run.id],
    );
    const persisted = parseScanSourceCoverage(saved?.source_coverage);
    assert.deepEqual(scanCoverageCounts(persisted), {
      total: 3,
      read: 2,
      skipped: 1,
      blocked: 0,
      pending: 0,
    });
    assert.equal(persisted[2]?.status, "skipped");
    assert.equal(persisted[2]?.title, "New development");
    assert.equal(persisted[2]?.lastReadAt, "2026-09-20T12:00:00.000Z");
  } finally {
    await sql.query("delete from scan_runs where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from newsrooms where id=$1", [newsroomId]);
  }
});
