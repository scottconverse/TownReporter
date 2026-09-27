/**
 * The safe, human wording for a search's outcome -- no query text, no URL.
 *
 * This lives in its own module because two surfaces print it in two different
 * row shapes: the search trail (src/components/search-trail-entry.tsx) and the
 * Dark Desk's Activity log (src/routes/desk.dark.tsx). The outcome words are an
 * audit surface -- an editor reads them to decide whether a round actually
 * looked -- so there must be exactly one of them, and neither caller may grow a
 * private copy that drifts.
 */
export type SearchOutcomeRecord = {
  state?: string | null;
  outcome?: string | null;
};

const SEARCH_WORDS: Record<string, string> = {
  SEARCH_SUCCESS_RESULTS: "Results returned",
  SEARCH_SUCCESS_ZERO_RESULTS: "No results found",
  SEARCH_FAILED_NETWORK: "Search could not connect",
  SEARCH_FAILED_PROVIDER: "Search service failed",
  SEARCH_FAILED_PARSE: "Search response could not be read",
  SEARCH_BLOCKED: "Search was blocked",
  SEARCH_TIMEOUT: "Search timed out",
};

export function searchOutcomeWords(record: SearchOutcomeRecord): string {
  if (record.state) return SEARCH_WORDS[record.state] ?? "Search outcome not recorded";
  const raw = record.outcome ?? "";
  if (/blocked/i.test(raw)) return "Search was blocked";
  if (/timeout|timed out/i.test(raw)) return "Search timed out";
  if (/fail/i.test(raw)) return "Search could not finish";
  if (/no results/i.test(raw)) return "No results found";
  if (/^\d+ result\(s\)$/.test(raw)) return raw;
  return "Search outcome not recorded";
}
