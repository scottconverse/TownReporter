import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addEvidenceToLeadFn, searchEvidenceFn } from "@/lib/news/evidence-search";
import { formatShortDate } from "@/lib/paper";
import { withEditorWarningAction } from "@/components/editor-warning-consent.ts";
import { askDeskToastOverride } from "@/components/desk-toast.ts";
import type { EvidenceRow, EvidenceSearchResult } from "@/lib/news/evidence-search.server";

/**
 * "Find evidence" on the Story page's Sources tab (D285/D286).
 *
 * Two lists, side by side on a wide screen and stacked under 900px: the words
 * the editor typed ("Exact words") and the pieces nearest them by meaning
 * ("Close in meaning"), with no repeats between the two. Every row opens the
 * original page or adds its address to the lead -- the same source list the
 * "Sources on the lead" block below draws.
 *
 * Text is 16px or larger and full contrast in light and dark mode (the
 * old-eyes rule); nothing here uses the muted `meta` colour for the words an
 * editor has to read.
 */

type Props = {
  leadId: number;
  /** The lead's current source list, so "On this story" can be shown. */
  sources: string[];
};

type SearchOk = Extract<EvidenceSearchResult, { ok: true }>;

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function EvidenceList({
  rows,
  emptyWords,
  leadId,
  onStory,
  onAdded,
}: {
  rows: EvidenceRow[];
  emptyWords: string;
  leadId: number;
  onStory: (url: string) => boolean;
  onAdded: (url: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  async function add(row: EvidenceRow) {
    setBusy(row.md5);
    setError("");
    try {
      const result = await withEditorWarningAction(
        (override) =>
          addEvidenceToLeadFn({ data: { leadId, url: row.url, override } }),
        { action: "Add to this story" },
        (warning) => askDeskToastOverride(warning),
      );
      if (!result || typeof result !== "object" || !("ok" in result)) {
        setError("The desk did not answer. Nothing changed; try again.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await onAdded(row.url);
    } catch {
      setError("That web address could not be added. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <p className="evidence-empty">{emptyWords}</p>;
  }
  return (
    <>
      {error && <p className="evidence-error">{error}</p>}
      <ul className="evidence-list">
        {rows.map((row) => (
          <li key={row.md5} className="evidence-row">
            <p className="evidence-title">{row.title || hostOf(row.url)}</p>
            <p className="evidence-meta">
              {hostOf(row.url)} · captured {formatShortDate(row.capturedAt)}
            </p>
            <p className="evidence-excerpt">{row.excerptStart}</p>
            <div className="evidence-actions">
              <a className="btn" href={row.url} target="_blank" rel="noreferrer">
                Open
              </a>
              {onStory(row.url) ? (
                <span className="evidence-on-story">On this story</span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy === row.md5}
                  onClick={() => void add(row)}
                >
                  {busy === row.md5 ? "Adding…" : "Add to this story"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function EvidenceSearch({ leadId, sources }: Props) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchOk | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const onStory = (url: string) => sources.includes(url) || added.includes(url);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setError("");
    try {
      const answer = await searchEvidenceFn({ data: { q: query } });
      if (!answer.ok) {
        setResult(null);
        setError(answer.error);
        return;
      }
      setResult(answer);
    } catch {
      setResult(null);
      setError("The search could not run. Try again.");
    } finally {
      setSearching(false);
    }
  }

  async function afterAdd(url: string) {
    setAdded((current) => (current.includes(url) ? current : [...current, url]));
    await qc.invalidateQueries({ queryKey: ["lead", leadId] });
  }

  return (
    <section className="evidence-search" aria-label="Find evidence">
      <form className="evidence-search-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="evidence-search-q">Find evidence</label>
        <input
          id="evidence-search-q"
          type="search"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Words from the story or its sources"
        />
        <button type="submit" className="btn" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <p className="evidence-error">{error}</p>}
      {result && (
        <div className="evidence-columns">
          <div className="evidence-col">
            <h3 className="evidence-heading">Exact words ({result.exact.length})</h3>
            <EvidenceList
              rows={result.exact}
              emptyWords="No evidence holds these exact words."
              leadId={leadId}
              onStory={onStory}
              onAdded={afterAdd}
            />
          </div>
          <div className="evidence-col">
            <h3 className="evidence-heading">Close in meaning ({result.meaning.length})</h3>
            {result.meaningStatus.ready ? (
              <EvidenceList
                rows={result.meaning}
                emptyWords="Nothing close in meaning yet."
                leadId={leadId}
                onStory={onStory}
                onAdded={afterAdd}
              />
            ) : (
              <p className="evidence-empty">
                Search by meaning is not ready: {result.meaningStatus.reason}.
              </p>
            )}
            <p className="evidence-coverage">
              Close in meaning covers {result.meaningStatus.covered} of{" "}
              {result.meaningStatus.total} evidence pieces so far.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
