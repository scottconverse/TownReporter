/**
 * Unit DD1, item 6 — the Dark Desk's own counters disagreed.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` C3) read the same
 * screen at the same instant and got two accounts of the same file:
 *
 *   rail row:   "Stopped — more to read · 54 records on file"
 *   file line:  "Stopped — more to read · 38 readable / 53 captured"
 *
 * and later in the same session, 66 on file against 44 / 60.
 *
 * Two universes produced them. The rail's `records` was
 * `count(*) from artifacts where investigation_id = i.id` -- every row, capped
 * by nothing. The file's line was `captureBatchStats` over the sixty rows
 * `getInvestigation` happens to load, with the editor's own pasted tip (an
 * `editor://` row, which is not a capture) filtered out of the total. So the
 * rail counted rows the file never showed, and the file's denominator was a
 * page size rather than a fact about the file.
 *
 * What replaces it: ONE query, counting ONE universe, read by both surfaces.
 * The two numbers an editor sees are then the same total, stated twice with
 * what each one is -- "53 captures on file" in the rail, "38 readable / 53
 * captured" on the file -- so the second number is the first number, and the
 * first two add up to it.
 *
 * The pasted tip is not a capture and is counted by neither. An `editor://`
 * row is the text the editor typed to open the file; calling it a captured
 * page is the same class of mistake as the address this unit is otherwise
 * about.
 */

import { captureBatchStats } from "./html-text.ts";

/**
 * Is this row the editor's own pasted tip rather than a captured page?
 *
 * `dark-open.ts` files the paste under an `editor://` URL. It is the text the
 * editor typed to open the file; counting it as a captured page is what made
 * the rail read one ahead of the file's own line.
 */
export function isPastedTip(url: string): boolean {
  return url.startsWith("editor://");
}

export type DigCaptureCounts = {
  /** Captured pages on file, readable or not. */
  captures: number;
  /** Of those, the ones holding article text. */
  readable: number;
  /** The rest: blocked, refused, gone, or opened with nothing in them. */
  unreadable: number;
};

/**
 * The count both surfaces read.
 *
 * `readable` mirrors `readableCapture`'s verdict for a captured page: a 2xx
 * status, a fetch outcome that means the article came back, and enough text to
 * be an article rather than a nav shell. `dark-counters.test.ts` runs this
 * against fixture rows and holds it to `captureBatchStats` on the same rows, so
 * the SQL and the JavaScript cannot drift apart without a test failing.
 *
 * `$1` is the newsroom id, `$2` the investigation id.
 */
export const DIG_CAPTURE_COUNT_SQL = `
  select
    count(*) filter (where a.url not like 'editor://%')::int as captures,
    count(*) filter (
      where a.url not like 'editor://%'
        and coalesce(a.fetch_status, 200) between 200 and 299
        and coalesce(a.fetch_outcome, 'fetched') in ('fetched', 'unchanged', 'changed')
        and char_length(btrim(a.full_text)) >= 40
    )::int as readable
  from artifacts a
  where a.newsroom_id = $1 and a.investigation_id = $2
`;

/** Normalise the query's row, and do the subtraction in one place. */
export function digCaptureCounts(row?: { captures?: unknown; readable?: unknown } | null): DigCaptureCounts {
  const captures = Math.max(0, Math.trunc(Number(row?.captures ?? 0)) || 0);
  const readable = Math.min(captures, Math.max(0, Math.trunc(Number(row?.readable ?? 0)) || 0));
  return { captures, readable, unreadable: captures - readable };
}

/**
 * The same numbers, counted in JavaScript from the rows a caller already has.
 *
 * The fallback for a counting query that could not run. It is the sixty-row
 * page rather than the whole file, so it is the number this unit set out to
 * stop trusting -- but a page of rows that really exist beats a zero, and the
 * alternative is a file with fifty captures on it reading "nothing captured
 * yet" because one count query failed.
 */
export function digCaptureCountsFromRows(
  rows: readonly {
    url: string;
    excerpt: string;
    fetch_status?: number | null;
    fetch_outcome?: string | null;
    extraction_method?: string | null;
  }[],
): DigCaptureCounts {
  // The same verdict the rest of the desk grades captures with, rather than a
  // second copy of it that could drift.
  const stats = captureBatchStats(
    rows
      .filter((row) => !isPastedTip(row.url))
      .map((row) => ({
        text: row.excerpt,
        status: row.fetch_status,
        outcome: row.fetch_outcome,
        extractionMethod: row.extraction_method,
      })),
  );
  return { captures: stats.total, readable: stats.ok, unreadable: stats.total - stats.ok };
}

/** The rail row's line. Names the total, and no second number to disagree with. */
export function digRailCounterLine(captures: number): string {
  const n = Math.max(0, Math.trunc(captures) || 0);
  if (n === 0) return "nothing captured yet";
  return `${n} capture${n === 1 ? "" : "s"} on file`;
}

/**
 * The file's own line. Says what each count is, and only splits into two when
 * there is something to split -- a file whose captures all read says one thing,
 * not "53 readable / 53 captured".
 */
export function captureCounterLine(counts: DigCaptureCounts): string {
  if (counts.captures <= 0) return "nothing captured yet";
  if (counts.readable >= counts.captures) return `${counts.captures} captured`;
  return `${counts.readable} readable / ${counts.captures} captured`;
}
