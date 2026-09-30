import type { Sql } from "../db.ts";
import { COUNCIL_VOTES_URL } from "../paper.ts";

/**
 * Where this newsroom's structured vote records live.
 *
 * The watch list cannot answer this one. A council that publishes its own
 * motion-by-motion record does it on a site of its own -- Longmont's is
 * longmontcitycouncil.org, which is neither the city's .gov nor the meeting
 * portal -- so there is no host pattern to recognise the way
 * `primeGovOriginFromSources` recognises a PrimeGov tenant. The paper says
 * where its council's votes are published: Paper setup's "council votes" field,
 * stored as `paper_settings.council_votes_url` and read here.
 *
 * No setting is a real answer. The setup form stores an empty string for a
 * paper with no such site, and an empty string means there is no structured
 * vote record to read -- so the lookup is skipped rather than asked of another
 * city's website. (Before this, the origin was the constant
 * `https://longmontcitycouncil.org` inside the fetch adapter, so every paper's
 * section 5 read Longmont's council motions.)
 */

/** An http(s) origin, or null when the setting is blank or is not a usable URL. */
export function structuredVoteOriginFromSetting(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The origin for one newsroom, read through the caller's own `Sql` so the
 * section-5 run asks inside the transaction it is already in (the same shape as
 * `primeGovOriginForNewsroom`).
 *
 * A missing row, or a NULL column, is an install that has never been asked:
 * that is the shipped configuration, whose council-votes site is the shipped
 * constant. That is the same merge rule `mergeRow` in ./paper-settings.ts
 * applies, kept here so the section-5 run does not need a second database
 * handle. A read that fails is treated as "nothing configured" -- never as
 * another city's site.
 */
export async function structuredVoteOriginForNewsroom(
  sql: Sql,
  newsroomId: number,
): Promise<string | null> {
  const rows = await sql
    .query<{ council_votes_url: string | null }>(
      "select council_votes_url from paper_settings where newsroom_id=$1 limit 1",
      [newsroomId],
    )
    .catch(() => [] as { council_votes_url: string | null }[]);
  const stored = rows[0]?.council_votes_url;
  return structuredVoteOriginFromSetting(stored == null ? COUNCIL_VOTES_URL : stored);
}
