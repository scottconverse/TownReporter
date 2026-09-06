/*
  The claims-of-absence gate.

  THE INCIDENT (2026-09-05, caught by an outside audit before publication).
  The desk drafted a story about the city's 2026 community satisfaction survey
  and printed this: "No city survey page, launch release or council agenda item
  confirming any of that was obtained for this piece", told readers to "treat
  the Sept. 7 date as unverified", and built a whole doubt frame on top of that
  absence. None of it was true. The city had a survey landing page, a banner on
  its home page, three dated news items and a short link, and a plain web search
  returned the page as a top hit.

  Two machine failures produced that sentence, and this module answers both.

  1. The research pass runs with NO tools by design -- the app fetches, the
     model reads. The model wrote "RESEARCH BLOCKED: WebSearch and WebFetch
     permissions were not granted this session" into its unknowns, and the
     write pass carried that into the body. A sentence about the model's own
     tooling was printed as a fact about the City. Prompts now forbid it
     (report.ts); this module is the gate that assumes the prompt will be
     ignored, because it was.

  2. Nothing stood between "the draft asserts X does not exist" and "the app
     actually looked for X". Now something does: every sentence that claims an
     absence triggers a real site-restricted search of the paper's own city
     domain. A hit that was not already in evidence forces one redraft with
     that document added. No hit downgrades the sentence to the only honest
     version of itself -- what TownReporter did not find among the documents it
     opened -- and raises a checkbox the editor must tick before Publish.

  Code, not prose. A rule that lives only in a prompt is a rule the next model
  may ignore, and this one already did.
*/

export type GateEntryKind = "tool-talk" | "absence";

export type GateEntry = {
  kind: GateEntryKind;
  /** The sentence as it was written, before the gate touched it. */
  sentence: string;
  /** What the gate did, in the editor's language. */
  action: string;
  /** The document the gate found, when it found one. */
  url?: string;
  /** The query that found a hit, or the last one tried when the ladder came up empty. */
  query?: string;
  /**
   * Every query the absence ladder ran for this sentence, in order, with
   * whether it hit -- so the gate record (and the story page) can show the
   * editor everything the app already checked, not just the first miss.
   */
  steps?: LadderStep[];
  /** The plain-language line the editor sees beside the checkbox. */
  summary?: string;
  /** True when an editor must confirm this claim by hand before the story prints. */
  needsCheck?: boolean;
};

export type PullRecord = {
  /** The memo's own ask, verbatim. */
  ask: string;
  query: string;
  url: string | null;
  fetched: "ok" | "failed" | "none";
};

export type GateHit = { url: string; title?: string };
export type GateSearch = (query: string) => Promise<GateHit[]>;

/*
  Tool-talk. Every one of these describes the MODEL, never the city, so none
  of them belongs in a newspaper story. The first three alternatives are the
  exact words that reached the live draft.
*/
export const TOOL_TALK =
  /web ?(fetch|search)|websearch|webfetch|permission|this session|unavailable this|tool(s)? (were|was|are)|not granted|sandbox|blocked from (fetching|searching)|could not (fetch|search|browse)|no (internet|network) access/i;

/*
  A claim that something does not exist, was not published, or is unverified.
  Body, dek and headline only: reporting notes are allowed to say what is still
  open, and the honest rewrites this gate produces live there.

  "does not say / state / show / confirm" is deliberately NOT a bare trigger.
  The first build of this regex treated it as one and rewrote a good sentence
  from an existing pipeline test -- "What the announcing release does not say
  is which hydrants go offline" -- into a claim of absence. That sentence is
  the opposite of the failure this module exists to stop: it is a reporter
  saying what a document she HAS READ leaves out. So a content verb only
  counts when the subject is a document said not to be there at all
  ("no agenda item confirming any of that"), which is the sentence that
  actually shipped on 2026-09-05. Claims that a document does not exist, was
  not published or was not posted stay bare triggers.
*/
const MISSING_DOC =
  "\\bno (city|official|public|council|county|state)?\\s*\\w*\\s*(page|release|record|agenda|item|document|notice|filing|report|statement|minutes)\\b";

export const WORLD_ABSENCE = new RegExp(
  [
    `${MISSING_DOC}[^.]{0,80}\\b(was|were|has been|had been|could be)\\s+(obtained|found|located|retrieved|published|posted|issued)`,
    `${MISSING_DOC}[^.]{0,80}\\b(says?|stating|states?|shows?|showing|confirms?|confirming)\\b`,
    "\\b(does not|doesn't|did not|didn't) (exist|publish|post)\\b",
    "\\bunverified\\b",
    "\\bnot (yet )?(confirmed|verified|documented|in evidence)\\b",
    "\\bnothing (in|on) the (record|city's site|city website)\\b",
  ].join("|"),
  "i",
);

/** The document types a memo ask has to name before the app will chase it. */
const DOC_TYPE =
  /\b(pages?|releases?|agendas?|packets?|minutes|ordinances?|resolutions?|reports?|contracts?|budgets?|surveys?|notices?|calendars?|items?)\b/i;

/**
 * A noun phrase naming a document, pulled out of one sentence.
 *
 * Used twice: to say what the gate searched for, and to write the honest
 * replacement sentence. Returns null when the sentence names no document, and
 * callers fall back to "that document" rather than inventing one.
 */
export function namedDocument(sentence: string): string | null {
  const m = sentence.match(
    /((?:[A-Za-z0-9'’’-]+\s+){0,4}(?:page|release|record|agenda|packet|minutes|ordinance|resolution|report|contract|budget|survey|notice|calendar|item|document|filing|statement)s?)/i,
  );
  if (!m?.[1]) return null;
  const phrase = m[1]
    .replace(/\s+/g, " ")
    .replace(
      /^(?:no|any|the|a|an|that|this|those|these|and|or|its|their|our|was|were|is|are|been|be|not|yet|city's|citys)\s+/gi,
      "",
    )
    .trim();
  return phrase.length >= 4 ? phrase.slice(0, 120) : null;
}

/**
 * Split text into sentences without losing a character.
 *
 * `splitSentences(t).join("") === t` for every input, so a caller can drop one
 * sentence and rejoin the rest with the paragraph breaks intact.
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text.match(/[^.!?]*[.!?]+["'’)\]]*\s*|[^.!?]+$/g) ?? [text];
}

function tidy(text: string): string {
  return text
    .split(/\n/)
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove every sentence the predicate matches. Returns what was removed. */
export function stripSentences(
  text: string,
  matches: (sentence: string) => boolean,
): { text: string; removed: string[] } {
  const parts = splitSentences(text);
  const removed: string[] = [];
  const kept = parts.filter((p) => {
    if (p.trim() && matches(p)) {
      removed.push(p.trim());
      return false;
    }
    return true;
  });
  return { text: tidy(kept.join("")), removed };
}

/** Replace every sentence the predicate matches with the rewrite it returns. */
export function rewriteSentences(
  text: string,
  rewrite: (sentence: string) => string | null,
): { text: string; changed: { from: string; to: string }[] } {
  const parts = splitSentences(text);
  const changed: { from: string; to: string }[] = [];
  const out = parts.map((p) => {
    if (!p.trim()) return p;
    const next = rewrite(p);
    if (next == null) return p;
    changed.push({ from: p.trim(), to: next });
    const trailing = p.match(/\s*$/)?.[0] ?? "";
    return `${next}${trailing}`;
  });
  return { text: tidy(out.join("")), changed };
}

/**
 * The one honest form of a tool-talk line, for reporting notes.
 *
 * The paper's name is a parameter, not a constant: this is self-hosted
 * software and an Ashgrove Gazette note that says "TownReporter" is the same
 * class of bug as a prompt that tells every install it works in Longmont.
 */
export function notYetOpened(sentence: string, paperName = "TownReporter"): string {
  return `${paperName} has not yet opened ${namedDocument(sentence) ?? "that document"}.`;
}

/*
  ---------------------------------------------------------------------------
  Official domains
  ---------------------------------------------------------------------------
  The paper identity carries no "official domain" field, so the domains are
  derived: whatever the configured seed sources and the lead's own URLs say,
  filtered to hosts that end in .gov or carry the city's name. A comparison
  city (the live incident chased Rochester and Richmond) never matches, which
  is the entire point -- a site: query has to point at THIS city.
*/
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function citySlug(city: string): string {
  return city.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The paper's own official web domains.
 *
 * `trusted` is what the operator configured (seed sources marked "official"),
 * and is taken at its word. Everything else has to earn it by being a
 * government address: .gov or .us, and carrying the city's name unless it is
 * already one of the trusted set.
 *
 * The city-name test alone is not enough and was tried first. The local
 * newspaper here is longmontleader.com -- it carries the city's name, it is
 * emphatically not the city, and treating it as the official domain would let
 * the gate "confirm" a claim against the wrong publisher. A commercial host is
 * never the city's own site, whatever it is called.
 */
export function officialDomains(
  city: string,
  urls: (string | null | undefined)[],
  trusted: (string | null | undefined)[] = [],
): string[] {
  const slug = citySlug(city);
  const out: string[] = [];
  const add = (host: string | null) => {
    if (host && !out.includes(host)) out.push(host);
  };
  for (const raw of trusted) {
    if (!raw) continue;
    const value = String(raw).trim();
    if (!value) continue;
    add(value.includes("://") ? hostOf(value) : value.replace(/^www\./i, "").toLowerCase());
  }
  for (const raw of urls) {
    if (!raw) continue;
    const host = hostOf(String(raw));
    if (!host || !/\.(gov|us)$/.test(host)) continue;
    // A neighbouring city's .gov is a comparison, not this paper's record.
    if (slug.length >= 4 && !host.includes(slug) && !out.includes(host)) continue;
    add(host);
  }
  return out.sort((a, b) => Number(/\.gov$/.test(b)) - Number(/\.gov$/.test(a))).slice(0, 4);
}

export function isOnDomains(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * The paper's local-press-tier hosts (watch-list Tier B), for the absence
 * ladder's last rung.
 *
 * `dark.ts`'s `readDarkPlace` built this same list inline for the Dark Desk
 * investigation engine's `tierForUrl`/`tierForQuery`. Extracted here (0.6.23)
 * rather than imported from `dark.ts`, because `dark.ts` already imports
 * `officialDomains` from this file -- importing back would be a cycle, and
 * pulling in the Dark Desk engine's dependencies just for a domain list is
 * the "dark-only code" the absence-ladder work was told not to drag in.
 * `dark.ts` now calls this helper too, so there is one list, not two.
 */
export function pressDomains(sources: { url: string; tier?: string | null }[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if ((s.tier ?? "").toUpperCase() !== "B") continue;
    const host = hostOf(s.url);
    if (host && !out.includes(host)) out.push(host);
  }
  return out;
}

/*
  ---------------------------------------------------------------------------
  The memo's document asks
  ---------------------------------------------------------------------------
*/
const ASK_STOPWORDS = new Set([
  "chase",
  "get",
  "obtain",
  "pull",
  "find",
  "confirm",
  "check",
  "the",
  "a",
  "an",
  "and",
  "or",
  "any",
  "own",
  "its",
  "their",
  "our",
  "for",
  "of",
  "to",
  "that",
  "this",
  "these",
  "those",
  "with",
  "from",
  "on",
  "in",
  "at",
  "by",
  "is",
  "was",
  "were",
  "not",
  "yet",
  "still",
  "what",
  "which",
  "whether",
  "announcing",
]);

/**
 * The documents the research memo asked for, one errand per entry.
 *
 * The live incident's memo said, in `follow`, exactly what was needed: "Chase
 * the city's own survey landing page and any press release announcing the
 * launch". The app never searched for it -- its four follow-up slots went to
 * two comparison cities, a recycling ordinance and a probation page. These
 * asks now get their own pulls, ahead of everything else.
 */
export function documentAsks(parts: (string | null | undefined)[], cap = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const whole = String(raw ?? "").trim();
    if (!whole) continue;
    for (const piece of whole.split(/\s*;\s*|(?<=[.!?])\s+/)) {
      const ask = piece.replace(/\s+/g, " ").replace(/^[\s,;.—-]+|[\s,;]+$/g, "").trim();
      if (ask.length < 8 || !DOC_TYPE.test(ask)) continue;
      const key = ask.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ask.slice(0, 200));
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** The searchable words of an ask, with the reporter's verbs taken out. */
export function askTerms(ask: string): string {
  return ask
    .toLowerCase()
    .replace(/[^a-z0-9'’\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !ASK_STOPWORDS.has(w))
    .slice(0, 8)
    .join(" ")
    .trim();
}

/**
 * One site-restricted query per city domain, then one open query naming the
 * city. The open query is last on purpose: the city's own page is what the
 * memo asked for, and a general search is only the backstop.
 */
export function askQueries(ask: string, domains: string[], city: string): string[] {
  const terms = askTerms(ask) || ask.slice(0, 80);
  const queries = domains.slice(0, 2).map((d) => `site:${d} ${terms}`);
  queries.push(`${city} ${terms}`.trim());
  return queries;
}

/**
 * Search for one ask and return the top hit that is on the paper's own city
 * domain. Anything else is a comparison city or a national explainer, and one
 * of those in the evidence is what let the live draft argue from absence.
 */
export async function findOnCityDomain(
  ask: string,
  domains: string[],
  city: string,
  search: GateSearch,
  exclude: (url: string) => boolean = () => false,
): Promise<{ query: string; url: string | null }> {
  const queries = askQueries(ask, domains, city);
  let lastQuery = queries[0] ?? "";
  for (const query of queries) {
    lastQuery = query;
    let hits: GateHit[] = [];
    try {
      hits = await search(query);
    } catch {
      continue;
    }
    const hit = hits.find((h) => h?.url && isOnDomains(h.url, domains) && !exclude(h.url));
    if (hit) return { query, url: hit.url };
  }
  return { query: lastQuery, url: null };
}

/*
  ---------------------------------------------------------------------------
  The absence ladder (0.6.23)
  ---------------------------------------------------------------------------
  "Don't make extra work for the editor making them check something you can
  check first." A claim of absence used to trigger exactly one site:<domain>
  search; a miss handed the editor a checkbox the app could often have
  cleared itself. The ladder below runs every way the app can reasonably
  check before it gives up:

    (a) site:<domain> + key terms, once per official domain the paper has
    (b) the same key terms plus the city name, unrestricted (no site: filter)
    (c) one variation swapping the document word for a synonym
    (d) one local-press-tier query, if the paper has press-tier domains

  It stops at the first hit. Every query it actually ran, and whether that
  query hit, is returned in `steps` so the gate record (and the story page)
  can show the editor exactly what was checked -- not just a promise that
  something was.
*/

/** The document-type words the incident sentence and its neighbours use. */
export const DOC_SYNONYMS = [
  "agenda",
  "packet",
  "minutes",
  "notice",
  "report",
  "release",
  "ordinance",
  "resolution",
  "statement",
] as const;

/**
 * Swap the document word in `terms` for the next word in `DOC_SYNONYMS`
 * (wrapping around), or append the first synonym when `terms` names no
 * document word at all. Deterministic, so the same ask always tries the
 * same variation rather than a random one a test can't pin down.
 */
export function synonymVariation(terms: string): string {
  const lower = terms.toLowerCase();
  const foundIndex = DOC_SYNONYMS.findIndex((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
  if (foundIndex < 0) return `${terms} ${DOC_SYNONYMS[0]}`.trim();
  const swap = DOC_SYNONYMS[(foundIndex + 1) % DOC_SYNONYMS.length];
  const found = DOC_SYNONYMS[foundIndex];
  return terms.replace(new RegExp(`\\b${found}\\b`, "i"), swap);
}

/** One rung of the ladder: the query that ran, and whether it hit. */
export type LadderStep = { query: string; hit: boolean };

export type LadderResult = {
  url: string | null;
  /** The query that found the hit, or the last query tried when none did. */
  query: string;
  /** Every query the ladder actually ran, in order, with its outcome. */
  steps: LadderStep[];
};

/**
 * Run the absence ladder for one ask and stop at the first hit.
 *
 * Step (a) requires the hit to be on the paper's own official domain, the
 * same bar `findOnCityDomain` already held it to. Steps (b)-(d) widen the
 * search itself (no `site:` restriction, a synonym swap, a press-tier
 * domain) but still require the hit to land on a domain the paper actually
 * trusts -- official or local-press -- so a general web search can't
 * "confirm" a claim against an unrelated site. That is the same discipline
 * `officialDomains` already applies: a domain has to earn the paper's trust,
 * not just appear in a result.
 */
export async function findAbsenceEvidence(
  ask: string,
  domains: string[],
  city: string,
  press: string[],
  search: GateSearch,
  exclude: (url: string) => boolean = () => false,
): Promise<LadderResult> {
  const terms = askTerms(ask) || ask.slice(0, 80);
  const steps: LadderStep[] = [];

  const run = async (query: string, accept: (url: string) => boolean): Promise<string | null> => {
    let hits: GateHit[] = [];
    try {
      hits = await search(query);
    } catch {
      steps.push({ query, hit: false });
      return null;
    }
    const hit = hits.find((h) => h?.url && accept(h.url) && !exclude(h.url));
    steps.push({ query, hit: Boolean(hit) });
    return hit ? hit.url : null;
  };

  // (a) site:<domain> for EACH official domain, stopping at the first hit.
  for (const d of domains) {
    const url = await run(`site:${d} ${terms}`.trim(), (u) => isOnDomains(u, [d]));
    if (url) return { url, query: steps[steps.length - 1]!.query, steps };
  }

  const onTrustedDomain = (u: string) => isOnDomains(u, domains) || isOnDomains(u, press);

  // (b) the same terms plus the city name, no site: restriction.
  {
    const query = `${terms} ${city}`.trim();
    const url = await run(query, onTrustedDomain);
    if (url) return { url, query, steps };
  }

  // (c) one variation swapping the document word for a synonym.
  {
    const query = `${synonymVariation(terms)} ${city}`.trim();
    const url = await run(query, onTrustedDomain);
    if (url) return { url, query, steps };
  }

  // (d) one local-press-tier query, only if the paper has press domains.
  if (press.length) {
    const query = `${press
      .slice(0, 3)
      .map((d) => `site:${d}`)
      .join(" OR ")} ${terms}`.trim();
    const url = await run(query, (u) => isOnDomains(u, press));
    if (url) return { url, query, steps };
  }

  return { url: null, query: steps[steps.length - 1]?.query ?? "", steps };
}

/*
  ---------------------------------------------------------------------------
  The gate itself
  ---------------------------------------------------------------------------
*/
export type AbsenceGateInput = {
  headline: string;
  dek: string;
  body: string;
  integrity_notes: string;
  unanswered: string[];
  /** Titles of the documents the draft actually opened, for the honest rewrite. */
  openedTitles: string[];
  /** URLs already in evidence -- a "find" that is one of these is not news. */
  knownUrls: string[];
  domains: string[];
  /** The paper's local-press-tier hosts (watch-list Tier B); see `pressDomains()`. */
  pressDomains?: string[];
  city: string;
  /** The paper's own name, for the sentences the gate writes. */
  paperName?: string;
  search: GateSearch;
  /**
   * False on the second pass. One redraft per job: without this cap a search
   * that keeps returning fresh URLs would redraft forever.
   */
  redraftAllowed: boolean;
};

export type AbsenceGateResult = {
  headline: string;
  dek: string;
  body: string;
  integrity_notes: string;
  unanswered: string[];
  gate: GateEntry[];
  /** City-domain documents the gate found that were not in the evidence. */
  foundUrls: string[];
  /** True when a found document should be added to evidence and the story rewritten. */
  needsRedraft: boolean;
};

function joinTitles(titles: string[]): string {
  const kept = titles
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return kept.length ? kept.join("; ") : "nothing that named it";
}

export async function runAbsenceGate(input: AbsenceGateInput): Promise<AbsenceGateResult> {
  const gate: GateEntry[] = [];
  const foundUrls: string[] = [];
  const known = new Set(input.knownUrls.map((u) => u.trim()));
  const paperName = input.paperName?.trim() || "TownReporter";

  // 1. Tool-talk. It describes the model, so it is never a fact about the
  //    city -- out of the story, rewritten in the notes.
  let headline = input.headline;
  let dek = input.dek;
  let body = input.body;
  for (const field of ["headline", "dek", "body"] as const) {
    const value = field === "headline" ? headline : field === "dek" ? dek : body;
    const { text, removed } = stripSentences(value, (s) => TOOL_TALK.test(s));
    if (!removed.length) continue;
    // Never blank a field entirely: an empty headline is a worse failure than
    // the sentence. Flag it instead and let the editor see it.
    const emptied = !text.trim();
    for (const sentence of removed) {
      gate.push({
        kind: "tool-talk",
        sentence,
        action: emptied
          ? "left in place — removing it would have emptied the field; rewrite it before print"
          : "removed from the story: it describes the software, not the city",
      });
    }
    if (emptied) continue;
    if (field === "headline") headline = text;
    else if (field === "dek") dek = text;
    else body = text;
  }

  const notes = rewriteSentences(input.integrity_notes, (s) =>
    TOOL_TALK.test(s) ? notYetOpened(s, paperName) : null,
  );
  let integrity_notes = notes.text;
  for (const c of notes.changed) {
    gate.push({ kind: "tool-talk", sentence: c.from, action: `rewritten in notes: ${c.to}` });
  }

  const unanswered = input.unanswered.map((line) => {
    if (!TOOL_TALK.test(line)) return line;
    const to = notYetOpened(line, paperName);
    gate.push({ kind: "tool-talk", sentence: line, action: `rewritten in notes: ${to}` });
    return to;
  });

  // 2. Claims of absence. Search before the story may say a thing does not
  //    exist. This is the check the live incident had no version of.
  const absences = splitSentences(body)
    .concat(splitSentences(dek), splitSentences(headline))
    .map((s) => s.trim())
    .filter((s) => s && WORLD_ABSENCE.test(s));

  const press = input.pressDomains ?? [];
  const verdicts = new Map<string, LadderResult>();
  for (const sentence of absences) {
    if (verdicts.has(sentence)) continue;
    const ask = namedDocument(sentence) ?? sentence;
    const found = await findAbsenceEvidence(ask, input.domains, input.city, press, input.search, (u) =>
      known.has(u),
    );
    verdicts.set(sentence, found);
  }

  let needsRedraft = false;
  const honest = (sentence: string) =>
    `${paperName} did not find ${namedDocument(sentence) ?? "that document"} among the documents it opened: ${joinTitles(input.openedTitles)}.`;
  // "TownReporter searched <domain> and <n> more ways and found nothing" --
  // <n> is every rung of the ladder after the first, so the editor sees the
  // real count of things the app already tried, not just one search.
  const summaryFor = (found: LadderResult) => {
    const domain = input.domains[0] ?? "the city's own site";
    const more = Math.max(0, found.steps.length - 1);
    return (
      `${paperName} searched ${domain} and ${more} more way${more === 1 ? "" : "s"} and found ` +
      `nothing. Confirm you checked yourself before this prints.`
    );
  };
  const verifyLines: string[] = [];

  for (const [sentence, found] of verdicts) {
    if (found.url && input.redraftAllowed) {
      needsRedraft = true;
      if (!foundUrls.includes(found.url)) foundUrls.push(found.url);
      gate.push({
        kind: "absence",
        sentence,
        action: `absence check found ${found.url}, redrafting`,
        url: found.url,
        query: found.query,
        steps: found.steps,
      });
      continue;
    }
    const to = honest(sentence);
    gate.push({
      kind: "absence",
      sentence,
      action: `rewritten to what TownReporter actually did: ${to}`,
      url: found.url ?? undefined,
      query: found.query,
      steps: found.steps,
      summary: summaryFor(found),
      needsCheck: true,
    });
    const what = namedDocument(sentence) ?? "that document";
    verifyLines.push(
      `VERIFY BEFORE PRINT — the story says ${what} was not found. TownReporter searched ` +
        `${input.domains[0] ?? "the city's own site"} and ${Math.max(0, found.steps.length - 1)} ` +
        `more way${found.steps.length === 2 ? "" : "s"}; open it yourself and confirm before publishing.`,
    );
  }

  if (!needsRedraft && verdicts.size) {
    const rewriteOne = (s: string) => (verdicts.has(s.trim()) ? honest(s.trim()) : null);
    body = rewriteSentences(body, rewriteOne).text;
    dek = rewriteSentences(dek, rewriteOne).text;
    headline = rewriteSentences(headline, rewriteOne).text || input.headline;
  }

  if (verifyLines.length) {
    integrity_notes = [integrity_notes, ...verifyLines].filter(Boolean).join("\n");
  }

  return {
    headline,
    dek,
    body,
    integrity_notes,
    unanswered,
    gate,
    foundUrls,
    needsRedraft: needsRedraft && foundUrls.length > 0,
  };
}

/** The gate entries an editor has to sign off before the story may print. */
export function absenceClaims(gate: GateEntry[] | undefined): GateEntry[] {
  return (gate ?? []).filter((g) => g.kind === "absence" && g.needsCheck === true);
}
