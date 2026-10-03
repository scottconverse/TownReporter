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

/*
  State names -> postal codes, keyed the way a host would spell the name
  (`newyork`, not "New York"). The rule below reads this in both directions: a
  city may qualify itself with its state's name (`bouldercolorado.gov`) or with
  its two-letter code (`boulderco.gov`), and a `.us` address names its state on
  the way in (`longmont.co.us`, registered under the state's own `co.us`).
*/
const STATE_CODES: Record<string, string> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  districtofcolumbia: "dc",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  newhampshire: "nh",
  newjersey: "nj",
  newmexico: "nm",
  newyork: "ny",
  northcarolina: "nc",
  northdakota: "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  rhodeisland: "ri",
  southcarolina: "sc",
  southdakota: "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  westvirginia: "wv",
  wisconsin: "wi",
  wyoming: "wy",
  americansamoa: "as",
  guam: "gu",
  northernmarianaislands: "mp",
  puertorico: "pr",
  virginislands: "vi",
};

const STATE_CODE_SET = new Set(Object.values(STATE_CODES));

/** The postal code of a configured state, however it is written ("Colorado", "CO"). */
function stateCode(state: string | null | undefined): string {
  const key = citySlug(String(state ?? ""));
  if (!key) return "";
  return STATE_CODE_SET.has(key) ? key : (STATE_CODES[key] ?? "");
}

/*
  What a jurisdiction that is NOT the city adds to the city's name: the county,
  the school district, the library district, the water district. A label ending
  in one of these belongs to that body however it is spelled.

  `co` is on the list because a label ending in it is at least as likely to be a
  county as it is to be a town qualified by Colorado's postal code. The one
  reading that settles it is the newsroom's own state, and that is decided in
  `isCityLabel`, not here.
*/
const BORROWED_SUFFIXES = new Set([
  "co",
  "county",
  "cos",
  "parish",
  "school",
  "schools",
  "schooldistrict",
  "district",
  "library",
  "parks",
  "police",
  "fire",
  "sheriff",
  "water",
  "utility",
  "chamber",
]);

/**
 * The label a `.gov` or `.us` host is registered under, and the state that
 * registration names, or `""`/null when the host has no registrable label to
 * read.
 *
 * `.gov` registers the name immediately left of it: `longmontcolorado` in
 * `longmontcolorado.gov`. `.us` names a state on the way in -- `longmont.co.us`
 * is registered under the state's own `co.us` suffix -- so a state code sitting
 * immediately left of `.us` is part of the suffix, not the name.
 *
 * The state is returned rather than dropped because it is the host's own claim
 * about where it is, and `cityOfficialHost` has to be able to check it against
 * the newsroom's: `boulder.ny.us` is a New York registration whose label reads
 * `boulder`, and reading it as this paper's Boulder is the same mistake as
 * taking the county for the city.
 *
 * This is what refuses `longmontcolorado.gov.evil.us`: the label where the
 * city's name would have to be is `evil`, and the city's name is only a label
 * of the attacker's own subdomain.
 */
function registrableLabel(host: string): { label: string; stateScope: string | null } {
  const labels = host.split(".");
  if (labels.length < 2) return { label: "", stateScope: null };
  const stateScoped =
    labels[labels.length - 1] === "us" &&
    labels.length >= 3 &&
    STATE_CODE_SET.has(labels[labels.length - 2]!);
  const index = labels.length - (stateScoped ? 3 : 2);
  return {
    label: index >= 0 ? labels[index]! : "",
    stateScope: stateScoped ? labels[labels.length - 2]! : null,
  };
}

/**
 * Whether a host's registrable label is the city's own.
 *
 * A substring is not an answer. `bouldercounty.gov` carries `boulder`, and it
 * is the county standing in for the city -- the exact failure this rule was
 * rewritten for. So the label has to BE the city: `boulder`, `bouldercolorado`,
 * `boulderco` (Colorado only), `cityofboulder`, `bouldercity`; and it has to be
 * the whole registrable label, so `notlongmont-news.us` is nobody.
 *
 * Hyphens are how a host writes a name the city spells with a space or a dot,
 * and they are stripped on both sides of the comparison: `stlouis-mo.gov` for
 * St. Louis, `salem-or.gov` and `salem-oregon.gov` for Salem, Oregon. The
 * hyphen is punctuation the DNS label cannot carry, not part of the name -- so
 * `palo-alto.gov` reads the same as `paloalto.gov`. Nothing else is stripped:
 * a label that is not the city's name with hyphens removed is still not the
 * city, and a hyphen cannot manufacture a match (`not-longmont-news.us` is
 * `notlongmontnews`, which does not start with `longmont`).
 */
function isCityLabel(label: string, slug: string, state: string): boolean {
  const bare = label.replace(/-/g, "");
  if (!bare) return false;
  if (bare === slug) return true;
  if (bare === `cityof${slug}` || bare === `${slug}city`) return true;
  if (!bare.startsWith(slug)) return false;
  const rest = bare.slice(slug.length);
  const code = stateCode(state);
  // "boulderco.gov" is Boulder County in one reading and Boulder, Colorado in
  // another. Only the newsroom's own state can tell them apart.
  if (rest === "co") return code === "co";
  if (BORROWED_SUFFIXES.has(rest)) return false;
  // bouldercolorado.gov, boulderoregon.gov: the state's name, spelled out. It
  // names its own state, so it needs no help -- but when the newsroom's state
  // is known, it is the only state that qualifies THIS city's site.
  if (STATE_CODES[rest]) return code === "" || STATE_CODES[rest] === code;
  // boulderor.gov: the state's postal code, which only `state` can supply.
  return code !== "" && rest === code;
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
 *  - The city's own name as the host's registrable label: `longmontcolorado`
 *    in `longmontcolorado.gov`, `longmont` in `ci.longmont.co.us`. Multi-word
 *    cities are joined the way a host joins them, so "Palo Alto" looks for
 *    `paloalto.gov`. Subdomains to the LEFT of that label are the city's own
 *    (`www.`, `ci.`, `library.`); labels to the right of it are not, which is
 *    what makes `longmontcolorado.gov.evil.us` somebody else's host.
 *
 * A host whose label is the plain city name beats one that qualifies the name
 * with its state, whatever order the candidates arrive in: `boulder.gov` is a
 * better answer than `bouldercolorado.gov`.
 *
 * `state` is the newsroom's own state, and it settles the one genuinely
 * ambiguous label: `boulderco.gov` is read as the city only in Colorado, and as
 * the county's anywhere else. It is optional -- `<slug><statename>` identifies
 * itself without it -- and it is the only reason a two-letter `<slug><st>` is
 * ever accepted. It also has to agree with a `.us` host's own state: a
 * `boulder.ny.us` is New York's registration, not this paper's Boulder.
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
export function cityOfficialHost(
  city: string,
  hosts: readonly string[],
  state = "",
): string | null {
  const slug = citySlug(city);
  if (slug.length < 4) return null;
  const code = stateCode(state);
  let best: string | null = null;
  let bestIsExact = false;
  for (const raw of hosts) {
    const host = String(raw ?? "").trim().replace(/^www\./i, "").toLowerCase();
    if (!host || !/\.(gov|us)$/.test(host)) continue;
    const { label, stateScope } = registrableLabel(host);
    /*
      A `.us` address names its own state on the way in (`boulder.ny.us` is
      registered under New York's `ny.us`), and a newsroom in Colorado has no
      business reading that as its Boulder -- the city's name there sits in a
      New York registration, which is somebody else's host however it is
      spelled. Refused rather than down-weighted, because the wrong state is
      not a weaker answer; it is a different city's address.

      The host's claim stands unopposed when the paper has not said what state
      it is in, exactly as `<slug><state name>` does: with nothing to compare
      against, the host that names its own state is the more specific reading.
    */
    if (stateScope && code && stateScope !== code) continue;
    if (!isCityLabel(label, slug, state)) continue;
    // An exact city label wins over every other candidate, wherever it sits in
    // the list; otherwise the first acceptable candidate keeps it. Hyphens are
    // not part of the name, so `st-louis.gov` is as exact as `stlouis.gov`.
    const exact = label.replace(/-/g, "") === slug;
    if (best !== null && (bestIsExact || !exact)) continue;
    best = host;
    bestIsExact = exact;
  }
  return best;
}

/** Prefer inferred government hosts, then the configured city site on any TLD. */
export function officialSiteHost(
  city: string,
  sources: readonly { url: string; kind?: string | null; title?: string | null }[],
  state = "",
): string | null {
  const officialHosts: string[] = [];
  for (const source of sources) {
    if ((source.kind ?? "").trim().toLowerCase() !== "official") continue;
    const host = hostOf(source.url);
    if (host) officialHosts.push(host);
  }
  const inferred = cityOfficialHost(city, officialHosts, state);
  if (inferred) return inferred;
  const slug = citySlug(city);
  if (!slug) return null;
  for (const source of sources) {
    if ((source.kind ?? "").trim().toLowerCase() !== "official") continue;
    const host = hostOf(source.url);
    if (!host || /\.(gov|us)$/.test(host)) continue;
    const title = String(source.title ?? "");
    // The configured title identifies abbreviated hosts such as fcgov.com.
    const cityTitle = citySlug(title) === slug || citySlug(title) === `cityof${slug}`;
    const label = registrableLabel(host).label;
    // Initials alone are not unique (fcgov.com is Fort Collins, not Foster City), so an
    // abbreviated host counts only when the source's own title names this city.
    if (cityTitle || isCityLabel(label, slug, state)) return host;
  }
  return null;
}

/** The scope a PaperConfig describes. See the type note above. */
export function researchScopeOf(paper: {
  city: string;
  state?: string | null;
  seedSources?: readonly { url: string; kind?: string | null; title?: string | null }[] | null;
}): ResearchScope {
  const city = paper.city.trim();
  const state = (paper.state ?? "").trim();
  return {
    city,
    state,
    // The state goes with the city: it is what makes `boulderco.gov` the city
    // in Colorado and a county anywhere else.
    officialHost: officialSiteHost(city, paper.seedSources ?? [], state),
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
