/**
 * Finding a replacement for a source that will not read (unit SH0-8, free tier).
 *
 * WHAT THIS IS. When an editor has a source the desk cannot read, the next
 * question is "what else covers this?". Answering it well is mostly about
 * knowing what the source was FOR, and the honest structural finding behind
 * this module is that a beat here is not a property of a source at all: it is a
 * SECTION, and the only real signal is the one the owner wrote when they filed
 * the source (`section_sources`). Everything below resolves the beat from that
 * first and says nothing rather than guessing when it cannot.
 *
 * PURE, AND DELIBERATELY SO. Nothing here fetches, queries or reasons -- the
 * candidates come in as data (a sibling list, a sitemap's `<loc>`s), and what
 * comes out is a labelled, ordered list the editor judges. That is what makes
 * the two rules this unit exists for testable without a network:
 *
 *   1. THE PAPER'S OWN RECORD RANKS FIRST. When the newsroom's own official
 *      host is among the candidates it reads "Official record" and sits at the
 *      top, because it is the one source the desk can vouch for. The host is
 *      PASSED IN (`officialHost`), never guessed from a town name -- the same
 *      rule `cityOfficialHost` follows, and the reason this file names no city.
 *
 *   2. A LEGALLY DROPPED HOST IS NEVER OFFERED. `legal-removal-store.ts` sets
 *      `status='dropped'` on a source with a legal note when a publisher
 *      objects. Offering that host back to the editor as a replacement for
 *      something else -- in the same newsroom, one press away -- would undo a
 *      legal decision by accident. It is refused here, and the caller hands in
 *      the dropped hosts it read from the database.
 *
 * NO PATH IN THIS FILE ADDS ANYTHING. A candidate is a suggestion; the editor
 * accepts it through the existing review list, exactly as every other
 * suggestion. `never auto-add` is the owner's line and it starts here.
 */
import { looksLikeDocumentPath } from "./source-alternates.ts";

/** The three words an editor judges a candidate by. */
export const OFFICIAL_RECORD = "Official record";
export const JOURNALISM = "Journalism";
export const NOT_OFFICIAL = "Not official — check it yourself";

export type ReplacementLabel = typeof OFFICIAL_RECORD | typeof JOURNALISM | typeof NOT_OFFICIAL;

/**
 * How a candidate was found. Kept because the panel says it in the editor's
 * own words -- "another source on Planning" is a different claim from "found
 * on the city's own sitemap", and the editor should be able to tell which.
 */
export type ReplacementVia = "sibling" | "sitemap" | "sitemap-index" | "feed" | "canonical" | "moved";

export type ReplacementCandidate = {
  url: string;
  title?: string | null;
  /** The row's own kind, when the candidate came from a source the desk
   *  already holds. Sitemap candidates carry none. */
  kind?: string | null;
  via: ReplacementVia;
  /** The beat(s) that led here, so the panel can say which section. */
  beats?: readonly string[];
};

export type RankedCandidate = ReplacementCandidate & {
  host: string;
  label: ReplacementLabel;
  /** Lower sorts first. 0 is the paper's own record. */
  rank: number;
};

/** The host of an address, lower-cased and without `www.`, or null if it is
 *  not an http(s) address at all. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(String(url ?? "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeHost(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]!
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * Is this host one the newsroom has already removed for legal reasons?
 *
 * A subdomain counts as the same host: a publisher who objected to
 * `example.test` did not thereby agree to `data.example.test` being read.
 */
export function isRefusedHost(host: string, droppedHosts: readonly string[] | null | undefined): boolean {
  const target = normalizeHost(host);
  if (!target) return false;
  for (const raw of droppedHosts ?? []) {
    const dropped = normalizeHost(raw);
    if (!dropped) continue;
    if (target === dropped || target.endsWith(`.${dropped}`)) return true;
  }
  return false;
}

/** A readable name for a sitemap address, so the panel's row is not a URL and
 *  nothing at all. The last path segment, humanised; null for a bare host. */
export function titleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (!last) return null;
    const words = decodeURIComponent(last)
      .replace(/\.(pdf|html?|aspx?|php)$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!words) return null;
    return words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    return null;
  }
}

/**
 * WHAT THIS SOURCE IS FOR, in the order of who knows best.
 *
 *   1. THE SECTIONS IT IS FILED UNDER. `section_sources` is written by the
 *      owner or on an accept press, so it is the only one of the three that
 *      somebody actually decided. A source filed under two sections yields
 *      both -- the editor wants candidates for each, not a winner.
 *   2. `proposed_section`, the model's guess recorded with a suggestion (0097).
 *      Advisory, and only reached when nobody filed the source at all.
 *   3. THE SOURCE'S OWN TITLE, matched against the newsroom's OWN sections --
 *      never against a fixed vocabulary. A paper with no Planning section
 *      should not be told a candidate covers Planning.
 *
 * EMPTY IS A REAL ANSWER, and the panel must say so rather than guess. "We
 * cannot tell what this source was for" is a sentence the editor can act on;
 * a made-up beat is not.
 */
export function beatsForSource(input: {
  /** Section keys from `section_sources`. */
  sections?: readonly string[] | null;
  /** The advisory guess from 0097. A section KEY, not a name. */
  proposedSection?: string | null;
  title?: string | null;
  /** The newsroom's own sections, so a title word can be matched to a real
   *  section key rather than to something this file invented. */
  knownSections?: readonly { key: string; name: string }[];
}): string[] {
  const filed: string[] = [];
  for (const raw of input.sections ?? []) {
    const key = String(raw ?? "").trim();
    if (key && !filed.includes(key)) filed.push(key);
  }
  if (filed.length) return filed;

  const proposed = String(input.proposedSection ?? "").trim();
  if (proposed) return [proposed];

  return sectionsNamedInTitle(input.title, input.knownSections ?? []);
}

/**
 * The newsroom's sections whose NAME appears in the source's title.
 *
 * A whole-word match, and a floor of FIVE characters on the section's name.
 * The floor is what keeps this honest: "News" and "Arts" are real section
 * names and are also words that turn up in half the titles on a watch list, so
 * a name that short would manufacture a beat for almost every source and the
 * answer would be worse than none. Five is the shortest a section name can be
 * and still pick one beat out of a headline.
 */
export function sectionsNamedInTitle(
  title: string | null | undefined,
  knownSections: readonly { key: string; name: string }[],
): string[] {
  const text = String(title ?? "").toLowerCase();
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const section of knownSections) {
    const key = String(section?.key ?? "").trim();
    const name = String(section?.name ?? "").trim();
    if (!key || name.length < 5) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text) && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * OTHER SOURCES THE DESK ALREADY WATCHES ON THE SAME BEAT.
 *
 * Costs no fetch at all -- it is a read the caller has already made. The rows
 * handed in are expected to be the newsroom's ACCEPTED sources; a paused one
 * is still on the watch list, but offering the editor a replacement that the
 * scanner is not currently reading would be a strange promise, and the caller
 * filters.
 *
 * When nothing shares the beat the answer is an empty list, which the panel
 * turns into "Planning has only this one source" -- a fact about the newsroom
 * worth knowing, not a failure.
 */
export function siblingCandidates(
  sources: readonly {
    id: number;
    url: string;
    title?: string | null;
    kind?: string | null;
    /** The sections this row is filed under. */
    sections: readonly string[];
  }[],
  input: { sourceId: number; beats: readonly string[] },
): ReplacementCandidate[] {
  const wanted = new Set(
    input.beats.map((b) => String(b ?? "").trim().toLowerCase()).filter(Boolean),
  );
  if (!wanted.size) return [];
  const out: ReplacementCandidate[] = [];
  for (const source of sources) {
    if (source.id === input.sourceId) continue;
    const shared: string[] = [];
    for (const section of source.sections ?? []) {
      const key = String(section ?? "").trim().toLowerCase();
      if (key && wanted.has(key) && !shared.includes(key)) shared.push(key);
    }
    if (!shared.length) continue;
    out.push({
      url: source.url,
      title: source.title ?? null,
      kind: source.kind ?? null,
      via: "sibling",
      beats: shared,
    });
  }
  return out;
}

/**
 * THE CITY'S OWN RECORD, read out of its sitemap.
 *
 * `locsFromSitemap` (SH0-5) has already filtered a urlset down to document
 * addresses; this keeps the ones that also answer the beat, and drops the
 * rest. A `/budget/2027-adopted-budget.pdf` is a candidate for a source on
 * Budget; a `/parks/dog-park-hours` is not a candidate for anything.
 *
 * The caller has already established that these came from the newsroom's own
 * official host -- this function cannot know a host from a string of locs, and
 * does not pretend to.
 */
export function sitemapCandidates(
  locs: readonly string[],
  input: { beats?: readonly string[] } = {},
): ReplacementCandidate[] {
  const beats = (input.beats ?? []).map((b) => String(b ?? "").trim()).filter(Boolean);
  const out: ReplacementCandidate[] = [];
  const seen = new Set<string>();
  for (const raw of locs ?? []) {
    const host = hostOf(raw);
    if (!host || seen.has(raw)) continue;
    const path = (() => {
      try {
        const u = new URL(raw);
        return (u.pathname + u.search).toLowerCase();
      } catch {
        return "";
      }
    })();
    const hit = beats.find((beat) => beat.length >= 4 && path.includes(beat.toLowerCase()));
    if (!looksLikeDocumentPath(raw) && !hit) continue;
    seen.add(raw);
    out.push({
      url: raw,
      title: titleFromUrl(raw),
      via: "sitemap",
      beats: hit ? [hit] : [],
    });
  }
  return out;
}

/**
 * The word the editor judges a candidate by.
 *
 * "Official record" is claimed only where the desk has grounds: the newsroom's
 * OWN official host (passed in), a `.gov`/`.us` address, or a row the desk
 * already holds as `kind='official'`. Everything else is either Journalism --
 * the desk's own word for a news organisation -- or the honest remainder,
 * which tells the editor to check it themselves rather than implying a
 * judgement nobody made.
 */
export function candidateLabel(
  candidate: { url: string; kind?: string | null },
  officialHost?: string | null,
): ReplacementLabel {
  const host = hostOf(candidate.url);
  if (!host) return NOT_OFFICIAL;
  const own = normalizeHost(officialHost);
  if (own && (host === own || host.endsWith(`.${own}`))) return OFFICIAL_RECORD;
  if (/\.(gov|us)$/.test(host)) return OFFICIAL_RECORD;
  const kind = String(candidate.kind ?? "").trim().toLowerCase();
  if (kind === "official") return OFFICIAL_RECORD;
  if (kind === "news") return JOURNALISM;
  return NOT_OFFICIAL;
}

function rankOf(label: ReplacementLabel, host: string, officialHost?: string | null): number {
  const own = normalizeHost(officialHost);
  if (own && (host === own || host.endsWith(`.${own}`))) return 0;
  if (label === OFFICIAL_RECORD) return 1;
  if (label === JOURNALISM) return 2;
  return 3;
}

/**
 * The list the panel draws: refused, deduplicated, labelled, ordered.
 *
 * Order is by label first and by the caller's order inside a label, because
 * the caller knows things this function does not -- a sibling the desk already
 * reads is offered before the fortieth `<loc>` of a sitemap, and it says so by
 * handing them over in that order. `Array.prototype.sort` is stable, so that
 * ordering survives.
 *
 * THE REFUSALS ARE THE POINT. A candidate with no usable host, a duplicate of
 * one already kept, and -- above all -- any host the newsroom has legally
 * dropped, are all dropped here rather than filtered at a call site, so there
 * is exactly one place that can offer a replacement and exactly one rule it
 * obeys.
 */
export function rankCandidates(
  candidates: readonly ReplacementCandidate[],
  input: { officialHost?: string | null; droppedHosts?: readonly string[] | null } = {},
): RankedCandidate[] {
  const out: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates ?? []) {
    const host = hostOf(candidate.url);
    if (!host) continue;
    if (isRefusedHost(host, input.droppedHosts)) continue;
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    const label = candidateLabel(candidate, input.officialHost);
    out.push({
      ...candidate,
      host,
      label,
      rank: rankOf(label, host, input.officialHost),
    });
  }
  return out.sort((a, b) => a.rank - b.rank);
}
