import { createServerFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { DEFAULT_NEWSROOM_ID, requireEditor } from "./membership.ts";

/**
 * Anonymous, raw page-view counting (0.6.14).
 *
 * Counts RAW views, not unique visitors: no cookies, no fingerprinting, no
 * IP or user-agent stored -- just a daily count per (newsroom, target). Two
 * targets exist: the literal `SITE_TARGET` for the whole paper, and
 * `storyTarget(slug)` for one published story.
 *
 * The whole point of this module is that it never touches page render. The
 * beacon that calls `recordView` fires from the client AFTER the page has
 * already painted (see src/components/view-beacon.tsx and
 * src/routes/api/view.ts), and `recordView` itself swallows every error so a
 * database hiccup here can never surface as a broken or slow page -- see the
 * live outage this release is named after in CHANGELOG.md.
 */

export const SITE_TARGET = "site";
const STORY_PREFIX = "story:";

export function storyTarget(slug: string): string {
  return `${STORY_PREFIX}${slug}`;
}

/** Mirrors migrations/0037_page_views.sql -- see that file for the schema note. */
const PAGE_VIEWS_SCHEMA = [
  `
    create table if not exists page_views (
      newsroom_id integer not null default 1,
      target text not null,
      day date not null,
      count bigint not null default 0,
      primary key (newsroom_id, target, day)
    )
  `,
  // migrations/0037_page_views.sql creates this index too; without it here a
  // database built by the PGLite/unit-test path had only the primary key.
  `create index if not exists page_views_newsroom_target_idx on page_views (newsroom_id, target)`,
];

/**
 * The stats read below is a read path, so it goes through `ensureSchemaOnce`
 * too: it used to issue this DDL on every page load of the desk stats. See
 * `paper-settings-read-lock.test.ts` and `questions/BP.md`.
 */
export async function ensureViewsSchema() {
  await ensureSchemaOnce(await getSql(), "page-views", PAGE_VIEWS_SCHEMA);
}

/**
 * `audit_events` is created by migration 0005 and re-ensured by `audit()`
 * (ops.ts), but a newsroom that has never published under a changed section
 * has never written one -- and the stats read below must not be the thing
 * that fails a stats page. The shape below is the migrated one (0005 plus
 * 0012's `newsroom_id`), the same one `audit()` ends up with, so the count is
 * answerable at zero. Separate marker name from `ops.ts`'s `ensureAuditEventsSchema`
 * on purpose -- this read path must not depend on `audit()` having run first.
 */
export async function ensureViewsStatsAuditEventsSchema(): Promise<void> {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "views-stats-audit-events", [
    `
    create table if not exists audit_events (
      id serial primary key,
      user_id text not null,
      action text not null,
      detail text not null default '',
      created_at timestamptz not null default now(),
      newsroom_id integer not null default 1
    )
  `,
  ]);
}

/**
 * Whether `target` is something worth counting: the literal 'site', or a
 * story slug that is a REAL, currently published story in this newsroom.
 * Guards against an arbitrary target minting a brand-new bucket for anyone
 * who wants one -- an unknown or unpublished target is simply ignored.
 */
async function isCountableTarget(target: string, newsroomId: number): Promise<boolean> {
  if (target === SITE_TARGET) return true;
  if (!target.startsWith(STORY_PREFIX)) return false;
  const slug = target.slice(STORY_PREFIX.length).trim();
  if (!slug) return false;
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    select id from articles
    where slug = ${slug} and status = 'published' and newsroom_id = ${newsroomId}
    limit 1
  `;
  return rows.length > 0;
}

/**
 * Record one anonymous view. Always resolves -- never throws to the caller
 * -- and does nothing at all for a target that is not 'site' or a real
 * published story, so this can never be used to mint an arbitrary counter.
 */
export async function recordView(
  rawTarget: unknown,
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<void> {
  try {
    const target = typeof rawTarget === "string" ? rawTarget.trim().slice(0, 300) : "";
    if (!target) return;
    await ensureViewsSchema();
    if (!(await isCountableTarget(target, newsroomId))) return;
    const sql = await getSql();
    await sql`
      insert into page_views (newsroom_id, target, day, count)
      values (${newsroomId}, ${target}, current_date, 1)
      on conflict (newsroom_id, target, day) do update set count = page_views.count + 1
    `;
  } catch (err) {
    // The one rule this module exists to keep: a stats failure never
    // surfaces to a reader, or to whatever called this.
    console.error("[views] recordView failed", err);
  }
}

export type StoryViewRow = {
  slug: string;
  headline: string;
  today: number;
  views7d: number;
  views30d: number;
  views: number;
};

export type ViewStats = {
  siteToday: number;
  siteTotal: number;
  site7d: number;
  site30d: number;
  /**
   * How many stories printed under a section the model did not choose
   * (0.6.67). Read out of the action log, which is where the desk records the
   * decision -- lead, the model's section, the editor's, and when. A count,
   * not a list: the logged line is JSON for a human to read, and the number is
   * what tells an editor whether the section the scanner picks is landing
   * where they actually file.
   */
  sectionOverrides: number;
  stories: StoryViewRow[];
};

/**
 * Editor-only aggregation for the Stats page. Not a createServerFn itself --
 * `requireEditor` is called directly, the same shape as
 * `savePaperConfig` in paper-settings.ts -- so a test can prove the refusal
 * without standing up the framework.
 */
export async function getViewStats(userId: string): Promise<ViewStats> {
  const editor = await requireEditor(userId);
  const newsroomId = editor.newsroomId;
  await ensureViewsSchema();
  const sql = await getSql();

  const [siteToday] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
      and day = current_date
  `;
  const [siteTotal] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
  `;
  const [site7d] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
      and day >= current_date - interval '6 days'
  `;
  const [site30d] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
      and day >= current_date - interval '29 days'
  `;

  // Left join, not inner: a published story with zero recorded views is
  // real information for this page (nothing is reading it), not a row to
  // hide. It sorts to the bottom on its own, coalesced to 0.
  const storyRows = await sql<{
    slug: string;
    headline: string;
    today: string | null;
    views_7d: string | null;
    views_30d: string | null;
    views: string | null;
  }>`
    select a.slug as slug, a.headline as headline,
      coalesce(sum(pv.count) filter (where pv.day = current_date), 0) as today,
      coalesce(sum(pv.count) filter (where pv.day >= current_date - interval '6 days'), 0) as views_7d,
      coalesce(sum(pv.count) filter (where pv.day >= current_date - interval '29 days'), 0) as views_30d,
      coalesce(sum(pv.count), 0) as views
    from articles a
    left join page_views pv
      on pv.newsroom_id = a.newsroom_id
      and pv.target = 'story:' || a.slug
      and pv.newsroom_id = ${newsroomId}
    where a.newsroom_id = ${newsroomId} and a.status = 'published'
    group by a.slug, a.headline
    order by coalesce(sum(pv.count), 0) desc, a.slug asc
  `;

  await ensureViewsStatsAuditEventsSchema();
  const [overrides] = await sql<{ c: number | null }>`
    select count(*)::int as c from audit_events
    where action = 'section-override' and newsroom_id = ${newsroomId}
  `;

  return {
    siteToday: Number(siteToday?.total ?? 0),
    siteTotal: Number(siteTotal?.total ?? 0),
    site7d: Number(site7d?.total ?? 0),
    site30d: Number(site30d?.total ?? 0),
    sectionOverrides: Number(overrides?.c ?? 0),
    stories: storyRows.map((r) => ({
      slug: r.slug,
      headline: r.headline,
      today: Number(r.today ?? 0),
      views7d: Number(r.views_7d ?? 0),
      views30d: Number(r.views_30d ?? 0),
      views: Number(r.views ?? 0),
    })),
  };
}

export const getViewStatsFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => getViewStats(context.userId));

/**
 * The beacon endpoint's whole body, pulled out of src/routes/api/view.ts so
 * a test can call it directly with a plain `Request` instead of standing up
 * the router. Always answers 204, whatever the body contains, whatever the
 * rate cap decided, and whatever `recordView` did underneath -- see the module
 * docstring above for why.
 *
 * THE TWO BOUNDS (unit U17b). This endpoint was public, unauthenticated and
 * unbounded: no rate limit and no cap on the body (the finding is recorded in
 * the Stats acceptance spec section 1.10; the repo's own audit wording is at
 * artifacts/audit-townreporter-2026-08-29/01-engineering-deepdive.md:792).
 * Both bounds now live in src/lib/news/beacon-guard.server.ts -- one process
 * token bucket with no key of any kind, and a 2 KB body cap enforced by
 * counting bytes as they arrive. Neither reads a request header, and neither
 * changes this endpoint's contract: over the cap is still 204, and still
 * writes nothing.
 *
 * The import is DYNAMIC and inside the handler, not at the top of this file.
 * `beacon-guard` is a `*.server.ts` -- it holds process-wide state -- and this
 * file is in the client graph, because `desk.stats.tsx` imports
 * `getViewStatsFn` from it. A static import is denied by TanStack's
 * import-protection (the `*.server.*` file pattern, in the client
 * environment) and took the whole build down when this unit first shipped; the
 * focused suite did not catch it because no unit test builds the client
 * bundle. This is the same shape src/routes/api/read.ts uses, for the same
 * reason.
 */
export async function viewBeaconHandler(request: Request): Promise<Response> {
  try {
    const { readBeaconJson, takeBeaconToken } = await import("./beacon-guard.server.ts");
    if (!takeBeaconToken()) return new Response(null, { status: 204 });
    const body: unknown = await readBeaconJson(request);
    const target =
      body && typeof body === "object" && "target" in body
        ? (body as { target?: unknown }).target
        : undefined;
    await recordView(target);
  } catch {
    // A malformed body is just another target recordView will not
    // recognise. Either way, this endpoint never fails outward.
  }
  return new Response(null, { status: 204 });
}
