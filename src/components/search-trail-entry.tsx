import { assertHttpUrl } from "../lib/news/url-guard.ts";
import { searchOutcomeWords } from "../lib/news/search-trail-words.ts";

export type SearchTrailRecord = {
  query: string;
  tier?: string | null;
  outcome?: string | null;
  state?: string | null;
  url?: string | null;
  selected_json?: string | null;
};
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
        “{record.query}” · {tier} · {searchOutcomeWords(record)}
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
