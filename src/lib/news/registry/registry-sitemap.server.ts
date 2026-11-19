/**
 * The sitemap's community-resource lines (Phase 4, P4-2): one
 * `/registry/<id>` for each published service, and nothing else.
 */
import type { Sql } from "../../db.ts";
import { listPublicRegistryServiceIds } from "./registry-public.server.ts";

/** Full URLs of the published services. An unreadable registry adds nothing. */
export async function registrySitemapLocations(
  getSql: () => Promise<Sql>,
  newsroomId: number,
  origin: string,
): Promise<string[]> {
  try {
    const ids = await listPublicRegistryServiceIds(await getSql(), newsroomId);
    return ids.map((id) => `${origin}/registry/${id}`);
  } catch {
    // Like the article list: a sitemap that 500s says the site is broken.
    return [];
  }
}
