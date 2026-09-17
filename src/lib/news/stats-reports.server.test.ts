import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  completedStatsPeriods,
  writeStatsReport,
  listStatsReportsOnDisk,
  readStatsReportOnDisk,
  buildStatsReport,
  type StatsDiskReport,
} from "./stats-reports.server.ts";
import { getPglite, getSql } from "../db.ts";
import { SITE_TARGET, storyTarget } from "./views.ts";

before(async () => {
  const pg = await getPglite();
  const migrations = (await readdir(join(process.cwd(), "migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations) {
    try {
      await pg.exec(await readFile(join(process.cwd(), "migrations", name), "utf8"));
    } catch {
      // Some production-Postgres migrations are unsupported by bare PGLite.
    }
  }
});

describe("completedStatsPeriods", () => {
  it("uses the last completed stored database date, Monday-Sunday week, and calendar month", () => {
    assert.deepEqual(completedStatsPeriods("2026-09-09"), [
      { kind: "daily", start: "2026-09-08", end: "2026-09-08" },
      { kind: "weekly", start: "2026-08-31", end: "2026-09-06" },
      { kind: "monthly", start: "2026-08-01", end: "2026-08-31" },
    ]);
  });
});

describe("stats report disk archive", () => {
  it("writes atomically, lists metadata, reads valid reports, and rejects path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "townreporter-stats-"));
    const report: StatsDiskReport = {
      schemaVersion: 1,
      newsroomId: 42,
      kind: "daily",
      periodStart: "2026-09-08",
      periodEnd: "2026-09-08",
      generatedAt: "2026-09-09T15:00:00.000Z",
      dateBasis: "database-calendar-date",
      measurement: "anonymous-page-loads",
      siteLoads: 3,
      stories: [{ slug: "council-news", headline: "Council news", loads: 2 }],
    };
    try {
      const saved = await writeStatsReport(root, report);
      assert.equal(saved.fileName, "daily-2026-09-08.json");
      assert.deepEqual(JSON.parse(await readFile(saved.path, "utf8")), report);
      assert.deepEqual(await listStatsReportsOnDisk(root, 42), [
        {
          fileName: saved.fileName,
          kind: "daily",
          periodStart: "2026-09-08",
          periodEnd: "2026-09-08",
          generatedAt: report.generatedAt,
        },
      ]);
      assert.deepEqual(await readStatsReportOnDisk(root, 42, saved.fileName), report);
      await assert.rejects(
        () => readStatsReportOnDisk(root, 42, "../config.json"),
        /Invalid report name/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("database counters reach reports", () => {
  it("aggregates anonymous site and story buckets without counting the editor report read", async () => {
    const newsroomId = 9342;
    const slug = "stats-report-db-fixture";
    const sql = await getSql();
    await sql`
      insert into articles (user_id, newsroom_id, slug, headline, dek, body, topic, status)
      values (${"fixture-owner"}, ${newsroomId}, ${slug}, ${"Database counter fixture"}, ${""}, ${"Body"}, ${"council"}, 'published')`;
    await sql`
      insert into page_views (newsroom_id, target, day, count) values
        (${newsroomId}, ${SITE_TARGET}, current_date, 11),
        (${newsroomId}, ${storyTarget(slug)}, current_date, 7)`;
    const [clock] = await sql<{ today: string }>`select to_char(current_date, 'YYYY-MM-DD') as today`;

    const report = await buildStatsReport(
      newsroomId,
      { kind: "daily", start: clock!.today, end: clock!.today },
      new Date("2026-09-09T18:00:00.000Z"),
    );

    assert.equal(report.siteLoads, 11, "the anonymous site beacon bucket reaches the report");
    assert.deepEqual(report.stories, [
      { slug, headline: "Database counter fixture", loads: 7 },
    ]);
    const rows = await sql<{ target: string; count: string }>`
      select target, count from page_views where newsroom_id = ${newsroomId} order by target`;
    assert.deepEqual(
      rows.map((row) => [row.target, Number(row.count)]),
      [
        [SITE_TARGET, 11],
        [storyTarget(slug), 7],
      ],
      "building/reading an editor report adds no view; only anonymous public beacon buckets exist",
    );
  });
});
