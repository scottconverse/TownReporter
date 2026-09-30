import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import { getViewStatsFn } from "@/lib/news/views";
import {
  exportReadingCsvFn,
  getReadingLiveFn,
  getReadingStatsFn,
} from "@/lib/news/reading-stats";
import type { ReadingStats } from "@/lib/news/reading-stats";
import {
  READING_RANGES,
  READING_RANGE_LABELS,
  READ_DOW_LABELS,
  READ_DOW_ORDER,
  READ_PATH_LABELS,
  READ_DEVICE_LABELS,
  READ_REF_CLASS_LABELS,
  formatClock,
  formatCount,
  formatHours,
  readAgeLabel,
  readPathFallbackLabel,
  type ReadingRange,
} from "@/lib/news/reading";
import {
  generateStatsReportsFn,
  listStatsReportsFn,
  readStatsReportFn,
} from "@/lib/news/stats-reports";
import {
  LOCATION_MIN_VISITS,
  LOCATION_OTHER_LABEL,
  UNKNOWN_CITY,
} from "@/lib/news/stats-privacy";

export const Route = createFileRoute("/desk/stats")({
  head: () => ({ meta: [{ title: "Stats — TownReporter" }] }),
  component: StatsPage,
});

/** How often the live panel re-reads the server's rolling window. */
const LIVE_POLL_MS = 15_000;

/**
 * The range filter's prior-period wording, one per range. "vs prior 7 days" is
 * the drawing's own phrasing for the movement under a summary cell.
 */
const PRIOR_LABELS: Record<ReadingRange, string> = {
  today: "the day before",
  "7d": "prior 7 days",
  "30d": "prior 30 days",
  "12m": "prior 12 months",
};

type Movement = { text: string; tone: "up" | "down" | "same" };

function percentMovement(now: number, prior: number, label: string): Movement {
  if (prior <= 0) {
    return now > 0
      ? { text: "▲ nothing recorded before", tone: "up" }
      : { text: "— nothing recorded yet", tone: "same" };
  }
  const change = Math.round(((now - prior) / prior) * 100);
  if (change === 0) return { text: `— same as ${label}`, tone: "same" };
  return {
    text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change)}% vs ${label}`,
    tone: change > 0 ? "up" : "down",
  };
}

function pointMovement(now: number, prior: number, label: string): Movement {
  const change = Math.round((now - prior) * 100);
  if (change === 0) return { text: `— same as ${label}`, tone: "same" };
  return {
    text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change)} pts vs ${label}`,
    tone: change > 0 ? "up" : "down",
  };
}

function clockMovement(now: number, prior: number, label: string): Movement {
  const change = Math.round(now) - Math.round(prior);
  if (change === 0) return { text: `— same as ${label}`, tone: "same" };
  return {
    text: `${change > 0 ? "▲" : "▼"} ${formatClock(Math.abs(change))} vs ${label}`,
    tone: change > 0 ? "up" : "down",
  };
}

/** A 0-1 share as the whole number of percent the panel prints. */
function pct(share: number): number {
  return Math.round((Number.isFinite(share) ? share : 0) * 100);
}

/**
 * A place as a person would say it. A country that arrived with no usable city
 * beside it is counted under UNKNOWN_CITY, which is a fold and not a place
 * name, so it is printed as one.
 */
function locationName(row: ReadingStats["locations"][number]): string {
  return row.city === UNKNOWN_CITY ? `Unknown, ${row.country}` : row.city;
}

/**
 * "Where visits come from" and the trust panel both print a 0-1 range value.
 * `null` means the row is not a share of loads (an RSS fetch count, a click
 * count), and the panel then prints the count itself.
 */
function trustValue(row: ReadingStats["trust"][number]): string {
  if (row.event === "rss-fetch") return `${formatCount(row.perDay)} per day`;
  if (row.share !== null) return `${pct(row.share)}% of loads`;
  return formatCount(row.count);
}

const DEVICE_FILL = ["var(--fg)", "var(--a)", "var(--line)"];
const DEVICE_INK = ["var(--bg)", "#111111", "var(--fg)"];

/**
 * The Stats page.
 *
 * Read-only. Two sources, and the page says which is which everywhere it
 * matters: the page-load counter that has been running since 0.6.14
 * (`page_views`, one count per page per day) and the beacon (aggregate rows
 * keyed by path, hour, referrer class and device class). Nothing on either
 * side is a person. "Reading right now" is the server's in-memory rolling
 * window, which is never written down and cannot be joined to anything.
 *
 * WHAT THE OWNER'S 2026-09-30 DECISION ADDED (unit U17b): a place, and a daily
 * visitor count, and nothing else. Both are drawn in the "Where readers are"
 * panel -- the panel answers both questions about the same readers -- and both
 * are honest about what they are: a place is printed only above a threshold and
 * is a city, never a finer grain, and the visitor figure is labelled an estimate
 * that under-counts, because the value that tells two readers apart lives in
 * memory and dies at midnight (src/lib/news/stats-visitors.server.ts).
 *
 * Every number on this page that the paper cannot honestly measure still says
 * so rather than guessing.
 */
function StatsPage() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<ReadingRange>("7d");
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const stats = useQuery({
    queryKey: ["read-stats", range],
    queryFn: () => getReadingStatsFn({ data: { range } }),
  });
  const live = useQuery({
    queryKey: ["read-live"],
    queryFn: () => getReadingLiveFn(),
    refetchInterval: LIVE_POLL_MS,
  });
  // Kept only for "Section chosen by hand", which is not a view count and lives
  // in the action log (0.6.67). Everything else here comes from the two sources
  // above.
  const views = useQuery({ queryKey: ["view-stats"], queryFn: () => getViewStatsFn() });
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
  const download = useMutation({
    mutationFn: () => exportReadingCsvFn({ data: { range } }),
    onSuccess: (file) => {
      /*
        A downloaded file, not a route. The desk is authenticated and the CSV is
        a paper's traffic; a second unauthenticated URL returning it would be the
        one hole in this page's privacy rule. An object URL keeps it in the tab
        that asked for it.
      */
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
  });

  const priorLabel = PRIOR_LABELS[range];
  const data = stats.data;
  /*
    The longest bar in "Where readers are", over the places that are drawn AND
    the folded rest. Reading the first drawn row's count instead would be
    `undefined` in the one case that matters -- a range where every place is
    under the threshold, so nothing is drawn but "Other places" still is.
  */
  const topVisits = Math.max(data?.locations[0]?.visits ?? 0, data?.otherVisits ?? 0);

  return (
    <DeskShell title="Stats" hideTitle>
      {stats.isPending ? (
        <ListSkeleton />
      ) : stats.isError ? (
        <p className="st-error">Could not read the stats. {String(stats.error)}</p>
      ) : data ? (
        <div className="st-page">
          <header className="st-head">
            <div>
              {/* The drawing's own kicker and title, so the drawn header is not
                  printed twice under DeskShell's. */}
              <p className="st-kick">
                What&rsquo;s happening on the site · counted in aggregate, never per person
              </p>
              <h1 className="st-h1">Stats</h1>
            </div>
            <div className="st-tools">
              <div className="st-ranges" role="group" aria-label="Time range">
                {READING_RANGES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`st-range${value === range ? " on" : ""}`}
                    aria-pressed={value === range}
                    onClick={() => setRange(value)}
                  >
                    {READING_RANGE_LABELS[value]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="st-export"
                disabled={download.isPending}
                onClick={() => download.mutate()}
              >
                {download.isPending ? "Preparing…" : "Export CSV"}
              </button>
            </div>
          </header>
          {download.isError ? (
            <p className="st-error">Could not export the rows. {String(download.error)}</p>
          ) : null}

          <LiveSection stats={data} live={live.data ?? data.live} />

          <section className="st-kpis" aria-label="Summary">
            {[
              {
                label: "Visits",
                value: formatCount(data.kpis.visits),
                move: percentMovement(data.kpis.visits, data.kpis.visitsPrior, priorLabel),
                // The drawing's own words; "nothing stored" is the point of the
                // whole page.
                note: "Arrivals from outside the site; nothing stored in the browser",
                invert: false,
              },
              {
                label: "Page loads",
                value: formatCount(data.kpis.pageLoads),
                move: percentMovement(
                  data.kpis.pageLoads,
                  data.kpis.pageLoadsPrior,
                  priorLabel,
                ),
                note: "Every load the site counted; refreshes included",
                invert: false,
              },
              {
                label: "Avg reading time",
                value: formatClock(data.kpis.avgSeconds),
                move: clockMovement(
                  data.kpis.avgSeconds,
                  data.kpis.avgSecondsPrior,
                  priorLabel,
                ),
                note: "Active time only; refreshes and idle tabs excluded",
                invert: false,
              },
              {
                label: "Total reading",
                value: formatHours(data.kpis.totalSeconds),
                move: percentMovement(
                  data.kpis.totalSeconds,
                  data.kpis.totalSecondsPrior,
                  priorLabel,
                ),
                note: "All visits combined",
                invert: false,
              },
              {
                label: "Read another story",
                value: `${pct(data.kpis.recircShare)}%`,
                move: pointMovement(
                  data.kpis.recircShare,
                  data.kpis.recircSharePrior,
                  priorLabel,
                ),
                note: "Visits that opened a 2nd story",
                invert: false,
              },
              {
                label: "Left without reading",
                value: `${pct(data.kpis.leftEarlyShare)}%`,
                move: pointMovement(
                  data.kpis.leftEarlyShare,
                  data.kpis.leftEarlySharePrior,
                  priorLabel,
                ),
                note: "Under 10 seconds on the page",
                // The one cell where a rise is the bad direction. The drawing
                // colors by arrow alone, which would paint more abandonment
                // green; this page colors by what the number means.
                invert: true,
              },
            ].map((kpi) => {
              const tone =
                kpi.move.tone === "same"
                  ? "same"
                  : kpi.invert
                    ? kpi.move.tone === "up"
                      ? "down"
                      : "up"
                    : kpi.move.tone;
              return (
                <div className="st-kpi" key={kpi.label}>
                  <p className="st-kpi-l">{kpi.label}</p>
                  <p className="st-kpi-v">{kpi.value}</p>
                  <p className={`st-kpi-d ${tone}`}>{kpi.move.text}</p>
                  <p className="st-kpi-note">{kpi.note}</p>
                </div>
              );
            })}
          </section>

          <section>
            <div className="st-sechead">
              <h2 className="st-h2">Visits and reading time, last 30 days</h2>
              <p className="st-aside">
                Bars: visits · yellow marks: days a story drew over 1,000 visits
              </p>
            </div>
            <DailyChart daily={data.daily} max={data.dailyMax} />
          </section>

          <section>
            <div className="st-sechead">
              <h2 className="st-h2">Stories, by how much they were read</h2>
              <p className="st-aside">{data.rangeLabel}</p>
            </div>
            {data.stories.length === 0 ? (
              <p className="st-empty">Nothing is published yet.</p>
            ) : (
              <div className="st-scroll">
                <div className="st-story-head">
                  <span>Section · age</span>
                  <span>Visits</span>
                  <span>Avg read</span>
                  <span>Read to the end</span>
                  <span>Read another</span>
                </div>
                {data.stories.map((story) => (
                  <div className="st-story" key={story.slug}>
                    <div>
                      <p className="st-story-sec">
                        {story.section} · {readAgeLabel(story.ageDays)}
                      </p>
                      <Link
                        to="/articles/$slug"
                        params={{ slug: story.slug }}
                        className="st-story-title"
                      >
                        {story.headline}
                      </Link>
                    </div>
                    <span className="st-num">{formatCount(story.loads)}</span>
                    <span className="st-num">{formatClock(story.avgSeconds)}</span>
                    <span className="st-depth">
                      {story.depth.map((value, index) => (
                        <i
                          key={index}
                          className={index === 3 ? "end" : ""}
                          style={{
                            height: `${Math.max(2, Math.round(pct(value) * 0.3))}px`,
                            width: "22px",
                          }}
                        />
                      ))}
                      <b className="st-depth-pct">{pct(story.endShare)}%</b>
                    </span>
                    <span className="st-num">{pct(story.recircShare)}%</span>
                  </div>
                ))}
                <p className="st-footnote">
                  Read to the end: share of visits that scrolled past 25%, 50%, 75% and 100% of the
                  story. Read another: share that opened a second story. Visits here are the
                  beacon&rsquo;s arrivals, so a story the desk has not counted yet shows 0.
                </p>
              </div>
            )}
          </section>

          <section className="st-panels">
            <div className="st-panel">
              <h2 className="st-h3">Where visits come from</h2>
              {data.sources.length === 0 ? (
                <p className="st-empty">No arrivals recorded for this range yet.</p>
              ) : (
                data.sources.map((row) => (
                  <div className="st-ref" key={row.refClass}>
                    <span>{row.label}</span>
                    <span className="st-track">
                      <i style={{ width: `${data.sources[0].visits > 0 ? (row.visits / data.sources[0].visits) * 100 : 0}%` }} />
                    </span>
                    <b className="st-num">{formatCount(row.visits)}</b>
                  </div>
                ))
              )}
              <p className="st-note">
                &ldquo;Email, apps, texts&rdquo; is links shared privately. It usually means word of
                mouth.
              </p>
            </div>

            <div className="st-panel">
              <h2 className="st-h3">Where readers are</h2>
              {/*
                The owner's decision of 2026-09-30 permits a location signal, and
                this is the whole of it: a city and a country, read from the
                Cloudflare headers of the network this paper is already served
                through, counted by the day. No GeoIP vendor is consulted, no
                latitude, longitude, region, postal code or timezone is read at
                all, and the IP address is never stored — see
                src/lib/news/stats-privacy.ts for the allowlist and
                migrations/0109_stats_location.sql for what is kept.

                The threshold is applied on the server, so a place under it
                never reaches this page: a city with one visit is a statement
                about one reader.
              */}
              {data.locations.length === 0 && data.otherVisits === 0 ? (
                <p className="st-panel-body">
                  No visit in this range carried a place. A place is read only as a city and a
                  country, from the network this paper is served through — an installation that is
                  not behind Cloudflare has none at all, and the address itself is never stored.
                </p>
              ) : (
                <>
                  {data.locations.map((row) => (
                    <div className="st-ref" key={`${row.country}/${row.city}`}>
                      <span>{locationName(row)}</span>
                      <span className="st-track">
                        <i
                          style={{
                            width: `${topVisits > 0 ? (row.visits / topVisits) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <b className="st-num">{formatCount(row.visits)}</b>
                    </div>
                  ))}
                  {data.otherVisits > 0 ? (
                    <div className="st-ref">
                      <span>{LOCATION_OTHER_LABEL}</span>
                      <span className="st-track">
                        <i
                          style={{
                            width: `${topVisits > 0 ? (data.otherVisits / topVisits) * 100 : 0}%`,
                          }}
                        />
                      </span>
                      <b className="st-num">{formatCount(data.otherVisits)}</b>
                    </div>
                  ) : null}
                </>
              )}
              <p className="st-note">
                City and country only, counted by the day. A place is printed once{" "}
                {formatCount(LOCATION_MIN_VISITS)} visits have been counted there in this range;
                everything under that is {LOCATION_OTHER_LABEL}, so no row can be about one reader.
              </p>

              {/*
                The visitor count, in the same panel because it answers the same
                question about the same readers. Deliberately NOT a range sum:
                adding days together would count one reader once per day and
                print the total as "visitors". Two single days instead.
              */}
              <p className="st-kpi-l">Visitors</p>
              <p className="st-big">
                {formatCount(data.visitors.today)} <span>today</span>
              </p>
              <p className="st-note">
                An estimate, and a floor rather than a headcount. The server tells two readers apart
                for one day with a value held only in memory, which is thrown away at midnight and
                again when the server restarts — so it keeps no identifier, cannot follow anyone
                from one day to the next, and under-counts on a busy or restarted day. Yesterday:{" "}
                {formatCount(data.visitors.yesterday)}.
              </p>
            </div>

            <div className="st-panel">
              <h2 className="st-h3">Sections, by reading time</h2>
              {data.sections.length === 0 ? (
                <p className="st-empty">No reading time recorded for this range yet.</p>
              ) : (
                data.sections.map((row) => (
                  <div className="st-ref" key={row.topic}>
                    <span>{row.label}</span>
                    <span className="st-track">
                      <i
                        style={{
                          width: `${data.sections[0].seconds > 0 ? (row.seconds / data.sections[0].seconds) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <b className="st-num">{formatHours(row.seconds)}</b>
                  </div>
                ))
              )}
              <p className="st-note">Total reading time over {data.rangeLabel.toLowerCase()}, not clicks.</p>
            </div>
          </section>

          <section className="st-heatwrap">
            <div className="st-panel">
              <h2 className="st-h3">When people read · visits by hour and day</h2>
              <div className="st-heat">
                {READ_DOW_ORDER.map((dow) => (
                  <Fragment key={dow}>
                    <span className="st-heat-day">{READ_DOW_LABELS[dow]}</span>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const cell = data.heatmap.cells.find(
                        (c) => c.dow === dow && c.hour === hour,
                      );
                      const visits = cell?.visits ?? 0;
                      return (
                        <i
                          key={hour}
                          className="st-heat-cell"
                          style={{
                            opacity: 0.08 + (data.heatmap.max > 0 ? visits / data.heatmap.max : 0) * 0.92,
                          }}
                          title={`${READ_DOW_LABELS[dow]} ${hour}:00 — ${formatCount(visits)} visits`}
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </div>
              <div className="st-heataxis">
                <span>12 a.m.</span>
                <span>6 a.m.</span>
                <span>Noon</span>
                <span>6 p.m.</span>
                <span>11 p.m.</span>
              </div>
              {/* The drawing's caption, and the one line an editor is meant to
                  leave with. Under the grid, where the drawing puts it, rather
                  than in a panel of its own. */}
              <p className="st-takeaway">
                {data.heatmap.takeaway ??
                  "Not enough has been counted yet for a busiest hour to mean anything."}
              </p>
              <p className="st-note">
                Cell shade follows visits in that hour of that weekday, over{" "}
                {data.rangeLabel.toLowerCase()}.
              </p>
            </div>
            <div className="st-panel">
              <h2 className="st-h3">Trust signals · {data.rangeLabel.toLowerCase()}</h2>
              {data.trust.map((row) => (
                <div className="st-trust" key={row.event}>
                  <span>{row.label}</span>
                  <b className="st-num">{trustValue(row)}</b>
                </div>
              ))}
              <p className="st-note">
                Counts of clicks on the paper&rsquo;s own controls. None is tied to a person. A row
                reads 0 while the page it happens on has no counter yet.
              </p>
            </div>
          </section>

          <section className="st-bottom">
            <div className="st-panel">
              <h2 className="st-h3">Section chosen by hand</h2>
              <p className="st-big">{formatCount(views.data?.sectionOverrides ?? 0)}</p>
              <p className="st-note">
                Stories that printed under a section the scanner did not pick. Each is logged with
                the lead, the model&rsquo;s section and yours.
              </p>
            </div>

            <div className="st-panel">
              <h2 className="st-h3">Saved reports</h2>
              <div>
                <button
                  type="button"
                  className="st-btn"
                  disabled={generate.isPending}
                  onClick={() => generate.mutate()}
                >
                  {generate.isPending ? "Saving reports…" : "Save latest reports"}
                </button>
              </div>
              <p className="st-note">
                Snapshots for the last completed day, Monday–Sunday week and calendar month, kept on
                this installation.
              </p>
              {generate.isError ? (
                <p className="st-error">Could not save reports. {String(generate.error)}</p>
              ) : null}
              {reports.isPending ? (
                <p className="st-empty">Loading saved reports…</p>
              ) : reports.isError ? (
                <p className="st-error">Could not load saved reports. {String(reports.error)}</p>
              ) : reports.data!.length === 0 ? (
                <p className="st-empty">No reports have been saved yet.</p>
              ) : (
                reports.data!.map((saved) => (
                  <div className="st-report" key={saved.fileName}>
                    <span>
                      <strong className="capitalize">{saved.kind}</strong> · {saved.periodStart} to{" "}
                      {saved.periodEnd}
                    </span>
                    <button
                      type="button"
                      className="st-btn ghost"
                      onClick={() => setSelectedReport(saved.fileName)}
                    >
                      Read report
                    </button>
                  </div>
                ))
              )}
              {selectedReport ? (
                <div className="st-report-reader" aria-live="polite">
                  {report.isPending ? (
                    <p>Loading report…</p>
                  ) : report.isError ? (
                    <p className="st-error">Could not read report. {String(report.error)}</p>
                  ) : report.data ? (
                    <>
                      <h3 className="st-h3 capitalize">{report.data.kind} report</h3>
                      <p className="st-note">
                        {report.data.periodStart} to {report.data.periodEnd} · stored database
                        calendar dates · anonymous page loads, not readers
                      </p>
                      <p className="st-big">
                        {formatCount(report.data.siteLoads)} <span>site loads</span>
                      </p>
                      {report.data.stories.map((story) => (
                        <div className="st-report" key={story.slug}>
                          <span>{story.headline}</span>
                          <b className="st-num">{formatCount(story.loads)}</b>
                        </div>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </DeskShell>
  );
}

function DailyChart({ daily, max }: { daily: ReadingStats["daily"]; max: number }) {
  const top = Math.max(1, max);
  return (
    <>
      {/* Divs, not a chart library: every bar in the drawing is a plain box, and
          the desk already ships no charting code to the client. */}
      <div className="st-daily">
        {daily.map((row) => (
          <div className="st-daily-col" key={row.day} title={`${row.label} — ${formatCount(row.visits)} visits`}>
            <i className={row.over ? "on" : ""} />
            <b style={{ height: `${Math.max(1, (row.visits / top) * 88)}%` }} />
          </div>
        ))}
      </div>
      <div className="st-axis">
        <span>{daily[0]?.label ?? ""}</span>
        <span>{daily[Math.floor(daily.length / 2)]?.label ?? ""}</span>
        <span>Today</span>
      </div>
    </>
  );
}

function LiveSection({ stats, live }: { stats: ReadingStats; live: ReadingStats["live"] }) {
  const readers = live.readers;
  const change = live.changeFrom30MinAgo;
  const changeWords =
    change === 0
      ? "level with 30 minutes ago"
      : `${change > 0 ? "up" : "down"} ${Math.abs(change)} from 30 minutes ago`;
  const top = Math.max(1, ...live.perMinute);
  const deviceTotal = live.devices.reduce((sum, row) => sum + row.pct, 0);

  function label(path: string): string {
    return stats.pathLabels[path] ?? READ_PATH_LABELS[path] ?? readPathFallbackLabel(path);
  }

  return (
    <section className="st-livegrid">
      <div className="st-card live">
        <div className="st-livehead">
          <span className="st-pulse" aria-hidden />
          <h2 className="st-livetitle">Reading right now</h2>
          <span className="st-hint">Updates every 15 seconds</span>
        </div>
        <p className="st-livecount">
          <strong>{formatCount(readers)}</strong>
          <span>
            readers on the site · {changeWords}
          </span>
        </p>
        <div className="st-spark" role="img" aria-label={`Readers per minute, last ${live.windowMinutes} minutes`}>
          {live.perMinute.map((value, index) => (
            <i
              key={index}
              className={index === live.perMinute.length - 1 ? "on" : ""}
              style={{ height: `${Math.max(2, (value / top) * 100)}%` }}
            />
          ))}
        </div>
        <p className="st-hint">Last {live.windowMinutes} minutes</p>
        {live.pages.length === 0 ? (
          <p className="st-empty">No one is reading a page this minute.</p>
        ) : (
          <div className="st-livetbl">
            <div className="st-livehead3">
              <span>Page</span>
              <span>Readers</span>
              <span>Avg time so far</span>
            </div>
            {live.pages.map((page) => (
              <div className="st-liverow" key={page.path}>
                <span className="st-livepage">{label(page.path)}</span>
                <span>
                  <b className="st-num">{formatCount(page.readers)}</b>
                  <i
                    className="st-livebar"
                    style={{ width: `${Math.min(60, Math.max(2, page.readers * 6))}px` }}
                  />
                </span>
                <span className="st-num">{formatClock(page.avgSeconds)}</span>
              </div>
            ))}
          </div>
        )}
        {/*
          Estimated, and the note says so. A beat is one anonymous ping every 15
          seconds from a page that is on screen; a reader who hides the tab stops
          beating. Nothing links two beats to one person -- the window is a count
          of recent beats divided by the beats a reader would send in a minute,
          which is why it is a reader count with a fudge factor, printed as one.
        */}
        <p className="st-note">
          Estimated from anonymous beats — one ping every 15 seconds while a page is on screen.
          Rounded to the nearest reader; nothing here is stored after the half hour passes.
        </p>
      </div>

      <div className="st-side">
        <div className="st-panel">
          <h2 className="st-h3">Arriving from, right now</h2>
          {live.arrivals.length === 0 ? (
            <p className="st-empty">No arrivals in the last half hour.</p>
          ) : (
            live.arrivals.map((row) => (
              <div className="st-arrive" key={row.refClass}>
                <span>{READ_REF_CLASS_LABELS[row.refClass]}</span>
                <span className="st-track">
                  <i
                    style={{
                      width: `${live.arrivals[0].count > 0 ? (row.count / live.arrivals[0].count) * 100 : 0}%`,
                    }}
                  />
                </span>
                <b className="st-num">{formatCount(row.count)}</b>
              </div>
            ))
          )}
        </div>

        <div className="st-panel">
          <h2 className="st-h3">Right now, readers are on</h2>
          <div className="st-devices">
            {live.devices.length === 0 ? (
              <span className="st-device" style={{ background: "var(--line)", color: "var(--fg)", width: "100%" }}>
                —
              </span>
            ) : (
              live.devices.map((row, index) => (
                <span
                  key={row.device}
                  className="st-device"
                  style={{
                    background: DEVICE_FILL[index] ?? "var(--line)",
                    color: DEVICE_INK[index] ?? "var(--fg)",
                    width: `${deviceTotal > 0 ? (row.pct / deviceTotal) * 100 : 0}%`,
                  }}
                  title={`${READ_DEVICE_LABELS[row.device]} — ${formatCount(row.readers)} readers`}
                >
                  {row.pct}%
                </span>
              ))
            )}
          </div>
          <p className="st-hint">
            {live.devices.length === 0
              ? "No one is on the site right now. The bar fills when readers arrive."
              : live.devices.map((row) => READ_DEVICE_LABELS[row.device]).join(" · ")}
          </p>
        </div>

        <div className="st-card dashed">
          <h2 className="st-never-title">What we never collect</h2>
          <p className="st-never-body">
            No cookies, no accounts, no stored IP addresses, no fingerprinting, no identifier that
            outlives the day. A reader cannot be followed from one visit to the next, which is why
            &ldquo;returning readers&rdquo; is not a number this page can show and does not guess
            — the visitors figure counts a day&rsquo;s readers and forgets them at midnight.
            <strong> How it&rsquo;s counted.</strong> Page loads come from the counter that has run
            since 0.6.14 — one count per page per day with no identity attached. Everything else
            comes from the beacon: a ping every 15 seconds carrying the page, the referrer&rsquo;s
            class and the device&rsquo;s class. Each of those is one of a handful of fixed words, not
            a value read off the reader, and a visit is a page load whose referrer is not this site.
            <strong> How visitors are counted.</strong> Two readers are told apart for one day by a
            value the server holds in memory and throws away: it is never written down, it is
            different for the same reader tomorrow, and it dies when the server restarts — so it
            counts no one twice and can join no one across days. <strong>How a place is
            read.</strong> As a city and a country, from the network this paper is served through,
            counted by the day, and printed only once enough visits have landed there that a row
            cannot be one person. No location database is consulted and the address is never stored.
          </p>
        </div>
      </div>
    </section>
  );
}
