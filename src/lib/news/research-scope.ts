import { citySlug } from "./absence-gate.ts";

/**
 * What a research query is scoped to: the paper's own configuration, or
 * nothing.
 *
 * The research helpers used to carry the shipped paper's town as a default
 * (`city = "Longmont"` on strategiesForFrontier, queriesForRef and
 * primarySourceQueries) and one of their queries was hard-wired to
 * `site:longmontcolorado.gov`. A paper set up for another city therefore wrote
 * Longmont into its own searches. That is the same failure class as the
 * PrimeGov portal and the council-vote record (sixdesk ENG-3): the
 * configuration existed, and the code fell back to the shipped town anyway.
 *
 * All three fields are read from paper settings -- name/city/state from the
 * identity fields, the official host from the city's own government address in
 * the configured source list (see `officialSiteHost` below). `getPaperConfig`
 * has already merged the shipped constants column by column, so the shipped
 * install answers with its own city here; that is configuration, not a second
 * fallback inside these helpers.
 *
 * Empty and null are real answers. A paper that has not named a city gets
 * queries with no city in them rather than another town's.
 */
export type ResearchScope = {
  city: string;
  state: string;
  /** Host of the city's own official site, or null when none can be identified. */
  officialHost: string | null;
};

/** The scope of a paper that has answered nothing: no city, no state, no official host. */
export const NO_RESEARCH_SCOPE: ResearchScope = { city: "", state: "", officialHost: null };

/** `example.gov` from `https://www.example.gov/path`. Null when the row is not an http(s) link. */
function hostOf(raw: string): string | null {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The CITY's own official host among candidates, or null.
 *
 * "The first official source" is not the same answer, and U13b shipped that
 * mistake in two places at once. The watch list is not a list of city
 * websites: it holds a vendor meeting portal, the county, the school district,
 * a utility, and outlets an editor filed as official. Taking the first
 * `kind = "official"` row scoped research to `site:timescall.com` -- a
 * newspaper, scoped as if it were the city's own record. Taking the first
 * tier-A `.gov` (the head of the Dark Desk's tier list, which the research loop
 * and the adversarial search both read) gives whichever of bouldercounty.gov,
 * colorado.gov or longmontcolorado.gov was filed first, so the county's or the
 * state's site stood in for the city's.
 *
 * Two things are therefore required together, in this order of preference over
 * the candidates:
 *
 *  - A government address: `.gov` or `.us`. A commercial host is never the
 *    city, whatever it is called -- longmontleader.com carries the town's name
 *    and is emphatically not the city (see `officialDomains` in
 *    ./absence-gate.ts, where that lesson is written down).
 *  - The city's own name in the host: `longmont` in `longmontcolorado.gov`,
 *    `ci.longmont.co.us`. Multi-word cities are joined the way a host joins
 *    them, so "Palo Alto" looks for `paloalto.gov`.
 *
 * No match is a real answer, and the callers' answer is to write no `site:`
 * operator at all: a `site:` naming a neighbouring town, a county, a state or
 * a publisher reads as an answer when it is not one.
 *
 * Two shapes deliberately yield nothing rather than a guess. A city name
 * shorter than four characters cannot identify a host -- the same floor
 * `officialDomains` uses, and the reason `ada.gov` is not a town -- and a city
 * whose site abbreviates its name (Fort Collins' fcgov.com) is not recognised
 * from its name alone.
 */
export function cityOfficialHost(city: string, hosts: readonly string[]): string | null {
  const slug = citySlug(city);
  if (slug.length < 4) return null;
  for (const raw of hosts) {
    const host = String(raw ?? "").trim().replace(/^www\./i, "").toLowerCase();
    if (!host || !/\.(gov|us)$/.test(host)) continue;
    if (!host.includes(slug)) continue;
    return host;
  }
  return null;
}

/** The same rule over the paper's configured sources, official ones only. */
export function officialSiteHost(
  city: string,
  sources: readonly { url: string; kind?: string | null }[],
): string | null {
  const officialHosts: string[] = [];
  for (const source of sources) {
    if ((source.kind ?? "").trim().toLowerCase() !== "official") continue;
    const host = hostOf(source.url);
    if (host) officialHosts.push(host);
  }
  return cityOfficialHost(city, officialHosts);
}

/** The scope a PaperConfig describes. See the type note above. */
export function researchScopeOf(paper: {
  city: string;
  state?: string | null;
  seedSources?: readonly { url: string; kind?: string | null }[] | null;
}): ResearchScope {
  const city = paper.city.trim();
  return {
    city,
    state: (paper.state ?? "").trim(),
    officialHost: officialSiteHost(city, paper.seedSources ?? []),
  };
}

/**
 * Join the parts of a query, dropping the ones configuration did not answer.
 *
 * `"Acme LLC" ${city}` with an unconfigured paper would otherwise leave a
 * dangling space (and, before this, named Longmont instead).
 */
export function scopedQuery(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}
