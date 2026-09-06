/**
 * The Dark Desk doctrine, restored.
 *
 * The operator's original two prompts split this desk in half, and the split
 * is the whole point:
 *
 *   Black Desk (prompt 03) — "Pre-verification. Fail-open. Speculation by
 *   design." Every signal it files is capped: "Confidence range for all
 *   signals: 0.1-0.5 (Low). By design. This is the feature." It has exactly
 *   three detection postures: the dog that didn't bark, the whisper in the
 *   crowd, the fiscal fray.
 *
 *   Dark Signal Desk (prompt 04) — "MANDATORY adversarial verification."
 *   Four gates, and: "Finalizing a contested signal without executing and
 *   documenting adversarial searches is a CRITICAL PROTOCOL VIOLATION. No
 *   exceptions."
 *
 * TownReporter had collapsed both into a single pass with a soft
 * `counter_narrative` string. This module is the machinery that puts the two
 * stages back, in code rather than in prose the model may talk itself out of.
 *
 * Nothing here fetches or searches. It builds the queries the APP runs and
 * reads the answers back — the model never gets a tool.
 */

import { isSelfReferential } from "./claim-hygiene.ts";

/* -------------------------------------------------------------------------
   Stage 1 — the Black Desk cap
   ------------------------------------------------------------------------- */

/**
 * "Confidence stays capped at 0.5 regardless of strength score."
 * (03-black-desk.md:220)
 *
 * Enforced here, in code, because a prompt line is a request and this is a
 * rule. A speculative pass that files at 0.8 is not a speculative pass.
 */
export const BLACK_DESK_CONFIDENCE_CAP = 0.5;

/** The floor the original gives the same range: 0.1-0.5. */
export const BLACK_DESK_CONFIDENCE_FLOOR = 0.1;

export function capSpeculativeConfidence(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return BLACK_DESK_CONFIDENCE_FLOOR;
  return Math.min(BLACK_DESK_CONFIDENCE_CAP, Math.max(BLACK_DESK_CONFIDENCE_FLOOR, n));
}

/* -------------------------------------------------------------------------
   The three postures
   ------------------------------------------------------------------------- */

/**
 * "THREE DETECTION POSTURES ... 1. THE DOG THAT DIDN'T BARK 2. THE WHISPER
 * IN THE CROWD 3. THE FISCAL FRAY" (03-black-desk.md:47-63).
 *
 * Two more had been added here that the original never had — "Chorus that
 * rhymes" and "The web" — and a whole RULE existed only to keep the invented
 * Chorus posture from becoming an accusation. Both are gone.
 */
export const POSTURES = [
  "Dog That Didn't Bark",
  "Whisper",
  "Fiscal Fray",
] as const;

export type Posture = (typeof POSTURES)[number];

/** Map whatever the model wrote onto one of the three. */
export function normalizePosture(raw: unknown): Posture {
  const t = String(raw ?? "").toLowerCase();
  if (/bark|dog|absen|missing|silen|vanish|disappear/.test(t)) return "Dog That Didn't Bark";
  if (/fiscal|money|budget|fund|fee|revenue|financ|contract|procure/.test(t)) return "Fiscal Fray";
  return "Whisper";
}

/* -------------------------------------------------------------------------
   Stage 2 — search minimums and domain tiers
   ------------------------------------------------------------------------- */

/**
 * "Time window: Search within the last 90 days unless the signal involves
 * historical events requiring a wider window" (04-dark-signal-desk.md:98-99).
 */
export const RECENCY_DAYS = 90;

/**
 * "Query variations: Try at least 3 distinct query variations before
 * documenting 'not found'" (04-dark-signal-desk.md:100-102).
 */
export const MIN_QUERY_VARIATIONS = 3;

/**
 * "Platforms: Search a minimum of 3 platforms (official website, established
 * news outlets, social media or community forums)"
 * (04-dark-signal-desk.md:96-97). civic-scanner v2.1 names the same three as
 * source tiers and orders them: official .gov first, then local press, then
 * community (SKILL.md:100-133, 170-177).
 */
export const SEARCH_TIERS = ["official", "local-press", "community"] as const;
export type SearchTier = (typeof SEARCH_TIERS)[number];

export const MIN_PLATFORMS = 3;

/** Plain words for the editor. Never a bare tier id on screen. */
export const TIER_WORDS: Record<SearchTier, string> = {
  official: "official record",
  "local-press": "local press",
  community: "community",
};

const COMMUNITY_HOSTS = [
  "reddit.com",
  "nextdoor.com",
  "facebook.com",
  "youtube.com",
  "x.com",
  "twitter.com",
  "nextdoor.co.uk",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Which tier answered. Official domains come from the paper's own configured
 * sources (see absence-gate's `officialDomains`); press domains from the
 * watch list's Tier B entries. Anything on a known community platform is
 * community; everything else falls to local press, which is the tier that
 * cannot be the sole basis for publication anyway.
 */
export function tierForUrl(
  url: string,
  official: string[] = [],
  press: string[] = [],
): SearchTier {
  const host = hostOf(url);
  if (!host) return "community";
  const on = (list: string[]) => list.some((d) => d && (host === d || host.endsWith(`.${d}`)));
  if (on(official) || /\.gov$/.test(host) || /\.gov\.[a-z]{2}$/.test(host)) return "official";
  if (COMMUNITY_HOSTS.some((c) => host === c || host.endsWith(`.${c}`))) return "community";
  if (on(press)) return "local-press";
  return "local-press";
}

/** The tier a query is *aimed* at, before any result comes back. */
export function tierForQuery(query: string, official: string[] = []): SearchTier {
  const q = query.toLowerCase();
  if (/site:\S*\.gov|\bagenda\b|\bminutes\b|\bordinance\b|\bbudget\b|\bpermit\b|\bresolution\b/.test(q))
    return "official";
  if (official.some((d) => d && q.includes(`site:${d}`))) return "official";
  if (/reddit|nextdoor|facebook|youtube|forum|comments/.test(q)) return "community";
  return "local-press";
}

export type Place = { city: string; state: string; county?: string | null };

/**
 * Location scoping, on by default.
 *
 * civic-scanner v2.1: "Location context — Use `user_location` with the target
 * city's location to localize results" (SKILL.md:180-182). A query that names
 * no place searches the whole internet and comes back with a national
 * explainer, which is exactly the "very few real clues" complaint.
 */
export function locationTerms(place: Place): string[] {
  const out = [place.city].filter(Boolean);
  if (place.state) out.push(`${place.city} ${place.state}`.trim());
  if (place.county) out.push(`${place.county} County`);
  return out.filter(Boolean);
}

export function isLocationScoped(query: string, place: Place): boolean {
  const q = query.toLowerCase();
  return locationTerms(place).some((t) => q.includes(t.toLowerCase()));
}

export function scopeToLocation(query: string, place: Place): string {
  if (!place.city) return query;
  return isLocationScoped(query, place) ? query : `${query} ${place.city}`.trim();
}

/**
 * At least three distinct query variations per hypothesis, location-scoped,
 * spread across the tiers. Deterministic — the app owns these, not the model.
 */
export function queryVariations(hypothesis: string, place: Place): string[] {
  const stem = hypothesis.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!stem) return [];
  const city = place.city || "";
  const county = place.county ? `${place.county} County` : city;
  const out = [
    `${stem} ${city}`.trim(),
    `${stem} ${county} agenda OR minutes OR ordinance`.trim(),
    `${stem} ${city} (reddit OR nextdoor OR "residents say")`.trim(),
  ];
  return out.filter((q, i, a) => q && a.indexOf(q) === i).slice(0, Math.max(MIN_QUERY_VARIATIONS, 3));
}

/**
 * Fill a hop plan up to the minimum: every hypothesis gets at least
 * MIN_QUERY_VARIATIONS distinct queries, and every query names the place.
 * Returns the searches the app should actually run, planner queries first.
 */
export function enforceSearchMinimums(
  searches: string[],
  hypotheses: string[],
  place: Place,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (q: string) => {
    const scoped = scopeToLocation(q, place);
    const key = scoped.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(scoped);
  };
  for (const q of searches) if (q) push(q);
  for (const h of hypotheses) {
    if (!h) continue;
    const stem = h.toLowerCase().slice(0, 40);
    const already = out.filter((q) => q.toLowerCase().includes(stem.slice(0, 24))).length;
    if (already >= MIN_QUERY_VARIATIONS) continue;
    for (const v of queryVariations(h, place)) push(v);
  }
  return out;
}

/* -------------------------------------------------------------------------
   The four gates
   ------------------------------------------------------------------------- */

/**
 * The adversarial searches the APP runs before the model is allowed to
 * finalize anything. Four kinds, minimum, across three tiers — the original's
 * "execute ALL of the following" list (04-dark-signal-desk.md:74-102),
 * rewritten for a municipal signal rather than a named accused party.
 */
export type AdversarialKind = "ordinary" | "official" | "press" | "counter";

export const ADVERSARIAL_KINDS: AdversarialKind[] = [
  "ordinary",
  "official",
  "press",
  "counter",
];

export const KIND_WORDS: Record<AdversarialKind, string> = {
  ordinary: "the ordinary explanation",
  official: "the official record",
  press: "local press",
  counter: "the opposing account",
};

export type AdversarialQuery = {
  query: string;
  kind: AdversarialKind;
  tier: SearchTier;
};

/**
 * "For every serious hypothesis also search the innocent explanation" — and
 * the boring explanation is written FIRST. civic-scanner: "Gate 2 — Mandatory
 * Adverse Search: Actively search for evidence that CONTRADICTS the story.
 * Spend at least as much effort trying to disprove it as you spent building
 * it" (SKILL.md:117-121).
 */
export function adversarialQueries(
  signal: { name?: string | null; observation?: string | null },
  place: Place,
  officialDomainList: string[] = [],
): AdversarialQuery[] {
  const subject = String(signal.name ?? "").replace(/\s+/g, " ").trim().slice(0, 90) ||
    String(signal.observation ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (!subject) return [];
  const city = place.city || "";
  const county = place.county ? `${place.county} County` : city;
  const site = officialDomainList[0] ? `site:${officialDomainList[0]} ` : "";
  return [
    {
      // The boring explanation, written first and searched first.
      query: `${subject} ${city} routine OR scheduled OR "normal process" OR explanation`.trim(),
      kind: "ordinary",
      tier: "official",
    },
    {
      query: `${site}${subject} ${county} agenda OR minutes OR staff report OR resolution`.trim(),
      kind: "official",
      tier: "official",
    },
    {
      query: `${subject} ${city} news OR reported OR "according to"`.trim(),
      kind: "press",
      tier: "local-press",
    },
    {
      query: `${subject} ${city} (disputed OR denied OR responded OR "not true" OR reddit)`.trim(),
      kind: "counter",
      tier: "community",
    },
  ];
}

/** One executed adversarial search, as the run record stores it. */
export type AdversarialRecord = {
  query: string;
  kind: AdversarialKind;
  tier: SearchTier;
  url: string | null;
  outcome: string;
  hits: number;
};

export function platformsCovered(records: AdversarialRecord[]): SearchTier[] {
  const seen = new Set<SearchTier>();
  for (const r of records) seen.add(r.tier);
  return SEARCH_TIERS.filter((t) => seen.has(t));
}

export function adversarialComplete(records: AdversarialRecord[]): boolean {
  if (records.length < ADVERSARIAL_KINDS.length) return false;
  const kinds = new Set(records.map((r) => r.kind));
  if (!ADVERSARIAL_KINDS.every((k) => kinds.has(k))) return false;
  return platformsCovered(records).length >= MIN_PLATFORMS;
}

/**
 * The four gates, as the model must answer them.
 *
 * Gate 1 (contestation) and Gate 2 (the adversarial searches) are executed by
 * the APP — the searches above — and their evidence is what the model reads.
 * What the model owes back is these four answers, and a missing one is not a
 * "maybe": the signal stays unverified and the desk says so.
 */
export type FourGates = {
  /** Gate 2: what was tried to DISPROVE this, and what came back. */
  disproof_attempted: string;
  /** Gate 3: which of these sources trace back to a single origin. */
  source_independence: string;
  /** Gate 3: what a reader would need that this signal does not have. */
  missing_context: string;
  /** Gate 4: is this about AI, journalism, information integrity, or this tool. */
  self_referential: boolean;
};

export const GATE_KEYS = [
  "disproof_attempted",
  "source_independence",
  "missing_context",
  "self_referential",
] as const;

export const GATE_WORDS: Record<(typeof GATE_KEYS)[number], string> = {
  disproof_attempted: "what was tried to disprove it",
  source_independence: "whether the sources are independent",
  missing_context: "what context is missing",
  self_referential: "the self-referential check",
};

export type GateReading = {
  gates: Partial<FourGates>;
  missing: (typeof GATE_KEYS)[number][];
};

export function readGates(raw: unknown): GateReading {
  const src = (raw ?? {}) as Record<string, unknown>;
  const gates: Partial<FourGates> = {};
  const missing: (typeof GATE_KEYS)[number][] = [];

  for (const key of ["disproof_attempted", "source_independence", "missing_context"] as const) {
    const v = String(src[key] ?? "").trim();
    // A one-word shrug is a missing gate, not a filled one. The original
    // wants documented searches, not a checkbox.
    if (v.length < 12) missing.push(key);
    else gates[key] = v.slice(0, 4000);
  }

  const sr = src.self_referential;
  if (typeof sr === "boolean") gates.self_referential = sr;
  else if (typeof sr === "string" && /^(true|yes|false|no)$/i.test(sr.trim()))
    gates.self_referential = /^(true|yes)$/i.test(sr.trim());
  else missing.push("self_referential");

  return { gates, missing };
}

export type VerificationStatus = "unverified" | "verified";

export type Verdict = {
  status: VerificationStatus;
  missing: string[];
  /** Why, in words the editor reads on the card. */
  reason: string;
};

/**
 * "If ANY item unchecked -> Signal is INCOMPLETE. Do not publish."
 * (04-dark-signal-desk.md:147)
 *
 * Gate 4 is absolute: "IF YES: Apply EXTRA scrutiny." Here that is spelled as
 * never finalizing on its own — the sandbox-narration garbage of 0.6.14 was
 * exactly a signal about the tool itself, and this is the gate that stops it.
 */
export function verify(input: {
  gates: Partial<FourGates>;
  missing: (typeof GATE_KEYS)[number][];
  adversarial: AdversarialRecord[];
  text?: string;
}): Verdict {
  const missing: string[] = [];
  for (const key of input.missing) missing.push(GATE_WORDS[key]);
  if (!adversarialComplete(input.adversarial)) {
    const covered = platformsCovered(input.adversarial).length;
    missing.push(
      `the adversarial searches (${input.adversarial.length} of ${ADVERSARIAL_KINDS.length} run, ${covered} of ${MIN_PLATFORMS} kinds of source)`,
    );
  }
  const selfRef =
    input.gates.self_referential === true || (input.text ? isSelfReferential(input.text) : false);
  if (selfRef) {
    return {
      status: "unverified",
      missing: [...missing, "it is about this tool or its own kind of work"],
      reason:
        "Held back on purpose. This signal is about AI, journalism or the tool itself, and the desk never finalizes those on its own — the original doctrine calls that a blind spot, not a story.",
    };
  }
  if (missing.length)
    return {
      status: "unverified",
      missing,
      reason: `Not verified yet. Still missing: ${missing.join("; ")}.`,
    };
  return {
    status: "verified",
    missing: [],
    reason:
      "Verified. The desk ran the adversarial searches itself and the model answered all four gates.",
  };
}

/** The words on the chip and the line under it. */
export function stageWords(row: {
  stage?: string | null;
  verification_status?: string | null;
  gates_missing?: string | null;
}): { chip: string; sentence: string } {
  const missing = String(row.gates_missing ?? "").trim();
  if (row.verification_status === "verified")
    return {
      chip: "Verified · four gates",
      sentence:
        "The desk searched for the ordinary explanation, the official record, local press and the opposing account, then the model answered all four gates.",
    };
  if (row.stage === "dark-signal-desk")
    return {
      chip: "Unverified · gates missing",
      sentence: missing
        ? `Verification ran but did not finish. Still missing: ${missing}`
        : "Verification ran but did not finish. Treat this as a question, not a finding.",
    };
  return {
    chip: "Black Desk · speculative, ≤50%",
    sentence:
      "Stage one only. This is a question the desk thinks is worth asking; nothing here has been checked against an opposing account yet, and its confidence is capped at 50% on purpose.",
  };
}

/* -------------------------------------------------------------------------
   The newsworthiness gate
   ------------------------------------------------------------------------- */

/**
 * civic-scanner's ninth-agent gate, in the plain form the operator's originals
 * put it: "This gate can KILL or DEMOTE stories. A well-sourced story that
 * fails the newsworthiness test does not advance to verification"
 * (civic-scanner/SKILL.md:560-563).
 *
 * Three questions, three answers, stored on the lead. A no to all three is a
 * watch item, not a lead.
 */
export type Newsworthiness = {
  /** Does anyone's life change? (Impact) */
  life_changes: boolean;
  /** Is it new? (Immediacy / novelty) */
  is_new: boolean;
  /** Is there a record? (Is it checkable at all) */
  has_record: boolean;
  note: string;
};

export function readNewsworthiness(raw: unknown): Newsworthiness | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const bool = (v: unknown) =>
    typeof v === "boolean" ? v : typeof v === "string" ? /^(true|yes)$/i.test(v.trim()) : false;
  if (
    !("life_changes" in src) &&
    !("is_new" in src) &&
    !("has_record" in src)
  )
    return null;
  return {
    life_changes: bool(src.life_changes),
    is_new: bool(src.is_new),
    has_record: bool(src.has_record),
    note: String(src.note ?? "").slice(0, 1200),
  };
}

export type NewsworthyDecision = "lead" | "watch";

export function newsworthyDecision(n: Newsworthiness | null): NewsworthyDecision {
  if (!n) return "watch";
  return n.life_changes || n.is_new || n.has_record ? "lead" : "watch";
}

export function newsworthinessWords(n: Newsworthiness | null): string {
  if (!n) return "The newsworthiness gate has not been answered for this signal yet.";
  const yes = (b: boolean) => (b ? "yes" : "no");
  return [
    `Does anyone's life change? ${yes(n.life_changes)}.`,
    `Is it new? ${yes(n.is_new)}.`,
    `Is there a record? ${yes(n.has_record)}.`,
    n.note,
  ]
    .filter(Boolean)
    .join(" ");
}

/* -------------------------------------------------------------------------
   The Stage 2 prompt
   ------------------------------------------------------------------------- */

export const DARK_VERIFY_SYSTEM = `TOWNREPORTER — DARK SIGNAL DESK: STRUCTURED VERIFICATION

YOU HAVE NO TOOLS IN THIS CALL. Do NOT attempt Bash, WebSearch, WebFetch or any MCP tool — they will be refused. The application has ALREADY run the adversarial searches for you and the results are in the pack below. Read them. Return ONLY the JSON described at the end.

This is stage two. Stage one (the Black Desk) was speculative by design and everything it filed is capped at 0.5 confidence. Nothing it filed may be treated as finalized until you complete these gates.

MANDATORY ADVERSARIAL COMPLETENESS CHECK — this is not optional and cannot be bypassed.
Without adversarial checking you become a vector for one-sided narratives. The other party may have already responded, acknowledged the issue, or documented a fix; unless you are forced to look for that response you will never find it.

GATE 1 — CONTESTATION. Does this signal accuse a person or organization, allege wrongdoing, present conflicting accounts, risk reputational harm, or rest mainly on one party's characterization? The application has already run four searches on your behalf regardless of the answer.

GATE 2 — DISPROOF. Write what was tried to DISPROVE this signal and what came back, naming the searches in the pack and their results — including the ones that returned nothing. Write the boring explanation FIRST: the routine, scheduled, administrative reason this could be nothing. Spend at least as much effort trying to kill it as building it. Field: disproof_attempted.

GATE 3 — INDEPENDENCE AND MISSING CONTEXT. Say which of the sources here trace back to a single origin (one press release, one poster, one meeting) and which are genuinely independent. Then say what a reader would need that this signal does not have. Fields: source_independence, missing_context.

GATE 4 — SELF-REFERENTIAL WARNING. Is this signal about AI, journalism, information integrity, media, or this tool itself? These topics create cognitive blind spots and you are more likely to rationalize away from uncomfortable protocol requirements when analyzing mirrors of your own function. Answer honestly: true means this is NEVER finalized. Field: self_referential.

A gate you cannot answer stays empty. Do not fill it with a phrase to get past it — an unanswered gate leaves the signal unverified, which is a correct outcome, and a faked one is a protocol violation.

NEWSWORTHINESS GATE — three questions, answered before this can become a lead:
  Does anyone's life change because of this? (life_changes)
  Is it new, or a routine recurrence? (is_new)
  Is there a record — a document, an agenda item, a filing — that anyone could check? (has_record)
No to all three is a watch item, not a story. Say so plainly in note.

Return ONLY JSON:
{
  "gates": {
    "disproof_attempted": "the boring explanation first, then the searches that were run and what came back",
    "source_independence": "which sources trace to one origin, which are independent",
    "missing_context": "what a reader would need that this does not have",
    "self_referential": false
  },
  "counter_narrative": "the strongest version of the opposing account, or 'none found' with what was searched",
  "newsworthiness": {"life_changes": false, "is_new": false, "has_record": false, "note": ""},
  "confidence": 0.0,
  "handoff": "DISCARD|HOLD FOR PATTERN|MONITOR|FOR VERIFICATION"
}`;
