const NOTEBOOK =
  /^\s*(next checks? are|next check is|still to (pull|check|verify|review)|documents still to|follow[- ]up reporting|we should (look|check|pull)|reporter still needs)\b/i;
const SCOREKEEPING =
  /^\s*(\*{0,2}\s*)?(what is solid|what is not solid|confirmed from|still unknown|not solid yet|from local headlines)\b/i;
const TRAILER =
  /\*{0,2}\s*(What is solid\b|What is not solid\b|Next checks? are\b|Next check is\b|Still to pull\b)/i;

function isNotebookLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return NOTEBOOK.test(t) || SCOREKEEPING.test(t.replace(/^\*+\s*/, ""));
}

/** Drop reporter-to-do lines the model stuffed into the story. */
export function stripReporterNotebook(body: string): string {
  const marker = body.search(TRAILER);
  const cut = marker >= 0 ? body.slice(0, marker) : body;
  return cut
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line && !isNotebookLine(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
