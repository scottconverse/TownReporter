import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { primeGovOriginForNewsroom } from "./primegov-source.ts";

/**
 * The newsroom's PrimeGov portal, for callers that do not already hold a
 * database handle.
 *
 * `ingestYoutube` is the one such caller: its title-to-meeting lookup needs to
 * know which portal to ask, and `ingestUrl` (which reaches it) carries no
 * newsroom argument -- the YouTube settings that function already reads are the
 * default newsroom's, and the portal is read from the same place for the same
 * reason. `runSection5ForArtifact` asks through its own transaction instead
 * (`primeGovOriginForNewsroom`).
 *
 * A database that cannot be read throws; callers for which the portal is a
 * sibling record, not the point of the run, catch it and treat it as "no portal
 * configured" -- never as another city's portal.
 */
export async function currentPrimeGovOrigin(
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<string | null> {
  return primeGovOriginForNewsroom(await getSql(), newsroomId);
}
