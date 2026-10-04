import { pileForStatus } from "./desk-copy.ts";

export function newestOpenFile<T extends { id: number; status: string; updated_at: string }>(
  rows: readonly T[],
): T | undefined {
  return rows
    .filter((row) => pileForStatus(row.status) === "desk" && row.status !== "investigating")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
}

/** A stored short title may be the prefix of the editor's full pasted question. */
export function fullFileQuestion(title: string, paste: string): string {
  const firstLine = paste.split("\n")[0].replace(/\s+/g, " ").trim();
  return firstLine.startsWith(title) ? firstLine : title;
}

/** All signals remain accounted for, including those already attached to a file. */
export function signalCounts(rows: readonly { off: unknown }[]) {
  const covered = rows.filter((row) => Boolean(row.off)).length;
  return { total: rows.length, covered, toReview: rows.length - covered };
}
