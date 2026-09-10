import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, SecHead } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import { getViewStatsFn } from "@/lib/news/views";
import {
  generateStatsReportsFn,
  listStatsReportsFn,
  readStatsReportFn,
} from "@/lib/news/stats-reports";

export const Route = createFileRoute("/desk/stats")({
  head: () => ({ meta: [{ title: "Stats — TownReporter" }] }),
  component: StatsPage,
});

/**
 * Read-only. Raw page views, not unique visitors -- see
 * src/lib/news/views.ts for what that means and why. Recorded by a beacon
 * that fires after a public page has already rendered, so this page can
 * never say anything about traffic this instant -- only what has already
 * landed.
 */
function StatsPage() {
  const queryClient = useQueryClient();
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const stats = useQuery({ queryKey: ["view-stats"], queryFn: () => getViewStatsFn() });
  const reports = useQuery({ queryKey: ["stats-reports"], queryFn: () => listStatsReportsFn() });
  const report = useQuery({
    queryKey: ["stats-report", selectedReport],
    queryFn: () => readStatsReportFn({ data: { fileName: selectedReport! } }),
    enabled: selectedReport !== null,
  });
  const generate = useMutation({
    mutationFn: () => generateStatsReportsFn(),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["stats-reports"] }),
  });

  return (
    <DeskShell
      title="Stats"
      kicker="Editor desk"
      lede={
        <>
          Anonymous page loads, counted by a beacon after the home page or a published story page
          loads — not unique people, not completed reads, never a cookie, never an IP. A stats
          failure never touches the public paper; this page simply shows nothing new until it
          recovers.
        </>
      }
    >
      {stats.isPending ? (
        <ListSkeleton />
      ) : stats.isError ? (
        <p className="mt-4 text-rust">Could not read the stats. {String(stats.error)}</p>
      ) : (
        <>
          <section className="mt-8">
            <SecHead title="Site" sub="Home page and published story page loads, added together." />
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <li className="border border-rule p-4">
                <p className="text-sm tracking-[0.14em] text-muted uppercase">Today</p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {stats.data!.siteToday.toLocaleString()}
                </p>
              </li>
              <li className="border border-rule p-4">
                <p className="text-sm tracking-[0.14em] text-muted uppercase">All time</p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {stats.data!.siteTotal.toLocaleString()}
                </p>
              </li>
              <li className="border border-rule p-4">
                <p className="text-sm tracking-[0.14em] text-muted uppercase">Last 7 dates</p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {stats.data!.site7d.toLocaleString()}
                </p>
              </li>
              <li className="border border-rule p-4">
                <p className="text-sm tracking-[0.14em] text-muted uppercase">Last 30 dates</p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {stats.data!.site30d.toLocaleString()}
                </p>
              </li>
            </ul>
          </section>

          <section className="mt-12">
            <SecHead
              title="Stories"
              count={stats.data!.stories.length || null}
              sub="Raw published-story page loads in rolling calendar-date windows. A story with no recorded loads shows 0."
            />
            {stats.data!.stories.length === 0 ? (
              <p className="mt-4 text-ink-2">Nothing is published yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto border-y border-rule">
                <table className="w-full min-w-[44rem] border-collapse text-left">
                  <thead>
                    <tr className="text-sm tracking-[0.08em] text-muted uppercase">
                      <th className="py-3 pr-4 font-medium">Story</th>
                      <th className="px-3 py-3 text-right font-medium">Today</th>
                      <th className="px-3 py-3 text-right font-medium">Last 7 dates</th>
                      <th className="px-3 py-3 text-right font-medium">Last 30 dates</th>
                      <th className="py-3 pl-3 text-right font-medium">All time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {stats.data!.stories.map((s) => (
                      <tr key={s.slug}>
                        <th scope="row" className="py-3 pr-4 text-left font-normal">
                          <Link
                            to="/articles/$slug"
                            params={{ slug: s.slug }}
                            className="inline-link font-display text-lg"
                          >
                            {s.headline}
                          </Link>
                        </th>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {s.today.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {s.views7d.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {s.views30d.toLocaleString()}
                        </td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums">
                          {s.views.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-12">
            <SecHead
              title="Saved reports"
              count={reports.data?.length || null}
              sub="Aggregate page-load snapshots for the last completed day, Monday–Sunday week, and calendar month. Files are kept on this TownReporter installation."
            />
            <button
              type="button"
              className="mt-4 border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? "Saving reports…" : "Save latest reports"}
            </button>
            {generate.isError ? (
              <p className="mt-3 text-rust">Could not save reports. {String(generate.error)}</p>
            ) : null}
            {reports.isPending ? (
              <p className="mt-4 text-ink-2">Loading saved reports…</p>
            ) : reports.isError ? (
              <p className="mt-4 text-rust">
                Could not load saved reports. {String(reports.error)}
              </p>
            ) : reports.data!.length === 0 ? (
              <p className="mt-4 text-ink-2">No reports have been saved yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-rule border-y border-rule">
                {reports.data!.map((saved) => (
                  <li
                    key={saved.fileName}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span>
                      <strong className="capitalize">{saved.kind}</strong> · {saved.periodStart} to{" "}
                      {saved.periodEnd}
                    </span>
                    <button
                      type="button"
                      className="inline-link"
                      onClick={() => setSelectedReport(saved.fileName)}
                    >
                      Read report
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedReport ? (
              <div className="mt-6 border border-rule p-4" aria-live="polite">
                {report.isPending ? (
                  <p>Loading report…</p>
                ) : report.isError ? (
                  <p className="text-rust">Could not read report. {String(report.error)}</p>
                ) : report.data ? (
                  <>
                    <h3 className="font-display text-xl font-semibold capitalize">
                      {report.data.kind} report
                    </h3>
                    <p className="mt-1 text-sm text-muted">
                      {report.data.periodStart} to {report.data.periodEnd} · stored database
                      calendar dates · anonymous page loads, not readers
                    </p>
                    <p className="mt-4 text-2xl font-semibold tabular-nums">
                      {report.data.siteLoads.toLocaleString()} site loads
                    </p>
                    <ul className="mt-4 divide-y divide-rule">
                      {report.data.stories.map((story) => (
                        <li key={story.slug} className="flex justify-between gap-4 py-2">
                          <span>{story.headline}</span>
                          <strong className="tabular-nums">{story.loads.toLocaleString()}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </DeskShell>
  );
}
