/**
 * Reading finished stories out of a pasted report.
 *
 * The owner's need, 2026-09-24: "I should be able to just dump something like
 * that into the desk somewhere and it should be smart enough to read it all,
 * parse out the stories, headline them and paste the body of the story and the
 * claims/sources links in the right place in the story and put it in the queue.
 * I DO NOT want to run AI's multiple times to find stories."
 *
 * Two rules shape this file.
 *
 * 1. PARSE, NEVER REWRITE. Every body paragraph, dek and brief this module
 *    returns is a byte-for-byte slice of the input. Nothing is summarised,
 *    reordered, re-cased or joined. `containsVerbatim()` is the check that
 *    enforces it, and it is applied to the model's reply too, so a model that
 *    "tidies" a sentence has its whole split rejected rather than published.
 *
 * 2. DETERMINISTIC FIRST. A report with headings and labelled parts is read
 *    with no model call at all -- `parseFinishedStories()` returns
 *    `method: "structured"`, and the caller must not reach for a model when it
 *    sees that. A model is asked ONLY for structure (which paragraphs belong to
 *    which story), never for prose, and only when the text carries no usable
 *    structure of its own.
 *
 * Kept client-safe (no db import) so the review screen can re-parse a paste
 * without a round trip and so this can be unit tested on its own, in the style
 * of `write-story.ts`.
 */

import { topicFromText } from "./desk-copy.ts";

export type ImportLink = { text: string; url: string };

export type ImportedStory = {
  /** Stable within one parse: "s1".."sN" for stories, "n1".."nN" for the rest. */
  key: string;
  order: number;
  headline: string;
  /** False for a section of the report that is not a story (brief says: default OFF). */
  isStory: boolean;
  score: string;
  triage: string;
  /** True when the triage word is "Hold" — imports with a visible Hold flag. */
  holds: boolean;
  /** `**Why it matters:**` */
  dek: string;
  /** The body paragraphs, exactly as written. */
  body: string;
  /** `**Plain-language brief:**` */
  plainBrief: string;
  /** `**Reporter next step:**` — editor notes, never published. */
  reporterNextStep: string;
  /** The line naming the official sources, exactly as written ("" when absent). */
  scoreLine: string;
  /** Every link in the block, deduped by URL, in the order they appear. */
  links: ImportLink[];
  /** The whole block as it arrived — what "the text is kept exactly as written" means. */
  raw: string;
  /** A section suggestion from the same topic chooser the write box uses. */
  sectionSuggestion: string;
  /** Default disclosure wording; the editor can change it on the review screen. */
  disclosureKey: DisclosureKey;
  /**
   * False when this story came from the fallback path and could not be split
   * cleanly — the review screen must show "could not split this cleanly — check it".
   */
  cleanSplit: boolean;
  warning: string;
};

export type ParsedReport = {
  /** The document's own title (`# ...`), or "" when it has none. */
  title: string;
  /** The `**Scan date:**` line when the source tool wrote one. */
  scanDate: string;
  /**
   * Front matter that is not a story and that the brief does not want a card
   * for (title, scan line, intro/methodology, verification boundary). Shown
   * muted above the cards, never imported and never silently dropped.
   */
  headerNote: string;
  /** Name of the tool that produced the report, when the title names one. */
  detectedTool: string;
  stories: ImportedStory[];
  method: "structured" | "plain" | "none";
  warnings: string[];
};

export type DisclosureKey = "outside-ai" | "person" | "other";

export const IMPORT_DISCLOSURES: { key: DisclosureKey; label: string; line: string }[] = [
  {
    key: "outside-ai",
    label: "An outside AI tool",
    line: "An outside AI research tool wrote this from public records; an editor reviewed it.",
  },
  {
    key: "person",
    label: "A person",
    line: "A person wrote this from public records; an editor reviewed it.",
  },
  { key: "other", label: "Other wording", line: "" },
];

export function disclosureLine(key: DisclosureKey, other = ""): string {
  if (key === "other") return other.trim();
  return IMPORT_DISCLOSURES.find((d) => d.key === key)?.line ?? "";
}

/** The word the source tool used for a story it wants held. */
const HOLD = /^hold$/i;

const LINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const LEADING_ORDINAL = /^(?:\d+|[ivxlc]+)[.)]\s+/i;

const LABEL = {
  score: /^\*\*Score:\*\*\s*/i,
  why: /^\*\*Why it matters:\*\*\s*/i,
  brief: /^\*\*Plain-language brief:\*\*\s*/i,
  next: /^\*\*Reporter next step:\*\*\s*/i,
};

/** Any paragraph that opens with a `**Label:**` the report format defines. */
const ANY_PART_LABEL = /^\*\*(?:Score|Why it matters|Plain-language brief|Reporter next step):\*\*/i;

const NAMED_SECTION = /^\*\*(?:Scan date|Run|Mode|Status|Verification boundary):\*\*/i;

const TRIAGE_WORD = /\*\*(Advance|Hold|Skip|Watch|Monitor)\*\*/i;

export const IMPORT_LIMITS = { text: 400_000, headline: 180, stories: 200 };

/**
 * Whitespace-normalised text, for comparing two copies of the same sentence.
 * Newlines, tabs and runs of spaces collapse to one space; leading and trailing
 * space goes. Nothing else is touched — no punctuation, no case, no words.
 */
export function normalizeForVerbatim(text: string): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `paragraph` appears in `input` as written.
 *
 * Deliberately a containment check on whitespace-normalised text and nothing
 * cleverer: re-wrapping a paragraph across lines is not a rewrite, but changing,
 * adding or dropping even one word is. An empty paragraph is not "contained" —
 * it is nothing, and every caller treats nothing as a failure.
 */
export function containsVerbatim(input: string, paragraph: string): boolean {
  const needle = normalizeForVerbatim(paragraph);
  if (!needle) return false;
  return normalizeForVerbatim(input).includes(needle);
}

/** Every markdown link in a stretch of text, deduped by URL, in order. */
export function extractLinks(text: string): ImportLink[] {
  const found: ImportLink[] = [];
  const seen = new Set<string>();
  for (const match of String(text ?? "").matchAll(LINK_RE)) {
    const url = match[2]!;
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ text: (match[1] || url).trim(), url });
  }
  return found;
}

/** Split on blank lines. Paragraphs keep their internal line breaks exactly. */
export function splitParagraphs(text: string): string[] {
  return String(text ?? "")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** `### 1. Some headline` -> `Some headline`. The heading number is not part of it. */
export function stripOrdinal(heading: string): string {
  const text = String(heading ?? "").trim();
  const stripped = text.replace(LEADING_ORDINAL, "").trim();
  return stripped || text;
}

type RawBlock = { level: number; heading: string; text: string };

function splitBlocks(text: string): RawBlock[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: RawBlock[] = [];
  let current: RawBlock = { level: 0, heading: "", text: "" };
  const push = () => {
    if (current.heading || current.text.trim()) blocks.push(current);
  };
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      push();
      current = { level: heading[1]!.length, heading: heading[2]!.trim(), text: "" };
      continue;
    }
    current.text += (current.text ? "\n" : "") + line;
  }
  push();
  return blocks;
}

function partsOf(paragraphs: string[]) {
  const out = {
    score: "",
    scoreLine: "",
    triage: "",
    why: "",
    brief: "",
    next: "",
    body: [] as string[],
  };
  for (const paragraph of paragraphs) {
    if (LABEL.score.test(paragraph)) {
      out.scoreLine = paragraph;
      out.score = (paragraph.replace(LABEL.score, "").split("·")[0] ?? "").trim();
      out.triage = TRIAGE_WORD.exec(paragraph)?.[1] ?? "";
      continue;
    }
    if (LABEL.why.test(paragraph)) {
      out.why = paragraph.replace(LABEL.why, "").trim();
      continue;
    }
    if (LABEL.brief.test(paragraph)) {
      out.brief = paragraph.replace(LABEL.brief, "").trim();
      continue;
    }
    if (LABEL.next.test(paragraph)) {
      out.next = paragraph.replace(LABEL.next, "").trim();
      continue;
    }
    out.body.push(paragraph);
  }
  return out;
}

function makeStory(input: {
  key: string;
  order: number;
  headline: string;
  isStory: boolean;
  raw: string;
  paragraphs: string[];
  disclosureKey: DisclosureKey;
}): ImportedStory {
  const parts = partsOf(input.paragraphs);
  const triage = (parts.triage || "").trim();
  return {
    key: input.key,
    order: input.order,
    headline: input.headline,
    isStory: input.isStory,
    score: parts.score,
    triage,
    holds: HOLD.test(triage),
    dek: parts.why,
    body: parts.body.join("\n\n"),
    plainBrief: parts.brief,
    reporterNextStep: parts.next,
    scoreLine: parts.scoreLine,
    links: extractLinks(input.raw),
    raw: input.raw,
    sectionSuggestion: topicFromText(
      [input.headline, parts.why, parts.body.join(" ")].join("\n"),
    ),
    disclosureKey: input.disclosureKey,
    cleanSplit: true,
    warning: "",
  };
}

/** Does this block carry any of the report format's labelled parts? */
function looksLikeStory(text: string): boolean {
  return splitParagraphs(text).some((p) => ANY_PART_LABEL.test(p));
}

/**
 * Read a report that has its own structure. No model is consulted.
 *
 * Every heading below the title is one card. That is the rule the real
 * civic-scanner report needs: its `##` sections — "Beat context and source
 * access", "Signals and watch list", "Upcoming dates to monitor" — are sections
 * of the report rather than stories, and its `### 1.`–`### 7.` blocks are the
 * seven stories, giving the seven story cards and three non-story cards the
 * desk is meant to show. Nothing is nested away.
 *
 * Inside a block the labelled parts are recognised — the Score/Triage line, the
 * official-source line, `**Why it matters:**`, `**Plain-language brief:**`,
 * `**Reporter next step:**` — and every other paragraph is body, kept verbatim.
 * A `##` block carrying none of those parts is not a story: it is recognised as
 * a section of the report, left unticked by default, and its own text is still
 * kept on the card so an editor who disagrees can import it.
 *
 * The heading itself never becomes a body paragraph — it becomes the headline.
 */
export function parseStructure(text: string, opts: { disclosureKey?: DisclosureKey } = {}): ImportedStory[] {
  const blocks = splitBlocks(text);
  const stories: ImportedStory[] = [];
  const disclosureKey = opts.disclosureKey ?? "outside-ai";

  const push = (headline: string, isStory: boolean, raw: string, bodyText: string) => {
    const paragraphs = splitParagraphs(bodyText);
    stories.push(
      makeStory({
        key: isStory ? `s${stories.length + 1}` : `n${stories.length + 1}`,
        order: stories.length + 1,
        headline: stripOrdinal(headline),
        isStory,
        // `raw` keeps the heading so the story's links are complete; the body
        // paragraphs come from `bodyText`, so the heading never lands in body.
        raw,
        paragraphs,
        disclosureKey,
      }),
    );
  };

  for (const block of blocks) {
    if (block.level < 2) continue;
    const isStory = block.level === 3 || looksLikeStory(block.text);
    push(block.heading, isStory, [block.heading, block.text].join("\n\n"), block.text);
  }
  return stories;
}

/**
 * A single finished story pasted on its own: headline on the first line, then
 * paragraphs, then a `Sources:` list. No markdown headings involved.
 *
 * Returns null unless the shape is actually there — a first line that reads as
 * a headline and at least one paragraph under it. A wall of text with no
 * headline falls through to the caller, which may ask a model for structure.
 */
export function parsePlainStory(
  text: string,
  opts: { disclosureKey?: DisclosureKey } = {},
): ImportedStory | null {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length < 2) return null;
  const first = paragraphs[0]!;
  if (first.includes("\n")) return null;
  const headline = first.replace(/^#+\s*/, "").trim();
  if (!headline || headline.length > IMPORT_LIMITS.headline) return null;
  if (/[.!?:;,]$/.test(headline)) return null;
  if (headline.split(/\s+/).length > 25) return null;

  const rest = paragraphs.slice(1);
  const sourcesParagraph = rest.findIndex((p) =>
    /^\s*\*{0,2}Sources?(?:\s+and\s+records)?\s*:?\*{0,2}\s*$/i.test(p) ||
    /^\s*\*{0,2}Sources?(?:\s+and\s+records)?\s*:?\*{0,2}\s+\S/i.test(p),
  );
  const bodyParagraphs = sourcesParagraph >= 0 ? rest.slice(0, sourcesParagraph) : rest;
  if (bodyParagraphs.length === 0) return null;

  return makeStory({
    key: "s1",
    order: 1,
    headline,
    isStory: true,
    raw: text,
    paragraphs: bodyParagraphs,
    disclosureKey: opts.disclosureKey ?? "person",
  });
}

/** The tool named in the document's title, e.g. "Civic Source Scanner". */
export function detectedToolFromTitle(title: string): string {
  const text = String(title ?? "").trim();
  if (!text) return "";
  const cut = text.split(/\s+[—–-]\s+/)[0] ?? text;
  return cut.trim().slice(0, 80);
}

/**
 * Read a pasted report. Deterministic: this never calls a model.
 *
 * `method` tells the caller what happened, and the caller is expected to act on
 * it: "structured" and "plain" mean the stories were found and no model may be
 * asked; "none" means the text has no usable structure and the caller may make
 * ONE structure-only model call.
 */
export function parseFinishedStories(
  text: string,
  opts: { disclosureKey?: DisclosureKey } = {},
): ParsedReport {
  const raw = String(text ?? "");
  const blocks = splitBlocks(raw);
  const titleBlock = blocks.find((b) => b.level === 1);
  const title = titleBlock?.heading ?? "";
  const headerParagraphs = splitParagraphs(titleBlock?.text ?? "");
  const scanDate =
    headerParagraphs.find((p) => /^\*\*Scan date:\*\*/i.test(p)) ??
    headerParagraphs.find((p) => NAMED_SECTION.test(p)) ??
    "";
  // The title is reported separately, so it is not repeated in here.
  const headerNote = [
    scanDate,
    ...headerParagraphs.filter((p) => p !== scanDate),
  ]
    .filter(Boolean)
    .join("\n\n");
  const detectedTool = detectedToolFromTitle(title);

  const structured = parseStructure(raw, opts);
  if (structured.length > 0) {
    return {
      title,
      scanDate,
      headerNote,
      detectedTool,
      stories: structured,
      method: "structured",
      warnings: [],
    };
  }

  const plain = parsePlainStory(raw, opts);
  if (plain) {
    return {
      title,
      scanDate: "",
      headerNote,
      detectedTool,
      stories: [plain],
      method: "plain",
      warnings: [],
    };
  }

  return {
    title,
    scanDate,
    headerNote,
    detectedTool,
    stories: [],
    method: "none",
    warnings: ["This text has no headings to read."],
  };
}

/* ------------------------------------------------------------------ *
 * The one model call: structure only, checked word for word.
 * ------------------------------------------------------------------ */

export const STRUCTURE_SYSTEM = [
  "You are reading a finished news report and returning its STRUCTURE only.",
  "You must never write, rewrite, summarise, shorten or correct any sentence.",
  "Return ONLY JSON in this shape:",
  '{"stories":[{"headline":"...","body":["paragraph","paragraph"],"dek":"","notes":""}]}',
  "Rules:",
  "- Each story's headline is copied from the text, or written as a short label if the text has none.",
  "- Every string in body MUST be an exact copy of a paragraph in the input, character for character.",
  "- Put a summary paragraph that the report labelled as such in dek, not in body.",
  "- notes is for editorial guidance (scores, triage, next steps), never published.",
  "- Do not return a story for a section that is only context, a watch list or a calendar.",
  "- Return ONLY JSON.",
].join("\n");

export function structureUserPrompt(text: string): string {
  return ["Here is the report. Return its structure as JSON.", "", String(text ?? "")].join("\n");
}

type ModelStory = { headline?: unknown; body?: unknown; dek?: unknown; notes?: unknown };

/**
 * Turn a model's structure reply into stories, checking every sentence.
 *
 * A story is accepted only when each of its body and dek paragraphs appears in
 * the input as written (`containsVerbatim`). A reply that alters one sentence
 * fails the check for that story, and the caller falls back to the
 * deterministic split with a visible flag — never to the model's wording.
 */
export function verifyModelSplit(
  input: string,
  reply: unknown,
  opts: { disclosureKey?: DisclosureKey } = {},
): { stories: ImportedStory[]; rejected: number; reason: string } {
  const raw = reply as { stories?: unknown } | null;
  const list = Array.isArray(raw?.stories) ? (raw!.stories as ModelStory[]) : [];
  if (list.length === 0) {
    return { stories: [], rejected: 0, reason: "The model did not find any stories in this text." };
  }
  const stories: ImportedStory[] = [];
  let rejected = 0;
  let reason = "";
  for (const candidate of list) {
    const headline = String(candidate?.headline ?? "").trim().slice(0, IMPORT_LIMITS.headline);
    const bodyParagraphs = (Array.isArray(candidate?.body) ? candidate.body : [])
      .map((p) => String(p ?? "").trim())
      .filter(Boolean);
    const dek = String(candidate?.dek ?? "").trim();
    const notes = String(candidate?.notes ?? "").trim();
    if (!headline || bodyParagraphs.length === 0) {
      rejected += 1;
      reason ||= "The model returned a story with no headline or no body.";
      continue;
    }
    const altered = [...bodyParagraphs, ...(dek ? [dek] : [])].filter(
      (paragraph) => !containsVerbatim(input, paragraph),
    );
    if (altered.length > 0) {
      rejected += 1;
      reason ||= `The model changed wording that is not in your text: “${altered[0]!.slice(0, 120)}”`;
      continue;
    }
    stories.push(
      makeStory({
        key: `s${stories.length + 1}`,
        order: stories.length + 1,
        headline,
        isStory: true,
        raw: [headline, ...bodyParagraphs, dek, notes].filter(Boolean).join("\n\n"),
        paragraphs: bodyParagraphs,
        disclosureKey: opts.disclosureKey ?? "outside-ai",
      }),
    );
  }
  return { stories, rejected, reason };
}

/**
 * The fallback when a model split is rejected or the text has no structure at
 * all: one story holding the whole paste, flagged so the editor can see it was
 * not split cleanly. Nothing is invented and nothing is dropped.
 */
export function fallbackSingleStory(
  text: string,
  opts: { disclosureKey?: DisclosureKey; reason?: string } = {},
): ImportedStory {
  const paragraphs = splitParagraphs(text);
  const story = makeStory({
    key: "s1",
    order: 1,
    headline: "Imported text — give this a headline",
    isStory: true,
    raw: String(text ?? ""),
    paragraphs,
    disclosureKey: opts.disclosureKey ?? "outside-ai",
  });
  story.cleanSplit = false;
  story.warning = opts.reason?.trim() || "Could not split this cleanly — check it.";
  return story;
}

/** True when `body` is the exact text of the story's own paragraphs. */
export function bodyIsVerbatim(input: string, story: ImportedStory): boolean {
  const paragraphs = splitParagraphs(story.body);
  return paragraphs.length > 0 && paragraphs.every((p) => containsVerbatim(input, p));
}
