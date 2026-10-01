/**
 * How much of the editor's pasted material ever reaches a model prompt.
 *
 * THE FAILING CASE (unit B8P). `buildWritingPack` and `buildEditorialPack` used
 * to push `sourceText` -- "the complete private material pasted by the editor"
 * -- into the prompt whole. Nothing cut it. The only size limit anywhere on
 * that text was the entry check in `model-request-commit.server.ts`, which
 * refuses more than 20,000,000 characters: an editor could paste a 2 MB council
 * packet (well under 20 M) and the whole packet went to one writing call, either
 * failing on the model's context or costing real money before it did.
 *
 * The research summary that rides in the same prompt has been capped at
 * `RESEARCH_TEXT_CAP` (40,000 characters) for longer than this module has
 * existed. The editor's own material was the one unbounded thing in the call.
 *
 * WHY 120,000 CHARACTERS. The writing call is not only the pasted material: it
 * also carries the voice file as the system instructions, the desk's notes, and
 * a research summary of up to 40,000 characters (roughly 10,000 tokens at the
 * ~4 characters per token this desk sizes by). The call still has to have room
 * to WRITE a piece of a few thousand words. 120,000 characters is about 30,000
 * tokens, which leaves all of that comfortably inside the smallest context any
 * model in the ladder actually offers:
 *
 *   - `local-models.ts` / the repo's own record of the local-model failure
 *     measured a 35,000-token request against a 32,000-token context. That is
 *     the failure this cap exists to stop repeating.
 *   - The rungs the ladder actually starts on -- DeepSeek v4.1 Flash, Claude,
 *     Codex -- have contexts from 128,000 tokens up. Pasted material at 30,000
 *     tokens plus voice, notes, research and room to write stays under it.
 *
 * A smaller model whose real context the desk KNOWS is handled by
 * `suppliedMaterialCapFor` below, which takes the smaller of the two.
 */

/** How much of the editor's pasted material any model prompt may carry. */
export const SUPPLIED_MATERIAL_CAP = 120_000;

/** The share of a known context window pasted material may claim, as tokens. */
export const SUPPLIED_MATERIAL_CONTEXT_SHARE = 0.3;

/** The characters-per-token ratio the desk sizes prompts by, made explicit. */
export const SUPPLIED_MATERIAL_CHARS_PER_TOKEN = 4;

/**
 * The cap for a call sent to a model whose context window is known.
 *
 * `contextLength` comes from `local-models.ts` (Ollama reports it; LM Studio
 * and llama.cpp leave it null). A known window gets
 * `contextLength x 4 x 0.3` characters -- about 30% of the window, in tokens --
 * and never more than `SUPPLIED_MATERIAL_CAP`. An unknown or nonsense window
 * (null, 0, negative) keeps the constant; it is never read as "no limit".
 *
 * NOT YET WIRED INTO THE PROMPT PATH. Reading a live `contextLength` means a
 * catalog probe (`discoverLocalModels`) on the writing path -- a network call
 * inside prompt building, which the local pick does not carry today
 * (`LocalModelOverride` is `{baseUrl, id}`). The constant is what is enforced
 * everywhere; this helper is the smaller-of-the-two rule, available and tested
 * for whoever threads the catalog down. See the B8P report.
 */
export function suppliedMaterialCapFor(contextLength?: number | null): number {
  if (typeof contextLength !== "number" || !Number.isFinite(contextLength) || contextLength <= 0) {
    return SUPPLIED_MATERIAL_CAP;
  }
  const share = Math.floor(
    contextLength * SUPPLIED_MATERIAL_CHARS_PER_TOKEN * SUPPLIED_MATERIAL_CONTEXT_SHARE,
  );
  return Math.max(1, Math.min(SUPPLIED_MATERIAL_CAP, share));
}

/** What `capSuppliedMaterial` did, and the counts the editor is told about. */
export type CappedSuppliedMaterial = {
  /** What may be sent: the original when nothing was cut, else the head of it. */
  text: string;
  cut: boolean;
  /** `text.length` -- the characters the model actually reads. */
  keptChars: number;
  /** What the desk was handed, before any cutting. */
  totalChars: number;
};

/**
 * How far back from the cap a boundary is looked for.
 *
 * A cut has to land on a paragraph or sentence boundary to be readable, but it
 * must not throw away a large tail just to find one: a wall of text with no
 * break in the last 8,000 characters falls through to the word-boundary rule
 * rather than losing 100,000 characters to reach an earlier paragraph.
 */
const BOUNDARY_LOOKBACK = 8_000;

/**
 * The index to cut at, preferring the last paragraph break, then the last
 * sentence end, then the last whitespace, in `text[from..to)`.
 *
 * Every candidate is at or before `to`, so the result can never exceed the cap.
 * Returns `to` when there is no break at all -- a single unbroken run of
 * characters is cut at the cap, which is the one case where a "word" is split,
 * because there is no word boundary to be found.
 */
function cutPoint(text: string, from: number, to: number): number {
  const paragraph = lastParagraphEnd(text, from, to);
  if (paragraph !== null) return paragraph;

  const sentence = lastSentenceEnd(text, from, to);
  if (sentence !== null) return sentence;

  // Last whitespace: keep up to it, so the head ends on a whole word.
  for (let i = to - 1; i >= from; i -= 1) {
    if (/\s/.test(text[i]!)) return i;
  }
  return to;
}

/** Just past the last blank-line paragraph break in `text[from..to)`. */
function lastParagraphEnd(text: string, from: number, to: number): number | null {
  const candidates: number[] = [];
  const lf = text.lastIndexOf("\n\n", to - 1);
  if (lf >= from) candidates.push(lf);
  // A paste from Windows carries CRLF; the break is the same break.
  const crlf = text.lastIndexOf("\r\n\r\n", to - 1);
  if (crlf >= from) candidates.push(crlf);
  if (!candidates.length) return null;
  // Keep the text BEFORE the blank line, so the head ends with its last
  // paragraph and no dangling newline.
  return Math.max(...candidates);
}

/**
 * Just past the last sentence-ending punctuation in `text[from..to)`.
 *
 * The punctuation may be followed by closing quotes or brackets, which belong
 * to the sentence that just ended.
 */
function lastSentenceEnd(text: string, from: number, to: number): number | null {
  for (let i = to - 1; i >= from; i -= 1) {
    if (!/[.!?]/.test(text[i]!)) continue;
    let end = i + 1;
    while (end < to && /["'’”)\]]/.test(text[end]!)) end += 1;
    // A sentence ends only if whitespace (or the window's edge) follows it:
    // this is what keeps "U.S. Army" and "3.5 million" from being read as ends.
    if (end >= to || /\s/.test(text[end]!)) return end;
  }
  return null;
}

/**
 * Cut the editor's supplied material to a safe size, keeping the START.
 *
 * The start is the part worth keeping: a council packet puts its summary, its
 * agenda and its staff report first, and a pasted article puts its point first.
 *
 * Text at or under the cap is returned byte for byte, untrimmed -- a short
 * paste is not this function's business to tidy. Over the cap, the text is cut
 * at the last paragraph break, sentence end or whitespace inside
 * `BOUNDARY_LOOKBACK` characters of the cap, and trailing whitespace is
 * dropped from what is kept. The returned text NEVER exceeds the cap.
 */
/**
 * A cut can land between the two halves of a character outside the basic plane
 * (an emoji). The kept text must not end on a lone high surrogate: some model
 * APIs reject it. Found by the production auditor on 956a6688 (F1).
 */
function dropLoneHighSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

export function capSuppliedMaterial(
  text: string,
  cap: number = SUPPLIED_MATERIAL_CAP,
): CappedSuppliedMaterial {
  const source = String(text ?? "");
  const totalChars = source.length;
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : SUPPLIED_MATERIAL_CAP;
  if (totalChars <= limit) {
    return { text: source, cut: false, keptChars: totalChars, totalChars };
  }
  const floor = Math.max(0, limit - BOUNDARY_LOOKBACK);
  const kept = dropLoneHighSurrogate(source.slice(0, cutPoint(source, floor, limit))).replace(/\s+$/, "");
  /*
    A pathological head (whitespace all the way to the floor) could strip to
    nothing. Fall back to the raw slice rather than send an empty section.
  */
  const keptText = kept.length ? kept : dropLoneHighSurrogate(source.slice(0, limit));
  return {
    text: keptText,
    cut: true,
    keptChars: keptText.length,
    totalChars,
  };
}

/** Thousands separators, without the locale the environment may not have. */
export function withThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The one sentence the editor is shown when their material was cut.
 *
 * Rendered wherever the piece's result is shown (the opinion desk's piece
 * panel, the story workbench, and the finished job row), from the counts stored
 * with the piece -- not a toast, so a reload still shows it.
 */
export function suppliedMaterialCutSentence(cut: {
  keptChars: number;
  totalChars: number;
}): string {
  const total = withThousands(cut.totalChars);
  const kept = withThousands(cut.keptChars);
  const percent = Math.max(1, Math.round((cut.keptChars / Math.max(1, cut.totalChars)) * 100));
  return (
    `Your pasted material was ${total} characters. The writer read the first ` +
    `${kept} (about ${percent}%). The rest was cut for length. ` +
    `To use more, paste it in separate pieces.`
  );
}

/**
 * What was cut, as it is stored with the piece.
 *
 * `drafts.research_json` -- the free-form JSON blob the desk screens already
 * read back (`name-check.ts`'s `nameCheck` is the same shape, stored the same
 * way) -- so this needs no migration and no new column. The SENTENCE is stored
 * with the counts, not rebuilt from them at read time, so the note an editor
 * reads years later is the note this run wrote, exactly as the name check's
 * `note` is.
 */
export type SuppliedMaterialCut = {
  version: 1;
  keptChars: number;
  totalChars: number;
  note: string;
};

/** The stored record for a cap result, or null when nothing was cut. */
export function suppliedMaterialCutRecord(
  capped: { cut: boolean; keptChars: number; totalChars: number },
): SuppliedMaterialCut | null {
  if (!capped.cut) return null;
  return {
    version: 1,
    keptChars: capped.keptChars,
    totalChars: capped.totalChars,
    note: suppliedMaterialCutSentence(capped),
  };
}

/**
 * Read the stored cut back off a draft's `research_json`.
 *
 * Tolerant the way `readNameCheck` is: anything malformed, missing, or that
 * does not describe a real cut (`totalChars <= keptChars`) reads as null, so a
 * piece whose material was NOT cut can never be shown a "the rest was cut"
 * sentence -- including a piece whose row was written by an older build.
 */
export function readSuppliedMaterialCut(raw: string | null | undefined): SuppliedMaterialCut | null {
  try {
    const cut = JSON.parse(raw ?? "{}").lengthCut;
    if (!cut || typeof cut !== "object") return null;
    if (cut.version !== 1) return null;
    if (typeof cut.keptChars !== "number" || typeof cut.totalChars !== "number") return null;
    if (!Number.isFinite(cut.keptChars) || !Number.isFinite(cut.totalChars)) return null;
    if (typeof cut.note !== "string" || !cut.note.trim()) return null;
    if (cut.totalChars <= cut.keptChars) return null;
    return cut as SuppliedMaterialCut;
  } catch {
    return null;
  }
}
