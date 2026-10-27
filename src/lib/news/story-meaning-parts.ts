/**
 * How a published story or an uploaded file is cut into the pieces that get a
 * meaning vector (DEF-1). Pure text in, pieces out -- no database, no model --
 * so the fill and the search cut the same text the same way. The search needs
 * that: it stores no text, and to show which part of an uploaded file matched
 * it cuts the file again and takes the part by number.
 *
 * Changing a number below changes where parts fall for text already embedded;
 * the stored `source_md5` is of the whole text, not of the cut, so bump
 * `PARTS_VERSION` and the fill re-embeds everything on its own.
 */

/** Part sizes, in characters. The model clips at 2,000 and reads ~1,000 well. */
const BODY_PART_TARGET = 900;
const BODY_PART_MAX = 1_200;
const DOCUMENT_PART_TARGET = 1_000;
const DOCUMENT_PART_MAX = 1_400;
/** A story longer than this is cut off: the opening parts say what it is about. */
export const ARTICLE_BODY_PARTS_MAX = 40;
/** About 150,000 characters (a 60-page report). Later pages are not searched. */
export const DOCUMENT_PARTS_MAX = 150;
/** Shorter than this is not worth a vector. */
const MIN_PART_CHARS = 20;

/** Folded into the stored fingerprint so a new cut re-embeds old rows. */
export const PARTS_VERSION = "p1";

/** Text that is mostly control characters is a failed read, not words. */
function looksBroken(text: string): boolean {
  if (text.length === 0) return true;
  // eslint-disable-next-line no-control-regex
  const bad = text.match(/[\u0001-\u0008\u000b\u000e-\u001f�]/g);
  return (bad?.length ?? 0) >= 0.02 * text.length;
}

/** Cut one long run of text at sentence ends (else spaces) into pieces <= max. */
function cutLong(text: string, target: number, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let at = Math.max(
      window.lastIndexOf(". ", max),
      window.lastIndexOf("? ", max),
      window.lastIndexOf("! ", max),
      window.lastIndexOf("\n", max),
    );
    if (at < target / 2) at = window.lastIndexOf(" ");
    if (at < target / 2) at = max;
    out.push(rest.slice(0, at + 1).trim());
    rest = rest.slice(at + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Group paragraphs (blank-line separated) into pieces of about `target`
 * characters, never more than `max`, at most `cap` pieces. Pieces shorter than
 * MIN_PART_CHARS are dropped.
 */
export function chunkText(text: string, target: number, max: number, cap: number): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > max ? cutLong(p, target, max) : [p]));
  const parts: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > target) {
      parts.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
    if (parts.length >= cap) break;
  }
  if (current && parts.length < cap) parts.push(current);
  return parts.filter((p) => p.length >= MIN_PART_CHARS).slice(0, cap);
}

/**
 * A published story: part 0 is the headline and the summary (dek) together,
 * parts 1.. are the body. The first part is always there, so a story with an
 * odd body still has a vector.
 */
export function articleParts(story: {
  headline: string | null;
  dek: string | null;
  body: string | null;
}): string[] {
  const headline = String(story.headline ?? "").trim();
  const dek = String(story.dek ?? "").trim();
  const first = [headline, dek].filter(Boolean).join(". ");
  const body = String(story.body ?? "");
  const bodyParts = looksBroken(body)
    ? []
    : chunkText(body, BODY_PART_TARGET, BODY_PART_MAX, ARTICLE_BODY_PARTS_MAX);
  return first ? [first, ...bodyParts] : bodyParts;
}

/** An uploaded file's extracted text. Empty when the read left nothing usable. */
export function documentParts(fullText: string | null | undefined): string[] {
  const text = String(fullText ?? "");
  if (looksBroken(text)) return [];
  return chunkText(text, DOCUMENT_PART_TARGET, DOCUMENT_PART_MAX, DOCUMENT_PARTS_MAX);
}
