import { assertHttpUrl } from "../lib/news/url-guard.ts";

export type SearchTrailRecord = {
  query: string;
  tier?: string | null;
  outcome?: string | null;
  state?: string | null;
  url?: string | null;
  selected_json?: string | null;
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
function outcomeWords(record: SearchTrailRecord): string {
  if (record.state) return SEARCH_WORDS[record.state] ?? "Search outcome not recorded";
  const raw = record.outcome ?? "";
  if (/blocked/i.test(raw)) return "Search was blocked";
  if (/timeout|timed out/i.test(raw)) return "Search timed out";
  if (/fail/i.test(raw)) return "Search could not finish";
  if (/no results/i.test(raw)) return "No results found";
  if (/^\d+ result\(s\)$/.test(raw)) return raw;
  return "Search outcome not recorded";
}
function returnedUrls(record: SearchTrailRecord): string[] {
  const urls: unknown[] = [record.url];
  try {
    const parsed: unknown = JSON.parse(record.selected_json ?? "[]");
    if (Array.isArray(parsed)) urls.push(...parsed);
  } catch {
    /* old or incomplete trail */
  }
  const safe: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    try {
      const url = assertHttpUrl(raw);
      if (url.username || url.password) continue;
      if (!safe.includes(url.href)) safe.push(url.href);
    } catch {
      /* no link for unsafe source */
    }
  }
  return safe.slice(0, 3);
}
export function SearchTrailEntry({ record }: { record: SearchTrailRecord }) {
  const tier =
    record.tier === "official"
      ? "official record"
      : record.tier === "local-press"
        ? "local press"
        : record.tier === "community"
          ? "community"
          : "source type not recorded";
  return (
    <div className="side-item">
      <p>
        “{record.query}” · {tier} · {outcomeWords(record)}
      </p>
      {returnedUrls(record).map((url, i) => (
        <p key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-link">
            Open returned source{i ? ` ${i + 1}` : ""} · {new URL(url).hostname}
          </a>
        </p>
      ))}
    </div>
  );
}
