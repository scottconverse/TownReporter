import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
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
export async function ensureViewsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists page_views (
      newsroom_id integer not null default 1,
      target text not null,
      day date not null,
      count bigint not null default 0,
      primary key (newsroom_id, target, day)
    )
  `);
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
  views: number;
};

export type ViewStats = {
  siteTotal: number;
  site7d: number;
  site30d: number;
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

  const [siteTotal] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
  `;
  const [site7d] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
      and day >= current_date - interval '7 days'
  `;
  const [site30d] = await sql<{ total: string | null }>`
    select sum(count) as total from page_views
    where newsroom_id = ${newsroomId} and target = ${SITE_TARGET}
      and day >= current_date - interval '30 days'
  `;

  // Left join, not inner: a published story with zero recorded views is
  // real information for this page (nothing is reading it), not a row to
  // hide. It sorts to the bottom on its own, coalesced to 0.
  const storyRows = await sql<{ slug: string; headline: string; views: string | null }>`
    select a.slug as slug, a.headline as headline, coalesce(sum(pv.count), 0) as views
    from articles a
    left join page_views pv
      on pv.newsroom_id = a.newsroom_id
      and pv.target = 'story:' || a.slug
      and pv.newsroom_id = ${newsroomId}
    where a.newsroom_id = ${newsroomId} and a.status = 'published'
    group by a.slug, a.headline
    order by coalesce(sum(pv.count), 0) desc, a.slug asc
  `;

  return {
    siteTotal: Number(siteTotal?.total ?? 0),
    site7d: Number(site7d?.total ?? 0),
    site30d: Number(site30d?.total ?? 0),
    stories: storyRows.map((r) => ({
      slug: r.slug,
      headline: r.headline,
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
 * the router. Always answers 204, whatever the body contains or whatever
 * `recordView` did underneath -- see the module docstring above for why.
 */
export async function viewBeaconHandler(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
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
