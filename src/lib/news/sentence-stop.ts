/*
  FC18 (Oct 11 walk): a scan note was cut to "... Casey Cooley's Oct." A cut
  that looks for ". " treats AP abbreviations ("Oct. 17", "Main St. in") as a
  sentence end, so it can stop on exactly that kind of word. This finds the
  last real sentence end at or before the end of `text`.
*/
const ABBREVIATIONS = new Set([
  "jan", "feb", "aug", "sept", "oct", "nov", "dec",
  "st", "ave", "blvd", "rd", "hwy", "mt", "ft",
  "mr", "mrs", "ms", "dr", "jr", "sr", "gov", "sen", "rep", "lt", "sgt", "capt", "gen", "col", "prof", "rev",
  "no", "inc", "co", "corp", "ltd", "vs", "etc", "approx",
  "a.m", "p.m", "u.s", "e.g", "i.e",
]);

/** Index of the last sentence-ending mark in `text`, or -1. */
export function lastSentenceStop(text: string): number {
  for (let i = text.length - 1; i > 0; i--) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    if (i + 1 < text.length && !/\s/.test(text[i + 1]!)) continue;
    if (ch === ".") {
      const word = /([A-Za-z.]+)$/.exec(text.slice(0, i))?.[1]?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word)) continue;
    }
    return i;
  }
  return -1;
}

/** Cut `text` to at most `limit` characters, ending on a full sentence when one fits. */
export function cutAtSentenceEnd(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = lastSentenceStop(cut);
  return stop > 0 ? cut.slice(0, stop + 1).trim() : cut.trim();
}
