import type { Sql } from "../db.ts";
import { primeGovOriginFromSources } from "./primegov.ts";

/**
 * Which PrimeGov portal this newsroom watches.
 *
 * The watch list is the configuration: an editor adds the city's public portal
 * (`https://{tenant}.primegov.com/public/portal`) as an ordinary source, and the
 * first ACCEPTED source whose host is a PrimeGov tenant is the portal. No
 * second setting to keep in step with the watch list, and no portal at all is a
 * real answer -- a caller that gets null must skip the lookup instead of asking
 * some other city's portal.
 *
 * Accepted only, not the whole watch list: "proposed" is an editor's inbound
 * queue, and a row nobody has approved must not decide where the desk reads.
 * Id order is the watch list's own within-group order, so "first" means the
 * same row an editor would point at.
 *
 * Reads through the caller's `Sql` so the section-5 run asks inside the
 * transaction it is already in; `primegov-source.server.ts` is the same read
 * for callers that have no handle yet. The import of `Sql` is type-only, so
 * this module stays loadable by a test with no database.
 */
export async function primeGovOriginForNewsroom(sql: Sql, newsroomId: number): Promise<string | null> {
  const rows = await sql.query<{ url: string }>(
    "select url from sources where newsroom_id=$1 and status='accepted' order by id",
    [newsroomId],
  );
  return primeGovOriginFromSources(rows.map((row) => row.url));
}
