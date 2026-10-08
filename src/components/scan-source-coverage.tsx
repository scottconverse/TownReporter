import { useState } from "react";
import {
  scanSourceCoverageAge,
  scanSourceCoverageLine,
  scanSourceCoverageReason,
  scanSourceCoverageStatus,
} from "@/lib/news/desk-copy";
import type { ScanSourceCoverageEntry } from "@/lib/news/scan-source-coverage.ts";

export function ScanSourceCoverageList(props: {
  entries: readonly ScanSourceCoverageEntry[];
  asOf: string;
  listId: string;
  formatListDateTime: (value: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailEntries = props.entries.filter(
    (entry) => entry.status === "skipped" || entry.status === "blocked",
  );
  if (!props.entries.length || props.entries.some((entry) => entry.status === "pending")) return null;
  const asOfMs = Date.parse(props.asOf);
  return (
    <section className="mt-3">
      <p className="scan-line">{scanSourceCoverageLine(props.entries)}</p>
      {detailEntries.length ? (
        <>
          <button
            className="mt-2 min-h-11 rounded border border-rule px-3 text-sm underline"
            type="button"
            aria-expanded={expanded}
            aria-controls={props.listId}
            onClick={() => setExpanded(!expanded)}
          >
            Skipped and blocked sources ({detailEntries.length})
          </button>
          {expanded ? (
            <ul className="mt-2 grid gap-2" id={props.listId}>
              {detailEntries.map((entry) => (
                <li key={entry.sourceId} className="border border-rule p-3">
                  <a href={entry.url} target="_blank" rel="noreferrer" className="inline-link">
                    {entry.title}
                  </a>
                  <p className="text-sm text-muted">
                    Kind: {entry.kind || "unclassified"} · Tier: {entry.tier || "unclassified"}
                  </p>
                  <p className="text-sm">
                    {scanSourceCoverageStatus(entry)} · {scanSourceCoverageReason(entry)}
                  </p>
                  <p className="text-sm text-muted">
                    {entry.lastReadAt
                      ? `Last read ${props.formatListDateTime(entry.lastReadAt)} · ${scanSourceCoverageAge(entry.lastReadAt, asOfMs)}`
                      : "Never read"}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
