import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deskMiddleware } from "./desk-auth.ts";

const reportInput = z.object({
  fileName: z.string().regex(/^(daily|weekly|monthly)-\d{4}-\d{2}-\d{2}\.json$/),
});

export const generateStatsReportsFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const reports = await import("./stats-reports.server.ts");
    await reports.generateCompletedStatsReportsForNewsroom(context.newsroomId);
    return reports.listStatsReportsOnDisk(reports.statsReportsRoot(), context.newsroomId);
  });

export const listStatsReportsFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    const reports = await import("./stats-reports.server.ts");
    return reports.listStatsReportsOnDisk(reports.statsReportsRoot(), context.newsroomId);
  });

export const readStatsReportFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(reportInput)
  .handler(async ({ context, data }) => {
    const reports = await import("./stats-reports.server.ts");
    return reports.readStatsReportOnDisk(reports.statsReportsRoot(), context.newsroomId, data.fileName);
  });
