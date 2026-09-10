export type StatsPeriodKind = "daily" | "weekly" | "monthly";
export type StatsPeriod = { kind: StatsPeriodKind; start: string; end: string };
export type StatsDiskReport = {
  schemaVersion: 1;
  newsroomId: number;
  kind: StatsPeriodKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  dateBasis: "database-calendar-date";
  measurement: "anonymous-page-loads";
  siteLoads: number;
  stories: Array<{ slug: string; headline: string; loads: number }>;
};
export type StatsReportSummary = {
  fileName: string;
  kind: StatsPeriodKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
};

const DAY_MS = 86_400_000;
const REPORT_NAME = /^(daily|weekly|monthly)-\d{4}-\d{2}-\d{2}\.json$/;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function completedStatsPeriods(databaseToday: string): StatsPeriod[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(databaseToday)) throw new Error("Invalid database date.");
  const today = new Date(`${databaseToday}T00:00:00.000Z`);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const thisMonday = new Date(today.getTime() - daysSinceMonday * DAY_MS);
  const weekEnd = new Date(thisMonday.getTime() - DAY_MS);
  const weekStart = new Date(weekEnd.getTime() - 6 * DAY_MS);
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const monthStart = new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth(), 1));
  return [
    { kind: "daily", start: isoDay(yesterday), end: isoDay(yesterday) },
    { kind: "weekly", start: isoDay(weekStart), end: isoDay(weekEnd) },
    { kind: "monthly", start: isoDay(monthStart), end: isoDay(monthEnd) },
  ];
}

function reportsDir(root: string, newsroomId: number) {
  if (!Number.isSafeInteger(newsroomId) || newsroomId < 1) throw new Error("Invalid newsroom id.");
  return join(root, "reports", "stats", `newsroom-${newsroomId}`);
}

export function statsReportsRoot() {
  return process.env.TOWNREPORTER_DATA_ROOT || join(process.cwd(), ".townreporter-data");
}

export async function writeStatsReport(
  root: string,
  report: StatsDiskReport,
): Promise<{ fileName: string; path: string }> {
  const dir = reportsDir(root, report.newsroomId);
  const fileName = `${report.kind}-${report.periodEnd}.json`;
  const path = join(dir, fileName);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(dir, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, path);
  return { fileName, path };
}

function validateReport(value: unknown): StatsDiskReport {
  const parsed = z
    .object({
      schemaVersion: z.literal(1),
      newsroomId: z.number().int().positive(),
      kind: z.enum(["daily", "weekly", "monthly"]),
      periodStart: z.string(),
      periodEnd: z.string(),
      generatedAt: z.string(),
      dateBasis: z.literal("database-calendar-date"),
      measurement: z.literal("anonymous-page-loads"),
      siteLoads: z.number().nonnegative(),
      stories: z.array(
        z.object({ slug: z.string(), headline: z.string(), loads: z.number().nonnegative() }),
      ),
    })
    .parse(value);
  return parsed;
}

export async function readStatsReportOnDisk(
  root: string,
  newsroomId: number,
  fileName: string,
): Promise<StatsDiskReport> {
  if (!REPORT_NAME.test(fileName)) throw new Error("Invalid report name.");
  const report = validateReport(
    JSON.parse(await readFile(join(reportsDir(root, newsroomId), fileName), "utf8")),
  );
  if (report.newsroomId !== newsroomId) throw new Error("Report does not belong to this newsroom.");
  return report;
}

export async function listStatsReportsOnDisk(
  root: string,
  newsroomId: number,
): Promise<StatsReportSummary[]> {
  const dir = reportsDir(root, newsroomId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const reports = await Promise.all(
    names
      .filter((name) => REPORT_NAME.test(name))
      .map(async (fileName) => {
        try {
          const report = await readStatsReportOnDisk(root, newsroomId, fileName);
          return {
            fileName,
            kind: report.kind,
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            generatedAt: report.generatedAt,
          };
        } catch {
          return null;
        }
      }),
  );
  return reports
    .filter((report): report is StatsReportSummary => report !== null)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.kind.localeCompare(b.kind));
}

export async function buildStatsReport(
  newsroomId: number,
  period: StatsPeriod,
  now = new Date(),
): Promise<StatsDiskReport> {
  await ensureViewsSchema();
  const sql = await getSql();
  const [site] = await sql<{
    loads: string | null;
  }>`select sum(count) as loads from page_views where newsroom_id = ${newsroomId} and target = ${SITE_TARGET} and day between ${period.start}::date and ${period.end}::date`;
  const stories = await sql<{ slug: string; headline: string; loads: string | null }>`
    select a.slug, a.headline, coalesce(sum(pv.count), 0) as loads
    from articles a left join page_views pv on pv.newsroom_id = a.newsroom_id
      and pv.target = 'story:' || a.slug and pv.day between ${period.start}::date and ${period.end}::date
    where a.newsroom_id = ${newsroomId} and a.status = 'published'
    group by a.slug, a.headline order by coalesce(sum(pv.count), 0) desc, a.slug asc`;
  return {
    schemaVersion: 1,
    newsroomId,
    kind: period.kind,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: now.toISOString(),
    dateBasis: "database-calendar-date",
    measurement: "anonymous-page-loads",
    siteLoads: Number(site?.loads ?? 0),
    stories: stories.map((story) => ({ ...story, loads: Number(story.loads ?? 0) })),
  };
}

/** Idempotent scheduler hook: one stable file per last completed period. */
export async function generateCompletedStatsReportsForNewsroom(
  newsroomId: number,
  now = new Date(),
) {
  const root = statsReportsRoot();
  const sql = await getSql();
  const [clock] = await sql<{ today: string }>`select to_char(current_date, 'YYYY-MM-DD') as today`;
  if (!clock?.today) throw new Error("Could not read the database calendar date.");
  const existing = new Set(
    (await listStatsReportsOnDisk(root, newsroomId)).map((report) => report.fileName),
  );
  const saved = [];
  for (const period of completedStatsPeriods(clock.today)) {
    if (existing.has(`${period.kind}-${period.end}.json`)) continue;
    saved.push(
      await writeStatsReport(root, await buildStatsReport(newsroomId, period, now)),
    );
  }
  return saved;
}

/** Unattended, local-only tick. A broken newsroom never blocks its neighbors. */
export async function tickStatsReports(now = new Date()): Promise<void> {
  const sql = await getSql();
  const newsrooms = await sql<{ id: number }>`select id from newsrooms order by id`;
  for (const newsroom of newsrooms) {
    try {
      await generateCompletedStatsReportsForNewsroom(newsroom.id, now);
    } catch (error) {
      console.error(`[townreporter] stats report failed for newsroom ${newsroom.id}:`, error);
    }
  }
}

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { getSql } from "../db.ts";
import { ensureViewsSchema, SITE_TARGET } from "./views.ts";
