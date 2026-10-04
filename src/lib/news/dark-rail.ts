import { pileForStatus } from "./desk-copy.ts";

export function newestOpenFile<T extends { id: number; status: string; updated_at: string }>(
  rows: readonly T[],
): T | undefined {
  return rows
    .filter((row) => pileForStatus(row.status) === "desk" && row.status !== "investigating")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
}

/**
 * How many characters of the pasted question `openInvestigationForEditor`
 * (dark-open.ts) keeps as a file's title.
 *
 * Exported so this module recognises a cut title as a cut rather than guessing
 * from a prefix. `dark-open.ts` slices to it, and the recovery below tests for
 * it, so the two cannot drift apart.
 */
export const INVESTIGATION_TITLE_LIMIT = 200;

/**
 * The full question the editor asked, when the stored title was cut short.
 *
 * `openInvestigationForEditor` stores a file's title as the first line of the
 * pasted question, cut to `INVESTIGATION_TITLE_LIMIT`. A separately captured
 * artifact can hold that same first line in full, and when it does the cut
 * title should give way to it.
 *
 * Only a title that shows it was cut may give way (review D1). A title that is
 * merely a prefix of some other artifact's first line is a whole question of its
 * own: the editor's "City budget" beside a tip that opens "City budget documents
 * are available..." is two different things, and swapping in the tip rewrites
 * what the editor asked. So the longer line is used only when the title ends in
 * an ellipsis or sits at the truncation length -- the shapes a cut title has.
 */
export function fullFileQuestion(title: string, paste: string): string {
  const stem = title.replace(/(…|\.\.\.)$/, "").trimEnd();
  const wasCut = title !== stem || title.length >= INVESTIGATION_TITLE_LIMIT;
  if (!wasCut) return title;
  const firstLine = paste.split("\n")[0].replace(/\s+/g, " ").trim();
  return firstLine.startsWith(stem) ? firstLine : title;
}

/** All signals remain accounted for, including those already attached to a file. */
export function signalCounts(rows: readonly { off: unknown }[]) {
  const covered = rows.filter((row) => Boolean(row.off)).length;
  return { total: rows.length, covered, toReview: rows.length - covered };
}
