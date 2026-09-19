/**
 * Bounded scan analysis batching (P0-5).
 *
 * The single-pass scan built one payload string against a 48,000-character
 * budget and `break`-ed as soon as the next source block would overflow
 * (desk.ts:743/762). Every source after that point was fetched and paid for,
 * then silently dropped before the model ever saw it -- the reported cause of
 * large scans fetching 146 sources and filing 0-3 leads.
 *
 * This module splits the ranked, fetched sources into bounded batches and
 * gives each batch its own payload, so a 100-source scan produces several
 * model calls instead of one truncated one. It is deliberately pure and
 * dependency-free so the truncation proof runs under plain `node --test`.
 *
 * Batching, not resumption: a failed batch does not abort the others and does
 * not discard their leads. Resumable/checkpointed scan semantics are
 * explicitly out of scope for this unit (P1).
 */

export type ScanBatchSource = {
  /** Stable identity for de-duplication and attribution across batches. */
  id: number;
  title: string;
  url: string;
  /** The excerpt text this source contributes (already excerpted). */
  block: string;
};

export type ScanBatch = {
  /** Zero-based batch index, used for batch accounting in scan_runs. */
  index: number;
  sources: ScanBatchSource[];
  /** Joined, budget-respecting payload for one model call. */
  payload: string;
};

export type BuildScanBatchesInput = {
  sources: ScanBatchSource[];
  /** Character budget per batch. Defaults to the historical single-pass 48000. */
  charBudget?: number;
  /** Hard cap on sources per batch. Defaults to 40. */
  maxSourcesPerBatch?: number;
};

export const DEFAULT_SCAN_BATCH_CHARS = 48_000;
export const DEFAULT_SCAN_BATCH_SOURCES = 40;

const SEPARATOR = "\n\n---\n\n";

/**
 * Split sources into bounded batches.
 *
 * Guarantees:
 * - Every source appears in exactly one batch, in the given order. Nothing is
 *   dropped just because the total exceeds one budget.
 * - No batch's payload exceeds `charBudget` when the source's own block fits;
 *   an over-budget single block is placed alone rather than dropped, so the
 *   model still sees it (truncated by the caller's excerpting, not silently
 *   omitted).
 * - A source is never split across batches.
 */
export function buildScanBatches(input: BuildScanBatchesInput): ScanBatch[] {
  const charBudget = input.charBudget ?? DEFAULT_SCAN_BATCH_CHARS;
  const maxSources = input.maxSourcesPerBatch ?? DEFAULT_SCAN_BATCH_SOURCES;
  const batches: ScanBatch[] = [];
  let current: ScanBatchSource[] = [];
  let currentPayload = "";

  const flush = () => {
    if (!current.length) return;
    batches.push({ index: batches.length, sources: current, payload: currentPayload });
    current = [];
    currentPayload = "";
  };

  for (const source of input.sources) {
    const nextPayload = currentPayload ? currentPayload + SEPARATOR + source.block : source.block;
    const overBudget = currentPayload !== "" && nextPayload.length > charBudget;
    const overCount = current.length >= maxSources;
    if (overBudget || overCount) {
      flush();
    }
    current.push(source);
    currentPayload = currentPayload ? currentPayload + SEPARATOR + source.block : source.block;
  }
  flush();
  return batches;
}

/**
 * Merge parsed batch results into one scan result: leads are concatenated and
 * de-duplicated (by normalized headline), proposed sources de-duplicated by
 * URL, and the editor summaries joined. Per-lead source attribution is
 * preserved because each lead keeps its own `source_urls` from the batch it
 * came from.
 */
export function mergeScanBatchResults<
  TLead extends { headline: string; source_urls: string[] },
  TProposed extends { url: string },
>(results: { leads: TLead[]; proposed_sources: TProposed[]; editor_summary: string }[]): {
  leads: TLead[];
  proposed_sources: TProposed[];
  editor_summary: string;
} {
  const leads: TLead[] = [];
  const seenHeadlines = new Set<string>();
  const proposed: TProposed[] = [];
  const seenUrls = new Set<string>();
  const summaries: string[] = [];
  for (const result of results) {
    for (const lead of result.leads) {
      const key = lead.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seenHeadlines.has(key)) continue;
      seenHeadlines.add(key);
      leads.push(lead);
    }
    for (const row of result.proposed_sources) {
      const key = row.url.trim();
      if (!key || seenUrls.has(key)) continue;
      seenUrls.add(key);
      proposed.push(row);
    }
    const summary = result.editor_summary.trim();
    if (summary) summaries.push(summary);
  }
  return {
    leads,
    proposed_sources: proposed,
    editor_summary: summaries.join(" ").slice(0, 2000),
  };
}