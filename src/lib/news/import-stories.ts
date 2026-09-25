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
  /**
   * The sources the report cited as documents rather than links, one per entry,
   * in its own words: `Sept 22 packet p. 819 (Tier A)`. A packet page or a
   * council recording has no URL, and the desk must not print a made-up one --
   * so these are carried as the text they are, beside the real links in
   * `links` (`provenanceFromCitations` files them that way).
   */
  citations: string[];
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
  /**
   * The paste with its display damage taken off (see `precleanMarkdown`). Every
   * card's text is a slice of this, and the verbatim check accepts a paragraph
   * found here or in the raw paste, so the two always agree.
   */
  cleanedText: string;
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

/**
 * The word it used for a story it wants dropped to a lower tier. Demote is not
 * the same request as Hold, but it is the same flag for the desk: a lead that
 * may not be published as it stands, and one the editor should look at first.
 */
const DEMOTE = /^demote$/i;

const LINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const LEADING_ORDINAL = /^(?:\d+|[ivxlc]+)[.)]\s+/i;

/**
 * Which part of a story a label names, in the words of whichever tool wrote it.
 *
 * The Codex scan writes `**Plain-language brief:**`; the very same scan run
 * inside Claude writes `**Plain-language version:**`, and writes `**Why it
 * matters for Longmont:**` where Codex writes `**Why it matters:**`. The editor
 * should not have to care which one they ran, so the synonyms live here in one
 * table: adding a wording is one line, and the list is read by
 * `labelGroupOf()` for every label in every report.
 *
 * `score` is its own group rather than a kind of note because that one line
 * carries the score and the verdict the desk files the lead under; the rest of
 * the notes group is editorial guidance that is never published.
 */
export type ImportLabelGroup = "score" | "brief" | "dek" | "notes" | "sources";

export const IMPORT_LABELS: { group: ImportLabelGroup; label: RegExp; why: string }[] = [
  { group: "score", label: /^(?:score|triage(?:\s+score)?)$/i, why: "the score line: score + verdict" },
  { group: "brief", label: /^plain[- ]language(?:\s+(?:brief|version|summary))?$/i, why: "plain-language brief" },
  { group: "dek", label: /^why (?:it|this) matters(?:\s+for\s+.+)?$/i, why: "why it matters" },
  {
    group: "notes",
    label: /^(?:reporter next step|next step|what would elevate|what elevates this|verification|editors?'? note)$/i,
    why: "editor guidance, never published",
  },
  {
    group: "sources",
    label: /^(?:official\s+)?sources?(?:\s+and\s+records)?$|^citations?$/i,
    why: "the report's own source list",
  },
];

/** Which part of a story this label names, or "" when the table does not know it. */
export function labelGroupOf(label: string): ImportLabelGroup | "" {
  const text = String(label ?? "")
    .trim()
    .replace(/[*_]+$/g, "")
    .trim();
  if (!text) return "";
  return IMPORT_LABELS.find((entry) => entry.label.test(text))?.group ?? "";
}

/**
 * A labelled run inside a paragraph: `**Score: 16/20**`, `**Why it matters:**`.
 *
 * Both shapes the exports use -- the label's value inside the bold and the value
 * after it -- and both in one document, which is why this splits a paragraph
 * rather than matching a whole one. A Claude lead carries two labels inside a
 * single paragraph (`… **What would elevate:** … **Plain language:** …`), and a
 * bold phrase that is not a label (`**Water Fund:** $51.01 million`) matches
 * nothing here and stays in the body, exactly as the editor wrote it.
 */
const LABEL_RUN = /\*\*\s*([A-Za-z][^*:\n]{0,40}?)\s*:\s*([^*\n]*?)\s*\*\*/g;

/**
 * The report's own source list, as its own paragraph: `*Sources: Sept 22 packet
 * p. 819 (Tier A); …*`, `**Official sources:** …`, `Citations: …`.
 *
 * Italic rather than bold, which is why it is matched here and not by
 * `LABEL_RUN`; anchored at the start of the paragraph, so a sentence that merely
 * mentions the word cannot become the source list.
 */
const SOURCES_LINE = /^\s*[*_]{0,2}\s*((?:official\s+)?sources?(?:\s+and\s+records)?|citations?)\s*:\s*[*_]{0,2}\s*([\s\S]*?)\s*[*_]{0,6}\s*$/i;

const NAMED_SECTION = /^\*\*(?:Date|Scan date|Run|Mode|Status|Verification boundary):\*\*/i;

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

/**
 * A URL the report pasted without its scheme: `youtube.com/watch?v=jhsFsEz0P5A`,
 * `longmont.primegov.com/api/v2/PublicPortal/ListArchivedMeetings`.
 *
 * The reports cite bare domains in running text and in source-access tables, and
 * an editor who wants the recording should get a link they can click. The
 * boundary group is what keeps this off a URL that is already inside a markdown
 * link (`](https://…` puts `/` before the host, which is not a boundary), and the
 * scheme is added, never guessed: the host is what the report wrote.
 */
const BARE_URL_RE =
  /(?:^|[\s([|,])((?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|io|ai|us|co|info|biz|dev)(?:\/[^\s)\]"'<>]*)?)/gi;

/** The markdown links and the bare domains in a stretch of text. */
export function extractLinks(text: string): ImportLink[] {
  const body = String(text ?? "");
  const found: ImportLink[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(LINK_RE)) {
    const url = match[2]!;
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ text: (match[1] || url).trim(), url });
  }
  for (const match of body.matchAll(BARE_URL_RE)) {
    const host = match[1]!.replace(/[.,;:]+$/, "");
    const url = `https://${host}`;
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({ text: host, url });
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

/* ------------------------------------------------------------------ *
 * Labels: what the report called each part, and where it said it.
 * ------------------------------------------------------------------ */

type LabelledPiece = { group: ImportLabelGroup | ""; text: string };

/**
 * One paragraph, split at every label the table knows -- in order, words
 * untouched. A paragraph with no known label comes back whole.
 *
 * The label's own value belongs to the label either way: `**Score: 16/20**` and
 * `**Score:** 17/20` both leave the score as the first thing after the label.
 */
export function splitLabelled(paragraph: string): LabelledPiece[] {
  const text = String(paragraph ?? "");
  const runs: { start: number; end: number; group: ImportLabelGroup; value: string }[] = [];
  for (const match of text.matchAll(LABEL_RUN)) {
    const group = labelGroupOf(match[1]!);
    // An unknown bold label is the editor's own words: it stays where it is.
    if (!group) continue;
    runs.push({
      start: match.index!,
      end: match.index! + match[0].length,
      group,
      value: (match[2] ?? "").trim(),
    });
  }
  const first = runs[0];
  if (!first) return [{ group: "", text }];

  const pieces: LabelledPiece[] = [];
  const head = text.slice(0, first.start).trim();
  if (head) pieces.push({ group: "", text: head });
  runs.forEach((run, index) => {
    const until = index + 1 < runs.length ? runs[index + 1]!.start : text.length;
    const after = text.slice(run.end, until).trim();
    pieces.push({ group: run.group, text: [run.value, after].filter(Boolean).join(" ") });
  });
  return pieces;
}

/** The text of a paragraph that is the report's own `Sources:` list, or "". */
export function sourcesLineOf(paragraph: string): string {
  const match = SOURCES_LINE.exec(String(paragraph ?? ""));
  return match ? (match[2] ?? "").trim() : "";
}

/**
 * The entries in a sources line, one per `;`, each with its trailing full stop
 * taken off. They are the report's own words: a citation of a packet page or a
 * recording has no URL to invent, and nothing here guesses one.
 */
export function citationsFromText(text: string): string[] {
  return String(text ?? "")
    .split(";")
    .map((part) => part.trim().replace(/[.\s]+$/, "").trim())
    .filter(Boolean);
}

const TRIAGE_BOLD = /\*\*\s*(advance|hold|demote|kill|suppress|skip|watch|monitor)\s*\*\*/i;
const TRIAGE_BARE = /\b(advance|hold|demote|kill|suppress)\b/i;

/** The report's verdict word, in the casing the desk shows it: "Advance", "Hold". */
export function triageWordOf(text: string): string {
  const raw = String(text ?? "");
  const word = TRIAGE_BOLD.exec(raw)?.[1] ?? TRIAGE_BARE.exec(raw)?.[1] ?? "";
  if (!word) return "";
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** `## LEADS (HOLD)` / `## HOLD` — a section that states its verdict in its name. */
const SECTION_VERDICT = /^(?:leads?|stories|items|cards?)?\s*\(?\s*(advance|hold|demote|kill|suppress|skip)\s*\)?\s*$/i;

/** The verdict a section's name states, or "". Deliberately strict: only a
 *  section whose *whole* name is the verdict, so "Signals and watch list" is
 *  a section of the report and not a Watch on every lead under it. */
export function sectionVerdictOf(heading: string): string {
  const word = SECTION_VERDICT.exec(cleanHeadingText(String(heading ?? "")))?.[1] ?? "";
  if (!word) return "";
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** The `(9/20: …)` code a report puts on a heading, by the heading's own words. */
function headingScoreCodes(text: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line);
    if (!heading) continue;
    // The bold around the heading comes off first: the code sits inside it.
    const raw = unescapeMarkdown(heading[2]!.trim())
      .replace(/[*_]+$/, "")
      .trim();
    const code = /\(\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*:[^)]*\)\s*$/.exec(raw);
    if (!code) continue;
    codes.set(cleanHeadingText(heading[2]!), `${code[1]}/${code[2]}`);
  }
  return codes;
}

/* ------------------------------------------------------------------ *
 * Pre-clean: the display damage a markdown export leaves behind.
 * ------------------------------------------------------------------ */

/**
 * A backslash before any ASCII punctuation — `\$`, `\#`, `\.`, `\&`, `\(`.
 *
 * Markdown lets an author escape a punctuation mark so it prints as itself, and
 * a Google Docs export escapes far more than it needs to. To a reader `\$4.5
 * million` and `$4.5 million` are the same three words; only one of them is what
 * the editor wants on a page. Removing the backslash, and nothing else, is the
 * whole of this step.
 */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/**
 * A bold the export escaped on one side only: `\*\*$4,513,469**`.
 *
 * Google Docs writes this when it loses track of where the emphasis started.
 * Repaired here, before the general unescape, so the marks go without the text
 * between them being touched. Deliberately narrow — `**bold**` written on
 * purpose inside a paragraph is left exactly as the editor wrote it.
 */
const ESCAPED_BOLD_OPEN = /\\\*\\\*([^\n]+?)\*\*/g;
const ESCAPED_BOLD_CLOSE = /\*\*([^\n]+?)\\\*\\\*/g;

/** The report's own filing label on a heading: `LEAD 12:`, `Story 3.`, `Item 4 —`. */
const HEADING_FILING_LABEL = /^(?:LEAD|STORY|ITEM)\s*\d+\s*[:.)—-]\s*/i;

/** The report's triage arithmetic, appended to some headings: `(9/20: I3 Im1 C3 N2)`. */
const HEADING_SCORE_CODE = /\s*\(\s*\d+(?:\.\d+)?\s*\/\s*\d+\s*:[^)]*\)\s*$/;

/** A heading wrapped in `**bold**`, `*italic*` or `***both***`. */
const WRAPPED_EMPHASIS = /^([*_]{1,3})([\s\S]+?)\1$/;

/** A horizontal rule: `---`, `***`, `___`. It separates cards; it is not text. */
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/;

function unescapeMarkdown(line: string): string {
  return line
    .replace(ESCAPED_BOLD_OPEN, "$1")
    .replace(ESCAPED_BOLD_CLOSE, "$1")
    .replace(MARKDOWN_ESCAPE, "$1");
}

/**
 * A heading's own words, with the markup, the filing label and the score code
 * taken off — never anything else. `### **LEAD 12: Hangar lease … (9/20: I3 Im1
 * C3 N2)**` becomes `Hangar lease …`.
 */
function cleanHeadingText(heading: string): string {
  let text = unescapeMarkdown(String(heading ?? "").trim()).trim();
  const wrapped = WRAPPED_EMPHASIS.exec(text);
  if (wrapped) text = wrapped[2]!.trim();
  text = stripOrdinal(text);
  text = text.replace(HEADING_FILING_LABEL, "").trim();
  text = text.replace(HEADING_SCORE_CODE, "").trim();
  return text;
}

/**
 * Take the display damage off a pasted report: escapes, bold and italic around
 * headings, the report's `LEAD n:` filing labels and `(9/20: …)` score codes,
 * and its `---` rules.
 *
 * **Structure and display only — never words.** A line comes out of here either
 * the same line or with punctuation marks removed around words that stay in
 * place, in order, one line per line. That is what lets the review screen show
 * a clean headline while the verbatim check still compares a body paragraph
 * against the editor's own paste.
 *
 * The reports Unit X already reads have no escapes, no bold headings and no
 * rules, so on those this is a no-op and their reading is unchanged.
 */
export function precleanMarkdown(text: string): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (HORIZONTAL_RULE.test(line)) {
      out.push("");
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      out.push(`${heading[1]} ${cleanHeadingText(heading[2]!)}`);
      continue;
    }
    out.push(unescapeMarkdown(line));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * True when `paragraph` is in the paste as the editor typed it, or in the paste
 * with its display damage removed. The two readings of the same paste: a
 * paragraph the reader cleaned is still the editor's own text, word for word.
 */
export function containsVerbatimEither(input: string, paragraph: string): boolean {
  return containsVerbatim(input, paragraph) || containsVerbatim(precleanMarkdown(input), paragraph);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  deg: "°",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const named = ENTITIES[body.toLowerCase()];
    if (named) return named;
    if (body[0] === "#") {
      const code = body[1]!.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
    }
    return whole;
  });
}

/**
 * A saved web page as text, before anything reads it.
 *
 * The file path accepts `.html`, and raw markup fed to the reader would be
 * worse than useless: `<h3>` is exactly the structure `parseStructure` looks
 * for, and a tag soup has none. So the page is turned into the markdown the
 * reader already understands — headings become `#`…`######`, list items become
 * `-` lines, `<br>` and the block-closing tags become paragraph breaks — and
 * script, style and the page's own `<title>` are dropped rather than imported
 * as text nobody wrote for the story. Anything still in angle brackets is
 * removed, so no markup reaches the body of an imported story.
 *
 * Deliberately not a general-purpose HTML parser: it reads the shape a saved
 * report has, and a page whose text only appears inside a script or a nested
 * table will come out with less than a browser would show. The review screen is
 * where an editor sees that before anything is saved.
 */
export function htmlToText(html: string): string {
  const text = String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|ul|ol|tr|table|section|article|blockquote|pre)\s*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/** A labelled part, appended when a report states the same part twice. */
function joinPart(previous: string, text: string): string {
  return previous ? `${previous}\n\n${text}` : text;
}

function partsOf(paragraphs: string[]) {
  const out = {
    score: "",
    scoreLine: "",
    triage: "",
    why: "",
    brief: "",
    next: "",
    sources: "",
    body: [] as string[],
  };
  for (const paragraph of paragraphs) {
    const sources = sourcesLineOf(paragraph);
    if (sources) {
      out.sources = joinPart(out.sources, sources);
      continue;
    }
    for (const piece of splitLabelled(paragraph)) {
      switch (piece.group) {
        case "":
          out.body.push(piece.text);
          break;
        case "score":
          out.scoreLine = paragraph;
          out.score ||= piece.text.split(/[·|]/)[0]!.trim();
          out.triage ||= triageWordOf(paragraph);
          break;
        case "dek":
          out.why = joinPart(out.why, piece.text);
          break;
        case "brief":
          out.brief = joinPart(out.brief, piece.text);
          break;
        case "notes":
          out.next = joinPart(out.next, piece.text);
          break;
        case "sources":
          out.sources = joinPart(out.sources, piece.text);
          break;
      }
    }
  }
  return { ...out, citations: citationsFromText(out.sources) };
}

function makeStory(input: {
  key: string;
  order: number;
  headline: string;
  isStory: boolean;
  raw: string;
  paragraphs: string[];
  disclosureKey: DisclosureKey;
  /** The `(9/20: …)` code off the heading, when the lead states no score of its own. */
  scoreCode?: string;
  /** The verdict the section above the lead states, when the lead states none. */
  sectionVerdict?: string;
}): ImportedStory {
  const parts = partsOf(input.paragraphs);
  const triage = (parts.triage || input.sectionVerdict || "").trim();
  return {
    key: input.key,
    order: input.order,
    headline: input.headline,
    isStory: input.isStory,
    score: parts.score || input.scoreCode || "",
    triage,
    holds: HOLD.test(triage) || DEMOTE.test(triage),
    dek: parts.why,
    body: parts.body.join("\n\n"),
    plainBrief: parts.brief,
    reporterNextStep: parts.next,
    scoreLine: parts.scoreLine,
    citations: parts.citations,
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

/**
 * Does this block carry the labelled parts a story has -- a score line, a dek,
 * a brief, a next step?
 *
 * A sources line deliberately does not count. Both reports have sections that
 * name their own source in prose (`## COVERAGE LEDGER: … **Source:** official
 * recording …`) and none of them is a story; a section with a citation list and
 * no claim of its own is a record of the scan, which is what the desk already
 * shows it as.
 */
function looksLikeStory(text: string): boolean {
  return splitParagraphs(text).some((p) =>
    splitLabelled(p).some((piece) => piece.group !== "" && piece.group !== "sources"),
  );
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
  const blocks = splitBlocks(precleanMarkdown(text));
  // The `(9/20: I3 Im1 C3 N2)` codes come off the headings before pre-cleaning
  // strips them, so a lead that carries no score line of its own -- every HOLD
  // lead in the Claude report -- still shows the score the report gave it.
  const scoreCodes = headingScoreCodes(text);
  const stories: ImportedStory[] = [];
  const disclosureKey = opts.disclosureKey ?? "outside-ai";
  let sectionVerdict = "";

  const push = (headline: string, isStory: boolean, raw: string, bodyText: string, verdict: string) => {
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
        scoreCode: scoreCodes.get(headline) ?? "",
        sectionVerdict: verdict,
      }),
    );
  };

  for (const block of blocks) {
    if (block.level < 2) continue;
    // A section states the verdict for the leads under it: "## LEADS (HOLD)".
    // The section card carries it too, so the card itself shows the flag.
    if (block.level === 2) sectionVerdict = sectionVerdictOf(block.heading);
    const isStory = block.level === 3 || looksLikeStory(block.text);
    push(block.heading, isStory, [block.heading, block.text].join("\n\n"), block.text, sectionVerdict);
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
  const cleaned = precleanMarkdown(text);
  const paragraphs = splitParagraphs(cleaned);
  if (paragraphs.length < 2) return null;
  const first = paragraphs[0]!;
  if (first.includes("\n")) return null;
  const headline = first.replace(/^#+\s*/, "").trim();
  if (!headline || headline.length > IMPORT_LIMITS.headline) return null;
  if (/[.!?:;,]$/.test(headline)) return null;
  if (headline.split(/\s+/).length > 25) return null;

  const rest = paragraphs.slice(1);
  const sourcesParagraph = rest.findIndex((p) => sourcesLineOf(p) !== "");
  if (sourcesParagraph === 0) return null;

  // The whole remainder goes in: the reader takes the `Sources:` paragraph out
  // of the body itself (`sourcesLineOf`), so a plain story's cited documents
  // land in `citations` instead of being dropped on the way here.
  return makeStory({
    key: "s1",
    order: 1,
    headline,
    isStory: true,
    raw: text,
    paragraphs: rest,
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
  const cleaned = precleanMarkdown(raw);
  const blocks = splitBlocks(cleaned);
  const titleBlock = blocks.find((b) => b.level === 1);
  const title = titleBlock?.heading ?? "";
  const headerParagraphs = splitParagraphs(titleBlock?.text ?? "");
  const scanDate =
    headerParagraphs.find((p) => /^\*\*Scan date:\*\*/i.test(p)) ??
    headerParagraphs.find((p) => NAMED_SECTION.test(p)) ??
    "";
  // The paste as the reader cleaned it: the report's own rules dropped, its
  // escapes gone, the filing labels and score codes off the headings.

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
      cleanedText: cleaned,
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
      cleanedText: cleaned,
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
    cleanedText: cleaned,
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
      (paragraph) => !containsVerbatimEither(input, paragraph),
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
 * The one wording the review screen shows for a story that was not split
 * cleanly. The specific reason ("the model changed wording ...") is appended to
 * it rather than replacing it, so the flag is always recognisable on the card.
 */
export const CLEAN_SPLIT_FLAG = "Could not split this cleanly — check it.";

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
  const reason = opts.reason?.trim() ?? "";
  story.cleanSplit = false;
  story.warning = reason.includes(CLEAN_SPLIT_FLAG)
    ? reason
    : [CLEAN_SPLIT_FLAG, reason].filter(Boolean).join(" ");
  return story;
}

/** True when `body` is the exact text of the story's own paragraphs. */
export function bodyIsVerbatim(input: string, story: ImportedStory): boolean {
  const paragraphs = splitParagraphs(story.body);
  return paragraphs.length > 0 && paragraphs.every((p) => containsVerbatimEither(input, p));
}
