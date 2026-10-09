import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";

/**
 * The page watches a stopped re-check agent left behind.
 *
 * A re-check run creates or wakes a `source_monitors` watch (`createPageWatchFor`,
 * ./page-watch.ts) and that row is picked up by the background clock for as long
 * as nobody turns it off. Stopping the follow-up does NOT turn it off, and this
 * build deliberately does not do it for the editor: the watch row is SHARED --
 * `createPageWatchFor` returns `alreadyExists` for any manual watch on the same
 * URL, and it can even convert an automatic monitor into a manual one -- so
 * "this follow-up created it" is not recorded anywhere and cannot be recovered
 * from the row. Disabling it on Stop would sometimes stop the editor's own watch,
 * and would permanently break every other follow-up watching that URL (a stopped
 * manual watch is never re-enabled by `createPageWatchFor`, and
 * `checkPageWatchFor` refuses to claim anything but an `active` one).
 *
 * So the card says what is true and takes the editor to the screen that owns the
 * decision: **Dark Desk → Watch a page / view watches**, where a watch can be
 * paused or stopped by hand. `docs/manual.md` says the same thing in the
 * operator's words.
 *
 * The read is one query per screen, not per card: the follow-ups screen draws a
 * handful of cards and asks once (see `useFollowUpWatchNotices` in the route),
 * exactly like the live-run lookup next to it.
 */

/** One stopped follow-up with at least one watch still on. */
export type FollowUpWatchNotice = {
  /** The `follow_ups` id the card belongs to. */
  followUpId: number;
  /** The watch's canonical URL -- what is actually still being polled. */
  url: string;
};

/**
 * Which of these follow-ups still have a watch on one of their targets.
 *
 * Pure, so the matching rule is a sentence a test can assert: canonicalise both
 * sides (`canonicalPublicUrl` is what `createPageWatchFor` stores, and the row's
 * `targets_json` holds the editor's URL as typed) and compare. A target that
 * cannot be parsed matches nothing, which is the honest answer -- it never
 * produced a watch either.
 */
export function watchNoticesFor(
  followUps: { id: number; targets_json: string }[],
  watchUrls: string[],
): FollowUpWatchNotice[] {
  const watched = new Set(watchUrls.map(canonical).filter((url): url is string => url !== null));
  if (!watched.size) return [];
  const out: FollowUpWatchNotice[] = [];
  for (const row of followUps) {
    for (const target of parseTargets(row.targets_json)) {
      const url = canonical(target);
      // One notice per URL, even if two targets canonicalise to the same page.
      if (url && watched.has(url) && !out.some((n) => n.followUpId === row.id && n.url === url)) {
        out.push({ followUpId: row.id, url });
      }
    }
  }
  return out;
}

function canonical(raw: string): string | null {
  try {
    return canonicalPublicUrl(raw);
  } catch {
    return null;
  }
}

function parseTargets(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const targets: unknown = Array.isArray(parsed) ? parsed : parsed?.targets;
    return Array.isArray(targets) ? targets.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Every stopped or finished re-check agent in this newsroom whose target still
 * has a manual watch switched on.
 *
 * `stopped` AND `done`: both cards are terminal and both leave the watch
 * running, and the card that says nothing about it is the one that misleads.
 * A `paused` agent is deliberately absent -- it will run again, so its watch is
 * not a leftover.
 *
 * Only rows with a method of `recheck` are considered: `search` and `agenda`
 * never create a watch, so a notice for one would be a false alarm.
 *
 * A `perform*` function with a thin `createServerFn` over it, the same shape
 * every other read in this feature has (see ./follow-ups.ts): the screen calls
 * the wrapper, and the test calls this.
 */
export async function performListFollowUpWatchNotices(context: {
  userId: string;
  newsroomId?: number;
}): Promise<FollowUpWatchNotice[]> {
  const sql = await getSql();
  const newsroomId = context.newsroomId ?? 1;
  /*
    `ensurePageWatchSchema` is what creates `source_monitors` on a database
    that has never watched a page (the embedded PGlite path runs no
    migrations). It is imported here rather than at the top of the file for the
    reason ./job-progress.ts gives for its own late imports: this module is in
    the client bundle graph, and ./page-watch.ts reaches the fetch and ingest
    engines, none of which a browser may load.
  */
  const { ensurePageWatchSchema } = await import("./page-watch.ts");
  await ensurePageWatchSchema();
  const followUps = await sql<{ id: number; targets_json: string }>`
    select id, targets_json from follow_ups
    where newsroom_id = ${newsroomId}
      and status in ('stopped', 'done')
      and agent_kind = 'recheck'
    order by id desc
    limit 50
  `;
  if (!followUps.length) return [];
  const watches = await sql<{ url: string }>`
    select url from source_monitors
    where newsroom_id = ${newsroomId} and manual_watch = true and enabled = true
    limit 500
  `;
  return watchNoticesFor(followUps, watches.map((watch) => watch.url));
}

export const listFollowUpWatchNotices = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }) => performListFollowUpWatchNotices(context));
