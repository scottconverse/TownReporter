/**
 * The mechanical style audit for NEWS drafts (unit AQ, 0.6.71).
 *
 * WHY THIS EXISTS. Everything else the desk checks about a draft is about
 * whether it is TRUE: citations, name spellings, evidence reconciliation,
 * claims of absence. None of those catch a paragraph that says a school board
 * vote "marks a turning point for the community" and reports nothing else.
 * That failure is the one an editor rewrites by hand, and it is the one thing
 * a machine finds reliably, because it is a shape rather than a fact.
 *
 * The shape of the answer is the point. This code measures the draft and names
 * every finding by the paragraph and the sentence it came from; a model then
 * repairs only what the code listed; the code measures again and may refuse
 * the repair (see `draft-audit-repair.ts`). The model never decides what
 * counts as a fault, so the standard holds still from draft to draft and an
 * editor can read the rule behind every line.
 *
 * WHAT THIS IS NOT. It is not a judgement of whether a story is good, and it
 * blocks nothing: every finding is advisory, nothing here publishes, and an
 * editor may ignore all of it. It is also not `report.ts`'s `stripAiFiller`,
 * which DELETES paragraphs that are pure filler while the draft is being
 * written. That one is a floor; this one reports, so the desk can see what it
 * thought was wrong and say otherwise.
 *
 * PURE. No I/O, no clock, no database, no model. Every threshold is a named
 * constant below. Nothing here rewrites text: it only reads it.
 */

/**
 * Starting values. These are calibrated against the local-news sentences in
 * `draft-audit.test.ts`, not against a corpus of published stories, so treat
 * them as a first guess rather than a standard. They are named constants so
 * that moving one is a one-line diff with one test to update, rather than a
 * number buried inside a regular expression.
 */
export const DRAFT_AUDIT_LIMITS = {
  /** Below this many sentences, sentence-length statistics say nothing. */
  minSentencesForRhythm: 6,
  /**
   * Coefficient of variation of sentence word counts. A draft flatter than
   * this reads machine-made: real copy puts a three-word sentence next to a
   * thirty-word one.
   */
  minSentenceLengthCv: 0.34,
  /** A sentence this many times the mean counts as "long" for the zigzag test. */
  zigzagLongRatio: 1.4,
  /** One this many times the mean counts as "short" for the zigzag test. */
  zigzagShortRatio: 0.72,
  /** Adjacent pairs must be classifiable before the zigzag share means anything. */
  minZigzagPairs: 4,
  /** Share of neighbouring pairs that strictly alternate long/short. */
  maxZigzagShare: 0.5,
  /** Word cap per paragraph, by story form. */
  paragraphWordCap: {
    brief: 95,
    reported: 135,
    explainer: 155,
    investigation: 155,
  } as Record<string, number>,
  /** Used when the draft records no form, or one this build does not know. */
  defaultParagraphWordCap: 135,
  /** Characters of the offending sentence kept for the editor to read. */
  snippetChars: 240,
  /**
   * Overlapping windows of one repeat collapse into one finding, and the list
   * stops here so a draft can never produce a wall of near-identical lines.
   */
  maxRepeatFindings: 3,
} as const;

export type DraftAuditSeverity = "fix" | "review";

/**
 * `paragraph` numbers the body's paragraphs from 1. Paragraph 0 is the
 * headline and the dek, which print together above the body: a finding there
 * names itself by its `snippet`, because the two are not separately indexed.
 */
export type DraftAuditFinding = {
  severity: DraftAuditSeverity;
  code: string;
  paragraph: number;
  sentence: number;
  message: string;
  snippet: string;
};

export type DraftAuditMeasurements = {
  paragraphCount: number;
  sentenceCount: number;
  wordCount: number;
  meanSentenceWords: number;
  /** Standard deviation over the mean. 0 when there are no sentences. */
  sentenceLengthCv: number;
  shortestSentenceWords: number;
  longestSentenceWords: number;
  maxParagraphWords: number;
  paragraphCap: number;
  /** Share of neighbouring sentence pairs that alternate long/short exactly. */
  zigzagShare: number;
  /** Six-word runs that appear more than once. */
  sixWordRepeats: number;
};

export type DraftAuditResult = {
  version: 1;
  findings: DraftAuditFinding[];
  measurements: DraftAuditMeasurements;
  fixCount: number;
  reviewCount: number;
};

/*
  ── Wording the audit looks for ─────────────────────────────────────────────
  Every list holds lowercase phrases matched against the unmasked sentence.
  They are deliberately short: a phrase that fires on good copy costs an
  editor's trust in the whole list, and severity "fix" puts a finding in front
  of a model.
*/

/** Attribution that names nobody: the reader cannot check it. */
const UNNAMED_ATTRIBUTION = [
  "experts say",
  "experts believe",
  "experts agree",
  "critics argue",
  "critics say",
  "observers note",
  "observers say",
  "studies show",
  "research shows",
  "some believe",
  "some say",
  "sources say",
  "sources close to",
  "many residents feel",
  "it is widely believed",
  "analysts say",
  "officials say",
  "according to reports",
] as const;

/** The verbs a story uses to hand a claim to somebody. */
const ATTRIBUTION_VERB =
  "said|says|say|told|wrote|explained|confirmed|testified|added|noted|announced|reported|stated";

/**
 * A named attribution in the same sentence means the sentence is not the
 * unnamed kind, even when it also carries a phrase from the list above ("The
 * city manager said experts were wrong"). Offices count as names: "the mayor
 * said" tells the reader who to check, which is the whole objection.
 *
 * The office has to be the one doing the attributing -- "the mayor said", not
 * "the mayor" anywhere in the sentence. Without that, "Sources say the
 * manager will resign" reads as attributed because of a noun that belongs to
 * the claim, not to the attribution.
 */
const NAMED_ATTRIBUTION_PATTERN = new RegExp(
  `\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3}\\s+(?:${ATTRIBUTION_VERB})\\b|\\baccording to [A-Z]`,
);
const NAMED_ATTRIBUTION_OFFICES = new RegExp(
  `\\bthe (?:mayor|city manager|manager|chief|fire chief|police chief|superintendent|sheriff|administrator|director|spokesperson|spokesman|spokeswoman|attorney|clerk|treasurer|councilmember|commissioner|county assessor|engineer|planner)\\s+(?:${ATTRIBUTION_VERB})\\b`,
  "i",
);

/**
 * Sentences whose whole job is to say the subject matters. Each one is a claim
 * about significance that no source can support, and each one is followed by
 * nothing a reader can check.
 */
const IMPORTANCE_ONLY = [
  "marks a turning point",
  "marking a turning point",
  "marks a pivotal moment",
  "reflects a broader shift",
  "reflecting a broader shift",
  "speaks to a larger",
  "is a testament to",
  "stands as a testament",
  "highlights the importance of",
  "underscores the importance of",
  "demonstrates the power of",
  "is a reminder that",
  "serves as a reminder",
  "leaves residents wondering",
  "only time will tell",
  "at a crossroads",
  "the stakes could not be higher",
  "captures the mood of",
  "is more than just",
  "will shape the community for years",
] as const;

/**
 * A participle tail hung off a fact to inflate it. `, highlighting …` and its
 * family assert that the fact matters without adding a second fact, which is
 * exactly what a reader cannot verify.
 *
 * "marking a turning point" is deliberately absent here: IMPORTANCE_ONLY
 * catches it, and one sentence should produce one finding about its tail, not
 * two.
 */
const PARTICIPLE_TAIL =
  /,\s+(?:highlighting|underscoring|underlining|marking|signaling|signalling|reflecting|showcasing|cementing|solidifying|demonstrating|illustrating|emphasizing|emphasising|reinforcing|furthering|paving the way for|a move that|a decision that|a sign that)\b/i;

/** Verbs that dress up "is". The plain verb was already true and shorter. */
const DRESSED_UP_VERBS: Array<{ phrase: string; suggestion: string }> = [
  { phrase: "serves as", suggestion: "is" },
  { phrase: "serving as", suggestion: "is" },
  { phrase: "stands as", suggestion: "is" },
  { phrase: "standing as", suggestion: "is" },
  { phrase: "functions as", suggestion: "is" },
  { phrase: "functioning as", suggestion: "is" },
  { phrase: "acts as", suggestion: "is" },
  { phrase: "operates as", suggestion: "is" },
];

/**
 * Filler and throat-clearing. A term used once is a review note ("does this
 * earn its place?"); used twice or more it is a fix, because the second one is
 * never doing work.
 *
 * "landscape" is the one entry that is not always filler -- see
 * `figurativeLandscapeIndexes`.
 */
const FILLER_TERMS = [
  "moreover",
  "furthermore",
  "additionally",
  "notably",
  "it is worth noting",
  "it should be noted",
  "in conclusion",
  "needless to say",
  "at the end of the day",
  "in today's",
  "tapestry",
  "vibrant",
  "nestled",
  "bustling",
  "boasts",
  "rich history",
  "no stranger to",
  "delve into",
  "a myriad of",
  "a plethora of",
  "landscape",
] as const;

/**
 * "landscape" is literal in "the landscaping crew" and figurative in "the
 * political landscape". Only the second is filler, and the tell is an abstract
 * modifier in front of it.
 */
const ABSTRACT_MODIFIERS: readonly string[] = [
  "political",
  "cultural",
  "media",
  "business",
  "economic",
  "competitive",
  "regulatory",
  "funding",
  "news",
  "civic",
  "artistic",
  "musical",
  "literary",
  "environmental",
  "national",
  "regional",
  "statewide",
  "local",
];

/**
 * One entity, several names. Each cluster is a set of genuinely different
 * names for the same actor; a paragraph that uses two of them is cycling
 * synonyms, which pads the copy and hides that it is the same actor.
 *
 * Names that contain one another ("the council" / "city council" /
 * "councilmembers") are reduced to ONE family before comparison, so ordinary
 * prose that says "the City Council voted" and then "the council will meet" is
 * not flagged. A small starting set, not an attempt at an ontology.
 */
const ENTITY_NAME_CLUSTERS: Array<{ label: string; names: string[] }> = [
  {
    label: "the city government",
    names: ["city hall", "city officials", "municipal officials", "city staff", "the city's staff"],
  },
  {
    label: "the school district",
    names: [
      "st. vrain valley schools",
      "the school district",
      "district officials",
      "district staff",
      "the school board",
      "school board members",
    ],
  },
  {
    label: "the police",
    names: ["the police department", "law enforcement", "police officials", "the police force"],
  },
];

/**
 * Characters that arrive by paste and never belong in a sentence. Written as
 * escapes on purpose: most of them are invisible, so a literal one in this
 * file would be a character nobody could see, and a stray literal space here
 * would flag every sentence in every draft.
 */
const PASTE_ARTIFACTS: Array<{ char: string; label: string }> = [
  { char: "\u00A0", label: "non-breaking space" },
  { char: "\u1680", label: "Ogham space mark" },
  { char: "\u2007", label: "figure space" },
  { char: "\u202F", label: "narrow non-breaking space" },
  { char: "\u200B", label: "zero-width space" },
  { char: "\u200C", label: "zero-width non-joiner" },
  { char: "\u200D", label: "zero-width joiner" },
  { char: "\u2060", label: "word joiner" },
  { char: "\uFEFF", label: "byte-order mark" },
];

const TRACKING_PARAMETERS: readonly string[] = [
  "fbclid",
  "gclid",
  "msclkid",
  "dclid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref_src",
  "ref_url",
  "s_kwcid",
];

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()"']+/gi;

/** Cyrillic and Greek letters, which look like Latin ones in most fonts. */
const CONFUSABLE_SCRIPTS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /[\u0370-\u03FF]/, label: "Greek" },
  { pattern: /[\u0400-\u04FF]/, label: "Cyrillic" },
];
const CONFUSABLE_IN_LATIN_WORD = /[A-Za-z][\u0370-\u03FF\u0400-\u04FF]|[\u0370-\u03FF\u0400-\u04FF][A-Za-z]/;

/**
 * The invisible characters the paste check looks for, as one string. Text
 * handling asks about it directly: `String.trim` counts U+00A0 as whitespace
 * and would quietly delete the very character the editor has to retype.
 */
const ARTIFACT_CHARS = PASTE_ARTIFACTS.map(({ char }) => char).join("");
const trimEdges = (text: string): string =>
  text.replace(/^[ \t\r\n\f\v]+/, "").replace(/[ \t\r\n\f\v]+$/, "");

/*
  ── Text handling ───────────────────────────────────────────────────────────
*/

/**
 * Blank the inside of every quoted span, keeping the string's LENGTH so the
 * remaining offsets still line up with the original.
 *
 * A quote is the source's words. The desk never rewrites those, so the audit
 * never reads them: "experts say" inside quotation marks is a thing somebody
 * said, not an unnamed attribution. A sentence break inside a quote stops
 * being a break, which is the honest reading -- the quote is one utterance.
 */
export function maskQuotedText(text: string): string {
  const chars = [...text];
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (chars[i] !== "\n") chars[i] = " ";
  };
  let open = -1;
  let closer: string | null = null;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (open < 0) {
      if (char === "“" || char === "‘") {
        open = i;
        closer = char === "“" ? "”" : "’";
      } else if (char === '"') {
        open = i;
        closer = '"';
      }
      continue;
    }
    // A closing mark with nothing open is an apostrophe, not a quote.
    if (char === closer) {
      blank(open, i + 1);
      open = -1;
      closer = null;
    }
  }
  // An unclosed quote is a typo, not a licence to skip the rest of the draft.
  return chars.join("");
}

/**
 * Sentence boundaries found in the MASKED paragraph, as offsets into the
 * original string. Checks read the masked slice (quotes blanked); the editor
 * reads the original slice, so a finding never shows blanks where a quote was.
 */
function sentenceBounds(masked: string): Array<[number, number]> {
  const bounds: Array<[number, number]> = [];
  const breaks = /[.!?]\s+/g;
  let from = 0;
  let match: RegExpExecArray | null;
  while ((match = breaks.exec(masked))) {
    /*
      `\s+` eats invisible characters too, and a separator is exactly where a
      paste artifact likes to sit: the non-breaking space after the full stop in a
      non-breaking space after the full stop would belong to no sentence at
      all, so the paste check would never see the character the editor has to
      retype. Keep artifacts on the sentence they follow; ordinary spaces
      still separate.
    */
    let end = match.index + 1;
    while (end < breaks.lastIndex && ARTIFACT_CHARS.includes(masked[end]!)) end += 1;
    bounds.push([from, end]);
    from = breaks.lastIndex;
  }
  bounds.push([from, masked.length]);
  return bounds.filter(([start, end]) => trimEdges(masked.slice(start, end)).length > 0);
}

const splitParagraphs = (body: string): string[] =>
  body
    .split(/\n{2,}/)
    // `trimEdges`, not `trim`: an artifact at the edge of a paragraph is still
    // in the draft the reader gets, and `trim` would delete it before the
    // paste check could see it.
    .map((paragraph) => trimEdges(paragraph))
    .filter(Boolean);

const countWords = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const snippetOf = (sentence: string): string =>
  sentence.length > DRAFT_AUDIT_LIMITS.snippetChars
    ? `${trimEdges(sentence.slice(0, DRAFT_AUDIT_LIMITS.snippetChars))}…`
    : sentence;

const allIndexesOf = (haystack: string, needle: string): number[] => {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return found;
    found.push(at);
    from = at + needle.length;
  }
};

/*
  ── The checks ──────────────────────────────────────────────────────────────
  Each returns findings already positioned by paragraph and sentence. `masked`
  is the lowercase sentence the checks read; `shown` is the sentence the editor
  will see, quotes intact.
*/

type Spot = { paragraph: number; sentence: number };

function unnamedAttributionFindings(masked: string, shown: string, at: Spot): DraftAuditFinding[] {
  const phrase = UNNAMED_ATTRIBUTION.find((candidate) => masked.includes(candidate));
  if (!phrase) return [];
  /*
    Ask whether anybody is named, with the unnamed phrase taken out first: it
    is never evidence that somebody was named. A sentence beginning "Sources
    say ..." otherwise looks exactly like "Sikes said ..." to the pattern
    below -- a capital letter followed by an attribution verb -- and the
    brief's own example would sail through.
  */
  const rest = masked.split(phrase).join(" ");
  if (NAMED_ATTRIBUTION_PATTERN.test(rest) || NAMED_ATTRIBUTION_OFFICES.test(rest)) return [];
  return [
    {
      severity: "fix",
      code: "unnamed-attribution",
      ...at,
      message: `"${phrase}" asks the reader to trust somebody who is not named. Name the person, the office or the document, or cut the sentence.`,
      snippet: snippetOf(shown),
    },
  ];
}

function importanceOnlyFindings(masked: string, shown: string, at: Spot): DraftAuditFinding[] {
  const phrase = IMPORTANCE_ONLY.find((candidate) => masked.includes(candidate));
  if (!phrase) return [];
  return [
    {
      severity: "fix",
      code: "importance-only",
      ...at,
      message: `"${phrase}" says the subject matters without reporting anything. Replace it with what happened, who decided, or what changes on Monday.`,
      snippet: snippetOf(shown),
    },
  ];
}

function participleTailFindings(masked: string, shown: string, at: Spot): DraftAuditFinding[] {
  const match = PARTICIPLE_TAIL.exec(masked);
  if (!match) return [];
  return [
    {
      severity: "fix",
      code: "participle-tail",
      ...at,
      message: `The trailing "${match[0].trim()}" clause asserts importance instead of reporting a second fact. Cut the tail, or replace it with what the sources say happened.`,
      snippet: snippetOf(shown),
    },
  ];
}

function dressedUpVerbFindings(masked: string, shown: string, at: Spot): DraftAuditFinding[] {
  const hit = DRESSED_UP_VERBS.find(({ phrase }) => masked.includes(phrase));
  if (!hit) return [];
  return [
    {
      severity: "fix",
      code: "dressed-up-verb",
      ...at,
      message: `"${hit.phrase}" dresses up a plain verb. Write "${hit.suggestion}" instead: the sentence gets shorter and loses nothing.`,
      snippet: snippetOf(shown),
    },
  ];
}

function fillerFindings(masked: string, shown: string, at: Spot, seen: Map<string, number>): DraftAuditFinding[] {
  const hits: DraftAuditFinding[] = [];
  for (const term of FILLER_TERMS) {
    const occurrences = term === "landscape" ? figurativeLandscapeIndexes(masked) : allIndexesOf(masked, term);
    if (!occurrences.length) continue;
    const total = (seen.get(term) ?? 0) + occurrences.length;
    seen.set(term, total);
    /*
      The first use is a review note. By the second it is no longer a choice of
      wording, it is a tic, and the draft is longer for it.
    */
    hits.push({
      severity: total > 1 ? "fix" : "review",
      code: "filler",
      ...at,
      message:
        total > 1
          ? `"${term}" is filler and this draft uses it ${total} times. Cut it, or say the thing it stands in for.`
          : `"${term}" is filler. Check that it earns its place, or cut it.`,
      snippet: snippetOf(shown),
    });
  }
  return hits;
}

/** Where "landscape" is figurative, so filler, rather than literal ground. */
function figurativeLandscapeIndexes(masked: string): number[] {
  const found: number[] = [];
  const pattern = /\blandscape\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked))) {
    const before = masked.slice(0, match.index).trimEnd().split(/\s+/).slice(-2);
    if (before.some((word) => ABSTRACT_MODIFIERS.includes(word.replace(/[^a-z]/gi, "").toLowerCase()))) {
      found.push(match.index);
    }
  }
  return found;
}

function synonymCyclingFindings(masked: string, at: Spot, shown: string): DraftAuditFinding[] {
  const hits: DraftAuditFinding[] = [];
  for (const cluster of ENTITY_NAME_CLUSTERS) {
    const families = new Map<string, string>();
    for (const name of cluster.names) {
      if (!masked.includes(name)) continue;
      const family = familyOf(name, cluster.names);
      if (!families.has(family)) families.set(family, name);
    }
    if (families.size < 2) continue;
    const [first, second] = [...families.values()];
    hits.push({
      severity: "review",
      code: "synonym-cycling",
      ...at,
      // The message quotes the draft's own spelling: the check reads lowercase
      // copy, and an editor staring at "City Hall" should not be told about
      // "city hall".
      message: `This paragraph calls the same thing both "${asWritten(shown, first)}" and "${asWritten(shown, second)}". Pick the name the reader will recognise and use it throughout.`,
      snippet: snippetOf(shown),
    });
  }
  return hits;
}

/** The name as the draft wrote it, so a message never quotes "city hall". */
function asWritten(shown: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").exec(shown)?.[0] ?? name;
}

/**
 * Reduce a name to the family it belongs to: the shortest name in the cluster
 * that contains it or is contained by it. "the council" and "councilmembers"
 * are one family because "council" is inside both.
 */
function familyOf(name: string, names: string[]): string {
  const core = name.replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
  for (const other of names) {
    const otherCore = other.replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
    if (otherCore !== core && (core.includes(otherCore) || otherCore.includes(core))) return otherCore;
  }
  return core;
}

function pasteArtifactFindings(shown: string, at: Spot): DraftAuditFinding[] {
  const hits: DraftAuditFinding[] = [];
  for (const { char, label } of PASTE_ARTIFACTS) {
    if (!shown.includes(char)) continue;
    const codePoint = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    hits.push({
      severity: "fix",
      code: "paste-artifact",
      ...at,
      message: `The draft carries a ${label} (U+${codePoint}). Retype the character.`,
      snippet: snippetOf(shown),
    });
    // One finding per sentence: the fix is the same for every stray character.
    break;
  }
  const confusable = CONFUSABLE_IN_LATIN_WORD.exec(shown);
  if (confusable) {
    // Name the script from the character that is actually there. (Testing the
    // copy with the confusables removed, as this once did, always answered
    // "Cyrillic" -- the Greek letter had been taken out before the question
    // was asked.)
    const script = CONFUSABLE_SCRIPTS.find(({ pattern }) => pattern.test(confusable[0]))?.label;
    hits.push({
      severity: "fix",
      code: "paste-artifact",
      ...at,
      message: `A ${script ?? "non-Latin"} letter is hiding inside a Latin word. Retype the word: the letter looks right and is not.`,
      snippet: snippetOf(shown),
    });
  }
  return hits;
}

function trackingParameterFindings(shown: string, at: Spot): DraftAuditFinding[] {
  const hits: DraftAuditFinding[] = [];
  for (const url of [...new Set(shown.match(URL_PATTERN) ?? [])]) {
    const complaints: string[] = [];
    const [beforeQuery, query = ""] = url.split("?");
    if (/&amp;/i.test(query) || /[?&]amp(?:;)?=/i.test(url) || /\/amp\/?(?:[?#]|$)/i.test(beforeQuery)) {
      complaints.push("an AMP form");
    }
    try {
      const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      if (/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname) && /^\/url\/?$/i.test(parsed.pathname)) {
        complaints.push("a search-engine redirect");
      }
      for (const [key] of parsed.searchParams) {
        const lower = key.toLowerCase();
        if (lower.startsWith("utm_") || TRACKING_PARAMETERS.includes(lower)) {
          complaints.push(`the tracking parameter "${key}"`);
        }
      }
    } catch {
      // A URL this cannot parse is still a URL; the patterns above already read
      // it as text, so say nothing rather than guess at it.
    }
    if (!complaints.length) continue;
    hits.push({
      severity: "fix",
      code: "tracking-parameter",
      ...at,
      message: `The link carries ${complaints.join(", ")}. Link the canonical page without tracking, so the desk's copy of the URL still resolves to the same record next year.`,
      snippet: snippetOf(shown),
    });
  }
  return hits;
}

/*
  ── Measurements ────────────────────────────────────────────────────────────
  The numbers the repair has to improve and may not damage. They ship with the
  findings so an editor can see why the desk called a draft flat, instead of
  taking its word for it.
*/

function paragraphCap(form: string): number {
  return DRAFT_AUDIT_LIMITS.paragraphWordCap[form] ?? DRAFT_AUDIT_LIMITS.defaultParagraphWordCap;
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

function rhythmMeasurements(sentences: string[]): {
  mean: number;
  cv: number;
  shortest: number;
  longest: number;
  zigzagShare: number;
} {
  const lengths = sentences.map(countWords);
  if (!lengths.length) return { mean: 0, cv: 0, shortest: 0, longest: 0, zigzagShare: 0 };
  const mean = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
  const variance = lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const long = mean * DRAFT_AUDIT_LIMITS.zigzagLongRatio;
  const short = mean * DRAFT_AUDIT_LIMITS.zigzagShortRatio;
  let classified = 0;
  let alternating = 0;
  for (let i = 0; i + 1 < lengths.length; i += 1) {
    const a = lengths[i] >= long ? "long" : lengths[i] <= short ? "short" : null;
    const b = lengths[i + 1] >= long ? "long" : lengths[i + 1] <= short ? "short" : null;
    if (!a || !b) continue;
    classified += 1;
    if (a !== b) alternating += 1;
  }
  return {
    mean: round(mean),
    cv: round(cv),
    shortest: Math.min(...lengths),
    longest: Math.max(...lengths),
    zigzagShare: classified >= DRAFT_AUDIT_LIMITS.minZigzagPairs ? round(alternating / classified) : 0,
  };
}

/**
 * Every six-word run that appears more than once, at the first place it
 * appears. Overlapping windows of one long repeat collapse into a single
 * finding, and the list is capped, so a repeated sentence cannot bury the
 * editor in near-identical lines.
 */
export function repeatedSixWordRuns(paragraphs: string[]): Array<{ run: string; paragraph: number; count: number }> {
  const occurrences = new Map<string, Array<{ paragraph: number; start: number }>>();
  paragraphs.forEach((paragraph, index) => {
    const words = paragraph
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (let start = 0; start + 6 <= words.length; start += 1) {
      const run = words.slice(start, start + 6).join(" ");
      const list = occurrences.get(run);
      if (list) list.push({ paragraph: index + 1, start });
      else occurrences.set(run, [{ paragraph: index + 1, start }]);
    }
  });

  const candidates = [...occurrences.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([run, list]) => ({ run, count: list.length, paragraph: list[0].paragraph, start: list[0].start }))
    .sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);

  const kept: typeof candidates = [];
  for (const candidate of candidates) {
    const overlaps = kept.some(
      (other) => other.paragraph === candidate.paragraph && Math.abs(other.start - candidate.start) < 6,
    );
    if (overlaps) continue;
    kept.push(candidate);
    if (kept.length >= DRAFT_AUDIT_LIMITS.maxRepeatFindings) break;
  }
  return kept.map(({ run, paragraph, count }) => ({ run, paragraph, count }));
}

/*
  ── The audit ───────────────────────────────────────────────────────────────
*/

/** The phrase-level checks, in the order a reader would meet them. */
function phraseFindingsFor(
  maskedSentence: string,
  shownSentence: string,
  at: Spot,
  seenFiller: Map<string, number>,
): DraftAuditFinding[] {
  const importance = importanceOnlyFindings(maskedSentence, shownSentence, at);
  return [
    ...unnamedAttributionFindings(maskedSentence, shownSentence, at),
    ...importance,
    // One sentence, one finding about its tail: if the tail is already the
    // reason the sentence was flagged, do not flag the same words twice.
    ...(importance.length ? [] : participleTailFindings(maskedSentence, shownSentence, at)),
    ...dressedUpVerbFindings(maskedSentence, shownSentence, at),
    ...fillerFindings(maskedSentence, shownSentence, at, seenFiller),
    ...pasteArtifactFindings(shownSentence, at),
    ...trackingParameterFindings(shownSentence, at),
  ];
}

export function auditDraft(input: { headline: string; dek: string; body: string; form: string }): DraftAuditResult {
  const findings: DraftAuditFinding[] = [];
  const seenFiller = new Map<string, number>();

  /*
    Paragraph 0 is the headline and the dek: they print together above the
    body, so a finding there hands the editor a snippet rather than a position.
  */
  const above = [input.headline, input.dek].map((line) => trimEdges(line)).filter(Boolean);
  let aboveSentence = 0;
  for (const line of above) {
    const masked = maskQuotedText(line);
    for (const [start, end] of sentenceBounds(masked)) {
      aboveSentence += 1;
      findings.push(
        ...phraseFindingsFor(
          trimEdges(masked.slice(start, end)).toLowerCase(),
          trimEdges(line.slice(start, end)),
          { paragraph: 0, sentence: aboveSentence },
          seenFiller,
        ),
      );
    }
  }

  const paragraphs = splitParagraphs(input.body);
  const bodySentences: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    const masked = maskQuotedText(paragraph);
    let sentence = 0;
    for (const [start, end] of sentenceBounds(masked)) {
      sentence += 1;
      const maskedSentence = trimEdges(masked.slice(start, end)).toLowerCase();
      bodySentences.push(maskedSentence);
      findings.push(
        ...phraseFindingsFor(
          maskedSentence,
          trimEdges(paragraph.slice(start, end)),
          { paragraph: index + 1, sentence },
          seenFiller,
        ),
      );
    }
    findings.push(...synonymCyclingFindings(masked.toLowerCase(), { paragraph: index + 1, sentence: 0 }, snippetOf(paragraph)));
  });

  const cap = paragraphCap(input.form);
  paragraphs.forEach((paragraph, index) => {
    const words = countWords(paragraph);
    if (words <= cap) return;
    findings.push({
      severity: "review",
      code: "paragraph-length",
      paragraph: index + 1,
      sentence: 0,
      message: `This paragraph runs ${words} words; the ${input.form || "default"} form reads best under ${cap}. Split it where the subject changes.`,
      snippet: snippetOf(paragraph),
    });
  });

  const rhythm = rhythmMeasurements(bodySentences);
  if (bodySentences.length >= DRAFT_AUDIT_LIMITS.minSentencesForRhythm) {
    if (rhythm.cv < DRAFT_AUDIT_LIMITS.minSentenceLengthCv) {
      findings.push({
        severity: "review",
        code: "flat-rhythm",
        paragraph: 0,
        sentence: 0,
        message: `Every sentence runs about ${rhythm.mean} words (variation ${rhythm.cv}; the desk looks for ${DRAFT_AUDIT_LIMITS.minSentenceLengthCv}). Vary the rhythm: let one sentence be three words and another thirty.`,
        snippet: "",
      });
    }
    if (rhythm.zigzagShare > DRAFT_AUDIT_LIMITS.maxZigzagShare) {
      findings.push({
        severity: "review",
        code: "zigzag-rhythm",
        paragraph: 0,
        sentence: 0,
        message: `${Math.round(rhythm.zigzagShare * 100)}% of neighbouring sentences alternate long and short exactly. That is a pattern a reader hears; break it in two places.`,
        snippet: "",
      });
    }
  }

  const repeats = repeatedSixWordRuns(paragraphs);
  for (const repeat of repeats) {
    findings.push({
      severity: "review",
      code: "six-word-repeat",
      paragraph: repeat.paragraph,
      sentence: 0,
      message: `"${repeat.run}" appears ${repeat.count} times in this draft. Say it once.`,
      snippet: "",
    });
  }

  findings.sort((a, b) => a.paragraph - b.paragraph || a.sentence - b.sentence || a.code.localeCompare(b.code));

  const fixCount = findings.filter((finding) => finding.severity === "fix").length;
  return {
    version: 1,
    findings,
    measurements: {
      paragraphCount: paragraphs.length,
      sentenceCount: bodySentences.length,
      wordCount: countWords(input.body),
      meanSentenceWords: rhythm.mean,
      sentenceLengthCv: rhythm.cv,
      shortestSentenceWords: rhythm.shortest,
      longestSentenceWords: rhythm.longest,
      maxParagraphWords: paragraphs.reduce((max, paragraph) => Math.max(max, countWords(paragraph)), 0),
      paragraphCap: cap,
      zigzagShare: rhythm.zigzagShare,
      sixWordRepeats: repeats.length,
    },
    fixCount,
    reviewCount: findings.length - fixCount,
  };
}

/**
 * The line the story page prints above the list. Kept here, beside the
 * findings, so the wording and the count cannot drift apart.
 */
export function styleCheckLabel(fixCount: number): string {
  if (fixCount === 0) return "No style findings";
  return fixCount === 1 ? "1 thing to fix" : `${fixCount} things to fix`;
}
