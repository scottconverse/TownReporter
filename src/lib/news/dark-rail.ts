export function newestTouchedFile<T extends { id: number; updated_at: string }>(
  rows: readonly T[],
): T | undefined {
  return [...rows]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
}

/**
 * Pick the file the Dark Desk opens once its list arrives.
 *
 * A handoff from Send to Dark Desk or Open file is explicit and wins over both
 * the file already on screen and the newest row. A current file is kept only
 * while it is still in the list; otherwise the newest valid file is the safe
 * fallback. Keeping this choice pure makes the precedence testable without a
 * browser or a server.
 */
export function darkFileToOpen<T extends { id: number; updated_at: string }>(
  rows: readonly T[],
  currentId: number | null,
  requestedId: number | null,
): number | null {
  const requested = requestedId == null ? undefined : rows.find((row) => row.id === requestedId);
  if (requested) return requested.id;
  const current = currentId == null ? undefined : rows.find((row) => row.id === currentId);
  return current?.id ?? newestTouchedFile(rows)?.id ?? null;
}

/**
 * Whether the list can make the handoff choice final.
 *
 * A requested file may have been created after the cached list in the shell
 * navigation was read. While it is absent, the first cached list is not enough
 * evidence to fall back to another row: wait for a fetch made after Dark Desk
 * mounted. Once that fetch arrives, an absent request means the file is gone,
 * and the ordinary current-or-newest fallback applies. A request already in
 * the list can be opened without another round trip.
 */
export function darkFilePickIsFinal<T extends { id: number }>(
  rows: readonly T[],
  requestedId: number | null,
  fetchedAfterMount: boolean,
): boolean {
  // An empty cached list has not supplied a file to open yet. Wait for the
  // post-mount fetch even when this visit has no handoff request.
  if (!fetchedAfterMount && rows.length === 0) return false;
  if (requestedId == null) return true;
  return fetchedAfterMount || rows.some((row) => row.id === requestedId);
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
