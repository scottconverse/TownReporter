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
 * identity fields, the official host from the first source an editor marked
 * official (the same set `officialDomains` in ./absence-gate.ts builds the
 * desk's trust anchor from). `getPaperConfig` has already merged the shipped
 * constants column by column, so the shipped install answers with its own city
 * here; that is configuration, not a second fallback inside these helpers.
 *
 * Empty and null are real answers. A paper that has not named a city gets
 * queries with no city in them rather than another town's.
 */
export type ResearchScope = {
  city: string;
  state: string;
  /** Host of the paper's own official site, or null when it has none configured. */
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
 * The host of the paper's own official site: the first source an editor marked
 * official, in watch-list order.
 *
 * Null when nothing is marked official. Callers that would write a `site:`
 * operator must leave it out rather than guess a host -- a `site:` naming
 * another town's government is worse than no operator at all, because it reads
 * as an answer.
 */
export function officialSiteHost(
  sources: readonly { url: string; kind?: string | null }[],
): string | null {
  for (const source of sources) {
    if ((source.kind ?? "").trim().toLowerCase() !== "official") continue;
    const host = hostOf(source.url);
    if (host) return host;
  }
  return null;
}

/** The scope a PaperConfig describes. See the type note above. */
export function researchScopeOf(paper: {
  city: string;
  state?: string | null;
  seedSources?: readonly { url: string; kind?: string | null }[] | null;
}): ResearchScope {
  return {
    city: paper.city.trim(),
    state: (paper.state ?? "").trim(),
    officialHost: officialSiteHost(paper.seedSources ?? []),
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
