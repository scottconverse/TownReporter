/**
 * Following a directory page's links into the registry (Scott, Nov 20 2026).
 *
 * The scan reads a directory source and already knows the article links that
 * page carried (`fetchUrl` returns them as `storyLinks`). The ones that name an
 * organization's own page, or another page on the directory's site, become new
 * registry sources so the next scan reads them too. The pure choice of which
 * links qualify lives in `registry-auto-grow.ts`; this file only writes.
 *
 * Bounds, both enforced here because this is the only writer:
 *  - at most `MAX_LINKED_SOURCES_PER_DAY` new sources a day, counted from the
 *    `resource_sources` rows this feature created today;
 *  - never more than `MAX_REGISTRY_SOURCES_TOTAL` registry sources in the
 *    newsroom.
 *
 * Dedupe is `sourceIdentity` over every URL the newsroom already has, the same
 * unit `insertProposedNewsroomSource` uses, so `http://x/` and `https://www.x`
 * are one page and a second pass adds nothing.
 */

import type { Sql } from "../../db.ts";
import { kindFromSourceUrl, tierFromKind } from "../desk-copy.ts";
import { sourceIdentity } from "../url-guard.ts";
import {
  MAX_LINKED_SOURCES_PER_DAY,
  MAX_REGISTRY_SOURCES_TOTAL,
  selectLinkedRegistrySources,
  type DirectoryPageForLinks,
} from "./registry-auto-grow.ts";
import { markRegistrySource } from "./registry-sources.server.ts";

export interface FollowDirectoryLinksInput {
  newsroomId: number;
  userId: string;
  /** The directory pages this run read, with the links each one carried. */
  pages: DirectoryPageForLinks[];
}

export interface FollowDirectoryLinksResult {
  /** New sources created and marked with a registry role. */
  added: number;
  /** Links that qualified once the caps are spent; 0 when the caps are full. */
  skipped: number;
}

/** How many registry sources this newsroom has now. */
async function registrySourceCount(sql: Sql, newsroomId: number): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    "select count(*)::text as count from resource_sources where newsroom_id = $1",
    [newsroomId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * How many registry sources this feature created today. The organization and
 * service roles are the linked ones; `directory` is the seeded backbone, which
 * the cap does not count against.
 */
async function linkedSourcesCreatedToday(sql: Sql, newsroomId: number): Promise<number> {
  const rows = await sql.query<{ count: string }>(
    `select count(*)::text as count
       from resource_sources
      where newsroom_id = $1
        and registry_role in ('organization', 'service')
        and created_at >= date_trunc('day', now())`,
    [newsroomId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Every URL identity this newsroom already has, whatever its status. */
async function existingIdentities(sql: Sql, newsroomId: number): Promise<Set<string>> {
  const rows = await sql.query<{ url: string }>(
    "select url from sources where newsroom_id = $1",
    [newsroomId],
  );
  const identities = new Set<string>();
  for (const row of rows) {
    const identity = sourceIdentity(row.url);
    if (identity) identities.add(identity);
  }
  return identities;
}

/**
 * Add the qualifying links as accepted sources with a registry role. Runs in
 * the caller's transaction, so a scan's link-following commits or rolls back
 * with the rest of the run.
 *
 * A new row is `status='accepted'` because Scott's Nov 7 order says entries
 * from official sources need no editor OK. It is not published as a registry
 * entry by itself; the entry is published when a scan reads the page and finds
 * a service in it (see `scan-changes.server.ts`).
 */
export async function followDirectoryLinksIn(
  sql: Sql,
  input: FollowDirectoryLinksInput,
): Promise<FollowDirectoryLinksResult> {
  if (!input.pages.length) return { added: 0, skipped: 0 };

  const [total, createdToday] = await Promise.all([
    registrySourceCount(sql, input.newsroomId),
    linkedSourcesCreatedToday(sql, input.newsroomId),
  ]);
  const dailyRemaining = Math.max(0, MAX_LINKED_SOURCES_PER_DAY - createdToday);
  const totalRemaining = Math.max(0, MAX_REGISTRY_SOURCES_TOTAL - total);
  if (dailyRemaining === 0 || totalRemaining === 0) {
    return { added: 0, skipped: input.pages.reduce((n, p) => n + p.links.length, 0) };
  }

  const selected = selectLinkedRegistrySources({
    pages: input.pages,
    existingIdentities: await existingIdentities(sql, input.newsroomId),
    dailyRemaining,
    totalRemaining,
  });

  let added = 0;
  for (const source of selected) {
    const kind = kindFromSourceUrl(source.url);
    const [row] = await sql.query<{ id: number }>(
      `insert into sources (user_id, newsroom_id, url, title, kind, tier, status)
       values ($1, $2, $3, $4, $5, $6, 'accepted')
       on conflict (user_id, newsroom_id, url) do nothing
       returning id`,
      [input.userId, input.newsroomId, source.url, source.title, kind, tierFromKind(kind)],
    );
    if (!row) continue;
    const created = await markRegistrySource(sql, {
      newsroomId: input.newsroomId,
      sourceId: Number(row.id),
      registryRole: source.registryRole,
      directoryName: null,
    });
    if (created) added += 1;
  }
  return { added, skipped: Math.max(0, selected.length - added) };
}
