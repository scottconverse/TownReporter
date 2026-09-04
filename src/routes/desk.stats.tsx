import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell, SecHead } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import { getViewStatsFn } from "@/lib/news/views";

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
  const stats = useQuery({ queryKey: ["view-stats"], queryFn: () => getViewStatsFn() });

  return (
    <DeskShell
      title="Stats"
      kicker="Editor desk"
      lede={
        <>
          Raw page views, counted anonymously by a beacon that fires after
          the page has already loaded — never uniques, never a cookie, never
          an IP. A stats failure never touches the public paper; this page
          simply shows nothing new until it recovers.
        </>
      }
    >
      {stats.isPending ? (
        <ListSkeleton />
      ) : stats.isError ? (
        <p className="mt-4 text-rust">
          Could not read the stats. {String(stats.error)}
        </p>
      ) : (
        <>
          <section className="mt-8">
            <SecHead title="Site" sub="Every public page view, added together." />
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <li className="border border-rule p-4">
                <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                  All time
                </p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {stats.data!.siteTotal.toLocaleString()}
                </p>
              </li>
              <li className="border border-rule p-4">
                <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                  Last 7 days
                </p>
                <p className="mt-1 font-display text-3xl font-semibold">
                  {stats.data!.site7d.toLocaleString()}
                </p>
              </li>
              <li className="border border-rule p-4">
                <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                  Last 30 days
                </p>
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
              sub="Every published story, ranked by all-time views. A story with no recorded views yet shows 0."
            />
            {stats.data!.stories.length === 0 ? (
              <p className="mt-4 text-ink-2">Nothing is published yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-rule border-y border-rule">
                {stats.data!.stories.map((s) => (
                  <li
                    key={s.slug}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                  >
                    <Link
                      to="/articles/$slug"
                      params={{ slug: s.slug }}
                      className="inline-link min-w-0 flex-1 font-display text-lg"
                    >
                      {s.headline}
                    </Link>
                    <span className="text-lg font-semibold tabular-nums">
                      {s.views.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </DeskShell>
  );
}
