/**
 * Golden-fact scoring for meeting stories (0.6.63).
 *
 * A golden fixture records what a meeting story *must* get right — the motion, who moved it,
 * who seconded it, the recorded tally, and who sat on each side — each pinned to a caption
 * timestamp and quoted caption line, with official spellings taken from the city roster.
 * This module scores a story against one fixture, with no database and no model: every
 * verdict is a pattern match on the story text, and every verdict carries the sentence that
 * decided it.
 *
 * Verdicts
 *   correct              the story states the fact the way the fixture records it.
 *   wrong                the story contradicts the fixture: a tally that differs, a side that
 *                        is inverted, an attribution to the wrong person, a title that
 *                        belongs to a different member, or a caption spelling printed as a
 *                        name (captions never establish a spelling).
 *   not-stated           the story does not state the fact at all (a required fact that is
 *                        not stated fails the story).
 *   masked-correct-role  the story says "an unidentified speaker" with no title that belongs
 *                        to someone else: an honest gap, not an error.
 *   masked-wrong-role    the story says "an unidentified speaker" *and* attaches a title that
 *                        belongs to another member — draft 164's "seconded by Mayor Pro Tem an
 *                        unidentified speaker", which merges Mayor Pro Tem Sean McCoy (who
 *                        seconded other motions that night) into this motion.
 *
 * pass = no `wrong`, no `masked-wrong-role`, and no required fact left `not-stated`.
 *
 * Known limits (deliberate, model-free):
 *   - The motion fact is scored on the phrases the fixture marks `must_mention`. Paraphrase
 *     contradiction is not detected; a story that gets the motion's substance wrong reads
 *     `not-stated`.
 *   - Side detection reads the sentence around an opposition/support phrase, so it covers
 *     "X, Y and Z opposed the motion", "opposed by X, Y and Z", and "joined ... in support".
 *     Unusual phrasings read `not-stated`.
 *   - One motion per fixture: an attribution sentence is scored against the fixture's motion.
 */

export type GoldenFactKind = "motion" | "mover" | "seconder" | "result" | "opposed" | "in-favor";

export type GoldenVerdict =
  | "correct"
  | "wrong"
  | "not-stated"
  | "masked-correct-role"
  | "masked-wrong-role";

export type GoldenEvidence = {
  source: "recording" | "roster";
  quote: string;
  t_ms: number;
  at: string;
  line: number | null;
  note: string;
};

export type GoldenRosterMember = {
  name: string;
  role: string;
  district: string | null;
  honorific: string | null;
  captionAliases: string[];
  source: string;
};

export type GoldenFact = {
  kind: GoldenFactKind;
  required: boolean;
  /** Where the fact itself comes from: the recording, the roster, or both (a derived side). */
  factSource: string;
  /** Where the person's spelling comes from. Always the roster when the fact names someone. */
  nameSource: string | null;
  person: string | null;
  result: string | null;
  tally: string | null;
  summary: string;
  mustMention: string[];
  /** How a derived fact was worked out, when the recording does not state it. Empty otherwise. */
  derivation: string;
  evidence: GoldenEvidence[];
};

export type GoldenFixture = {
  meeting: {
    id: string;
    title: string;
    city: string;
    date: string;
    recordingUrl: string;
    rosterUrl: string;
  };
  roster: GoldenRosterMember[];
  facts: GoldenFact[];
};

export type StoryText = { headline: string; dek: string; body: string };

export type FactVerdict = {
  kind: GoldenFactKind;
  subject: string;
  required: boolean;
  verdict: GoldenVerdict;
  sentence: string | null;
  reason: string;
};

export type GoldenScore = {
  meeting: string;
  fixtureFacts: number;
  verdicts: FactVerdict[];
  counts: {
    correct: number;
    wrong: number;
    "not-stated": number;
    "masked-correct-role": number;
    "masked-wrong-role": number;
    total: number;
  };
  pass: boolean;
  failures: string[];
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : {};

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Read a fixture file's parsed JSON into the shape the scorer uses. */
export function loadGoldenFixture(raw: unknown): GoldenFixture {
  const root = asRecord(raw);
  const meeting = asRecord(root.meeting);
  const recording = asRecord(meeting.recording);
  const rosterSource = asRecord(meeting.roster_source);
  return {
    meeting: {
      id: asString(meeting.id),
      title: asString(meeting.title),
      city: asString(meeting.city),
      date: asString(meeting.date),
      recordingUrl: asString(recording.url),
      rosterUrl: asString(rosterSource.url),
    },
    roster: asArray(root.roster).map((entry) => {
      const member = asRecord(entry);
      return {
        name: asString(member.name),
        role: asString(member.role),
        district: typeof member.district === "string" ? member.district : null,
        honorific: typeof member.honorific === "string" ? member.honorific : null,
        captionAliases: asArray(member.caption_name_aliases).map((alias) => asString(alias)).filter(Boolean),
        source: asString(member.source, "roster"),
      };
    }),
    facts: asArray(root.facts).map((entry) => {
      const fact = asRecord(entry);
      return {
        kind: asString(fact.kind) as GoldenFactKind,
        required: fact.required === true,
        factSource: asString(fact.fact_source),
        nameSource: typeof fact.name_source === "string" ? fact.name_source : null,
        person: typeof fact.person === "string" ? fact.person : null,
        result: typeof fact.result === "string" ? fact.result : null,
        tally: typeof fact.tally === "string" ? fact.tally : null,
        summary: asString(fact.summary),
        mustMention: asArray(fact.must_mention).map((phrase) => asString(phrase)).filter(Boolean),
        derivation: asString(fact.derivation),
        evidence: asArray(fact.evidence).map((item) => {
          const evidence = asRecord(item);
          return {
            source: asString(evidence.source, "recording") === "roster" ? "roster" : "recording",
            quote: asString(evidence.quote),
            t_ms: asNumber(evidence.t_ms),
            at: asString(evidence.at),
            line: typeof evidence.line === "number" ? evidence.line : null,
            note: asString(evidence.note),
          };
        }),
      };
    }),
  };
}

/**
 * Split a story text file at the HEADLINE / DEK / BODY markers the newsroom writes. Text with
 * no markers is treated as body, so a plain paragraph still scores.
 */
export function parseStoryText(raw: string): StoryText {
  const story: StoryText = { headline: "", dek: "", body: "" };
  const buffers: Record<keyof StoryText, string[]> = { headline: [], dek: [], body: [] };
  let current: keyof StoryText | null = null;
  let sawMarker = false;
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^(HEADLINE|DEK|BODY)\s*$/.exec(line.trim());
    if (marker) {
      current = marker[1].toLowerCase() as keyof StoryText;
      sawMarker = true;
      continue;
    }
    if (current) buffers[current].push(line);
  }
  if (!sawMarker) {
    story.body = raw.trim();
    return story;
  }
  for (const part of ["headline", "dek", "body"] as const) {
    story[part] = buffers[part].join("\n").trim().replace(/\n{3,}/g, "\n\n");
  }
  return story;
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type StorySentence = { text: string; part: keyof StoryText };

/** "Sept." and "Dr." end a word, not a sentence. */
const ABBREVIATION = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|St|Mt|No|Inc|Jr|Sr|vs|etc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.$/i;

function sentencePieces(text: string): string[] {
  const pieces: string[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const previous = pieces[pieces.length - 1];
    if (previous && ABBREVIATION.test(previous)) pieces[pieces.length - 1] = `${previous} ${raw}`;
    else pieces.push(raw);
  }
  return pieces;
}

function storySentences(story: StoryText): StorySentence[] {
  const out: StorySentence[] = [];
  const add = (text: string, part: keyof StoryText) => {
    for (const line of text.split(/\n+/)) {
      for (const piece of sentencePieces(line)) {
        const trimmed = piece.trim();
        if (trimmed) out.push({ text: trimmed, part });
      }
    }
  };
  if (story.headline.trim()) add(story.headline, "headline");
  if (story.dek.trim()) add(story.dek, "dek");
  if (story.body.trim()) add(story.body, "body");
  return out;
}

// ---------------------------------------------------------------------------------------
// Names, titles, and who owns which title
// ---------------------------------------------------------------------------------------

type Mention = { member: GoldenRosterMember; surface: "official" | "alias"; form: string; index: number };

const TITLE_FORMS: Array<{ title: string; source: string }> = [
  { title: "Mayor Pro Tem", source: "mayor\\s+pro\\s+tem(?:pore)?" },
  { title: "Mayor", source: "mayors?" },
  { title: "Council Member", source: "council\\s?members?|councilmember|councilwoman|councilman|council" },
];

/** Strip leading honorifics/roles ("Council Member Jake Marsing") and report which were there. */
function stripTitles(text: string): { titles: string[]; rest: string; consumed: number } {
  const trimmed = text.replace(/^[\s,;:-]+/, "");
  const titles: string[] = [];
  let rest = trimmed;
  for (;;) {
    const before = rest;
    for (const form of TITLE_FORMS) {
      const match = new RegExp(`^(?:${form.source})[\\s,]+`, "iu").exec(rest);
      if (match) {
        titles.push(form.title);
        rest = rest.slice(match[0].length);
        break;
      }
    }
    if (rest === before) break;
  }
  return { titles, rest, consumed: trimmed.length - rest.length };
}

const NAME_RUN = /^([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,2})/u;
const MASKED_PERSON =
  /\b(?:an?\s+|the\s+|one\s+|another\s+|two\s+|three\s+|several\s+)?unidentified\s+(?:speakers?|council\s?members?|officials?|people|persons?|residents?|voters?)\b|\bunnamed\s+(?:speakers?|council\s?members?)\b|\bwhose\s+name\s+(?:was|is)\s+not\s+(?:stated|given|verified|known)\b|\bname\s+not\s+(?:stated|given|verified)\b|\bnot\s+named\b/i;

function findMentions(text: string, fixture: GoldenFixture): Mention[] {
  const found: Mention[] = [];
  const collect = (member: GoldenRosterMember, surface: "official" | "alias", form: string) => {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form)}(?![\\p{L}\\p{N}])`, "giu");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.push({ member, surface, form, index: match.index });
    }
  };
  for (const member of fixture.roster) {
    const surname = member.name.split(/\s+/).slice(-1)[0] ?? member.name;
    for (const form of new Set([member.name, surname])) {
      if (form) collect(member, "official", form);
    }
    for (const alias of member.captionAliases) collect(member, "alias", alias);
  }
  return found.sort((a, b) => a.index - b.index || b.form.length - a.form.length);
}

function titleOwners(title: string, fixture: GoldenFixture): GoldenRosterMember[] {
  return fixture.roster.filter((member) => (member.honorific ?? member.role) === title);
}

/** The title that the story attached to this fact's person but that belongs to someone else. */
function titleConflict(titles: string[], person: string | null, fixture: GoldenFixture): string | null {
  if (!person) return null;
  for (const title of titles) {
    const owners = titleOwners(title, fixture);
    if (owners.length > 0 && owners.every((owner) => owner.name !== person)) return title;
  }
  return null;
}

type PersonMatch = { member: GoldenRosterMember | null; alias: boolean };

function matchRosterPerson(printed: string, fixture: GoldenFixture): PersonMatch {
  const wanted = normalize(printed);
  for (const member of fixture.roster) {
    const surname = normalize(member.name.split(/\s+/).slice(-1)[0] ?? member.name);
    if (normalize(member.name) === wanted || surname === wanted) return { member, alias: false };
  }
  for (const member of fixture.roster) {
    if (member.captionAliases.some((alias) => normalize(alias) === wanted)) return { member, alias: true };
  }
  return { member: null, alias: false };
}

// ---------------------------------------------------------------------------------------
// Attribution of a motion to a mover / a seconder
// ---------------------------------------------------------------------------------------

type Attribution =
  | { kind: "named"; name: string; titles: string[] }
  | { kind: "masked"; titles: string[] }
  | { kind: "none" };

function mentionAfter(window: string): Attribution {
  const trimmed = window.replace(/^[\s,;:-]+/, "");
  const stripped = stripTitles(trimmed);
  const masked = MASKED_PERSON.exec(trimmed);
  if (masked && masked.index <= stripped.consumed) return { kind: "masked", titles: stripped.titles };
  const name = NAME_RUN.exec(stripped.rest);
  if (name) return { kind: "named", name: name[1].replace(/\s+/g, " "), titles: stripped.titles };
  return { kind: "none" };
}

const TITLE_THEN_NAME = new RegExp(
  `(?:(?:${TITLE_FORMS.map((t) => t.source).join("|")})\\b[\\s,]+)+([\\p{Lu}][\\p{L}'’-]*(?:\\s+[\\p{Lu}][\\p{L}'’-]*){0,2})\\s*$`,
  "iu",
);
const TRAILING_NAME_RUN = /([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,2})\s*$/u;

function mentionBefore(window: string): Attribution {
  const trimmed = window.replace(/[\s,;:-]+$/, "");
  const masked = MASKED_PERSON.exec(trimmed);
  if (masked) {
    const afterMask = trimmed.slice(masked.index + masked[0].length).trim();
    if (afterMask === "") return { kind: "masked", titles: stripTitles(trimmed).titles };
  }
  const titled = TITLE_THEN_NAME.exec(trimmed);
  if (titled) return { kind: "named", name: titled[1].replace(/\s+/g, " "), titles: stripTitles(trimmed).titles };
  const trailing = TRAILING_NAME_RUN.exec(trimmed);
  if (trailing) return { kind: "named", name: trailing[1].replace(/\s+/g, " "), titles: [] };
  return { kind: "none" };
}

function attributionIn(sentence: string, kind: "mover" | "seconder"): Attribution {
  const afterPatterns = kind === "mover"
    ? [/\b(?:was\s+|were\s+)?made\s+by\b/i, /\b(?:was\s+|were\s+)?moved\s+by\b/i]
    : [/\bseconded\s+by\b/i];
  const beforePatterns = kind === "mover" ? [/\bmoved\b/i] : [/\bseconded\b/i];
  for (const pattern of afterPatterns) {
    const match = pattern.exec(sentence);
    if (match) {
      const attribution = mentionAfter(sentence.slice(match.index + match[0].length, match.index + match[0].length + 160));
      if (attribution.kind !== "none") return attribution;
    }
  }
  for (const pattern of beforePatterns) {
    const match = pattern.exec(sentence);
    if (match) {
      const attribution = mentionBefore(sentence.slice(Math.max(0, match.index - 90), match.index));
      if (attribution.kind !== "none") return attribution;
    }
  }
  return { kind: "none" };
}

function scoreAttributionFact(fact: GoldenFact, story: StoryText, fixture: GoldenFixture): FactVerdict {
  const person = fact.person;
  const base = { kind: fact.kind, subject: person ?? "(unnamed)", required: fact.required };
  for (const sentence of storySentences(story)) {
    const attribution = attributionIn(sentence.text, fact.kind as "mover" | "seconder");
    if (attribution.kind === "none") continue;
    if (attribution.kind === "masked") {
      const conflict = titleConflict(attribution.titles, person, fixture);
      if (conflict) {
        const owner = titleOwners(conflict, fixture).map((member) => member.name).join(" / ");
        return {
          ...base,
          verdict: "masked-wrong-role",
          sentence: sentence.text,
          reason: `left the ${fact.kind} unidentified but attached "${conflict}", which belongs to ${owner}`,
        };
      }
      return {
        ...base,
        verdict: "masked-correct-role",
        sentence: sentence.text,
        reason: `left the ${fact.kind} unidentified with no title claimed for another member`,
      };
    }
    const match = matchRosterPerson(attribution.name, fixture);
    if (!match.member) {
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: `named ${attribution.name} as the ${fact.kind}, who is not on the roster`,
      };
    }
    if (match.member.name !== person) {
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: match.alias
          ? `named ${attribution.name} (a caption spelling of ${match.member.name}) as the ${fact.kind}; it was ${person}`
          : `named ${match.member.name} as the ${fact.kind}; it was ${person}`,
      };
    }
    if (match.alias) {
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: `printed the caption spelling "${attribution.name}" for ${person}; the roster spells it ${person}`,
      };
    }
    const conflict = titleConflict(attribution.titles, person, fixture);
    if (conflict) {
      const owner = titleOwners(conflict, fixture).map((member) => member.name).join(" / ");
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: `gave ${person} the title "${conflict}", which belongs to ${owner}`,
      };
    }
    return { ...base, verdict: "correct", sentence: sentence.text, reason: `named ${person} as the ${fact.kind}` };
  }
  return {
    ...base,
    verdict: "not-stated",
    sentence: null,
    reason: `the story never says who ${fact.kind === "mover" ? "moved" : "seconded"} the motion`,
  };
}

// ---------------------------------------------------------------------------------------
// The recorded vote: tally and result
// ---------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

const TALLY = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-|–|—|to)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;

const VOTE_VERB = /\b(?:carr(?:ied|ies|y)|pass(?:ed|es)|approv(?:ed|es)|adopt(?:ed|s)|fail(?:ed|s)?|reject(?:ed|s)?|defeat(?:ed|s)?|vot(?:e|ed|es|ing)|tally|in opposition|unanimous)\b/i;

const VOTE_FAILED = /\b(?:fail(?:ed|s)?|reject(?:ed|s)?|defeat(?:ed|s)?|did\s+not\s+(?:carry|pass)|not\s+carried|unanimous(?:ly)?)\b/i;

const MONTH_BEFORE = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i;

function normalizeTally(text: string): string {
  const [left, right] = text.trim().toLowerCase().split(/\s*(?:-|–|—|to)\s*/);
  const convert = (value: string | undefined): string => NUMBER_WORDS[value ?? ""] ?? (value ?? "").trim();
  return `${convert(left)}-${convert(right)}`;
}

function scoreResultFact(fact: GoldenFact, story: StoryText): FactVerdict {
  const base = { kind: fact.kind, subject: fact.tally ?? "(tally)", required: fact.required };
  const wanted = fact.tally ? normalizeTally(fact.tally) : null;
  for (const sentence of storySentences(story)) {
    if (!VOTE_VERB.test(sentence.text)) continue;
    const match = TALLY.exec(sentence.text);
    const unanimous = /\bunanimous(?:ly)?\b/i.test(sentence.text);
    if (!match && !unanimous) continue;
    if (match && MONTH_BEFORE.test(sentence.text.slice(0, match.index))) continue;
    const said = match ? normalizeTally(match[0]) : "unanimous";
    if (wanted && said !== wanted) {
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: `reported the vote as ${said}; the recording records ${fact.tally}`,
      };
    }
    const failed = VOTE_FAILED.test(sentence.text);
    if (fact.result === "carried" && failed) {
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: `reported the motion as failed; the recording records it carried ${fact.tally}`,
      };
    }
    if (fact.result === "failed" && !failed) {
      return {
        ...base,
        verdict: "wrong",
        sentence: sentence.text,
        reason: `reported the motion as carried; the recording records it failed`,
      };
    }
    return {
      ...base,
      verdict: "correct",
      sentence: sentence.text,
      reason: `states the ${fact.tally} ${fact.result ?? "result"}`,
    };
  }
  return {
    ...base,
    verdict: "not-stated",
    sentence: null,
    reason: `the story never states the ${fact.tally ?? ""} tally`.trim(),
  };
}

// ---------------------------------------------------------------------------------------
// Which side each member is on
// ---------------------------------------------------------------------------------------

const SIDE_PATTERNS: Array<{ side: "opposed" | "in-favor"; source: string }> = [
  { side: "opposed", source: "in opposition|opposed|opposing|voted no|voting no|votes no|cast no|dissented|dissent|against" },
  { side: "in-favor", source: "in favor|in support|voted yes|voting yes|votes yes|supported|supporting|backed|favor(?:ed|ing)|favour(?:ed|ing)" },
];

const SCOPE_BREAK = /\b(?:while|whereas|although|though|but|who|which|that)\b/i;

type Assignment = { side: "opposed" | "in-favor"; surface: "official" | "alias"; sentence: string };

function sideOccurrences(sentence: string): Array<{ side: "opposed" | "in-favor"; start: number; end: number }> {
  const out: Array<{ side: "opposed" | "in-favor"; start: number; end: number }> = [];
  for (const pattern of SIDE_PATTERNS) {
    const matcher = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(sentence)) !== null) {
      out.push({ side: pattern.side, start: match.index, end: match.index + match[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function sideAssignments(story: StoryText, fixture: GoldenFixture): Map<string, Assignment> {
  const assigned = new Map<string, Assignment>();
  for (const sentence of storySentences(story)) {
    const occurrences = sideOccurrences(sentence.text);
    let cursor = 0;
    for (let index = 0; index < occurrences.length; index += 1) {
      const occurrence = occurrences[index];
      const trailing = /^\s+by\b/i.exec(sentence.text.slice(occurrence.end));
      let from: number;
      let to: number;
      if (trailing) {
        from = occurrence.end + trailing[0].length;
        const breakMatch = new RegExp(SCOPE_BREAK.source, "i").exec(sentence.text.slice(from));
        const scopeEnd = breakMatch ? from + breakMatch.index : sentence.text.length;
        const nextStart = index + 1 < occurrences.length ? occurrences[index + 1].start : sentence.text.length;
        to = Math.min(scopeEnd, nextStart);
      } else {
        from = cursor;
        to = occurrence.start;
      }
      cursor = to;
      for (const mention of findMentions(sentence.text.slice(from, to), fixture)) {
        if (!assigned.has(mention.member.name)) {
          assigned.set(mention.member.name, { side: occurrence.side, surface: mention.surface, sentence: sentence.text });
        }
      }
    }
  }
  return assigned;
}

function scoreSideFact(fact: GoldenFact, assigned: Map<string, Assignment>): FactVerdict {
  const base = { kind: fact.kind, subject: fact.person ?? "(unnamed)", required: fact.required };
  const assignment = fact.person ? assigned.get(fact.person) : undefined;
  if (!assignment) {
    return {
      ...base,
      verdict: "not-stated",
      sentence: null,
      reason: `the story does not place ${fact.person} on the ${fact.kind === "opposed" ? "opposing" : "supporting"} side`,
    };
  }
  if (assignment.side !== fact.kind) {
    return {
      ...base,
      verdict: "wrong",
      sentence: assignment.sentence,
      reason: `placed ${fact.person} with the ${assignment.side === "opposed" ? "opposing" : "supporting"} side; the recording records ${fact.kind === "opposed" ? "opposition" : "support"}`,
    };
  }
  if (assignment.surface === "alias") {
    return {
      ...base,
      verdict: "wrong",
      sentence: assignment.sentence,
      reason: `named ${fact.person} with a caption spelling; the roster spells it ${fact.person}`,
    };
  }
  return {
    ...base,
    verdict: "correct",
    sentence: assignment.sentence,
    reason: `places ${fact.person} on the ${fact.kind === "opposed" ? "opposing" : "supporting"} side`,
  };
}

// ---------------------------------------------------------------------------------------
// The motion itself
// ---------------------------------------------------------------------------------------

function scoreMotionFact(fact: GoldenFact, story: StoryText): FactVerdict {
  const base = { kind: fact.kind, subject: fact.summary || "(motion)", required: fact.required };
  const sentences = storySentences(story);
  const missing = fact.mustMention.filter(
    (phrase) => !sentences.some((sentence) => normalize(sentence.text).includes(normalize(phrase))),
  );
  const deciding = sentences.find((sentence) =>
    fact.mustMention.some((phrase) => normalize(sentence.text).includes(normalize(phrase))),
  );
  if (missing.length > 0) {
    return {
      ...base,
      verdict: "not-stated",
      sentence: deciding ? deciding.text : null,
      reason: `the story does not state the motion's direction (missing: ${missing.join(", ")})`,
    };
  }
  return {
    ...base,
    verdict: "correct",
    sentence: deciding ? deciding.text : null,
    reason: "states the motion's direction",
  };
}

// ---------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------

export function scoreGoldenFacts(story: StoryText, fixture: GoldenFixture): GoldenScore {
  const counts = {
    correct: 0,
    wrong: 0,
    "not-stated": 0,
    "masked-correct-role": 0,
    "masked-wrong-role": 0,
    total: 0,
  };
  const assigned = sideAssignments(story, fixture);
  const verdicts = fixture.facts.map((fact) => {
    if (fact.kind === "mover" || fact.kind === "seconder") return scoreAttributionFact(fact, story, fixture);
    if (fact.kind === "result") return scoreResultFact(fact, story);
    if (fact.kind === "opposed" || fact.kind === "in-favor") return scoreSideFact(fact, assigned);
    return scoreMotionFact(fact, story);
  });
  const failures: string[] = [];
  for (const verdict of verdicts) {
    counts[verdict.verdict] += 1;
    counts.total += 1;
    const fatal =
      verdict.verdict === "wrong" ||
      verdict.verdict === "masked-wrong-role" ||
      (verdict.required && verdict.verdict === "not-stated");
    if (fatal) {
      failures.push(
        `${verdict.kind}${verdict.kind === "motion" || verdict.kind === "result" ? "" : ` (${verdict.subject})`}: ${verdict.verdict} — ${verdict.reason}`,
      );
    }
  }
  return {
    meeting: fixture.meeting.id,
    fixtureFacts: fixture.facts.length,
    verdicts,
    counts,
    pass: failures.length === 0,
    failures,
  };
}

/** Reject an empty text file rather than scoring it as "everything not stated". */
export function assertStoryHasText(story: StoryText): StoryText {
  if (!story.headline.trim() && !story.dek.trim() && !story.body.trim()) {
    throw new Error("story text is empty");
  }
  return story;
}

/** One line per fact, for the CLI table. */
export function formatVerdicts(score: GoldenScore): string {
  const rows = score.verdicts.map((verdict) => [
    verdict.verdict,
    verdict.kind,
    verdict.required ? "yes" : "no",
    verdict.subject.length > 24 ? `${verdict.subject.slice(0, 23)}…` : verdict.subject,
    verdict.sentence ? `"${verdict.sentence.length > 96 ? `${verdict.sentence.slice(0, 95)}…` : verdict.sentence}"` : "—",
  ]);
  const header = ["VERDICT", "FACT", "REQ", "SUBJECT", "DECIDED BY"];
  const widths = header.map((label, index) =>
    Math.max(label.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}
