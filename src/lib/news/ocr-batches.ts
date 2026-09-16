/**
 * Plan bounded OCR work without losing whole-packet completeness.
 *
 * A vision request still handles only a small group of consecutive pages.
 * The durable artifact worker calls this planner again after every saved
 * group, so a stopped or retried job resumes at the first page that has not
 * produced retained evidence.
 */
export const OCR_BATCH_PAGE_LIMIT = 12;

export type OcrPageBatch = { start: number; end: number };

export function planMissingOcrBatches(
  totalPages: number,
  retainedPages: Iterable<number>,
  batchLimit = OCR_BATCH_PAGE_LIMIT,
): OcrPageBatch[] {
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) return [];
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1)
    throw new Error("OCR batch size must be a positive integer.");

  const retained = new Set(
    [...retainedPages].filter(
      (page) => Number.isSafeInteger(page) && page >= 1 && page <= totalPages,
    ),
  );
  const batches: OcrPageBatch[] = [];
  let page = 1;
  while (page <= totalPages) {
    while (page <= totalPages && retained.has(page)) page += 1;
    if (page > totalPages) break;
    const start = page;
    let count = 0;
    while (page <= totalPages && !retained.has(page) && count < batchLimit) {
      page += 1;
      count += 1;
    }
    batches.push({ start, end: page - 1 });
  }
  return batches;
}

export function unreadOcrPages(totalPages: number, retainedPages: Iterable<number>): number[] {
  const retained = new Set(retainedPages);
  return Array.from({ length: Math.max(0, totalPages) }, (_, index) => index + 1).filter(
    (page) => !retained.has(page),
  );
}

export function pageListSummary(pages: readonly number[], maxItems = 16): string {
  if (!pages.length) return "none";
  const shown = pages.slice(0, maxItems).join(", ");
  return pages.length > maxItems ? `${shown}, and ${pages.length - maxItems} more` : shown;
}
