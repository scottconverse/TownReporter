export const CUT_OFF_WARNING = "This draft looks cut off. Read it before you publish.";

/** A blank headline or body is never saved as a draft (Release H decision 1). */
export const EMPTY_DRAFT_ERROR = "The writing model returned an empty draft; nothing was saved.";

/** A sentence fragment or a token-sized article is a failed writing step. */
export function draftLooksCutOff(body: string, minimumWords = 0): boolean {
  const text = body.trim();
  if (!text) return false;
  const words = text.split(/\s+/).length;
  return words < minimumWords || !/[.!?]["'\u201d\u2019)*_]*$/.test(text);
}

