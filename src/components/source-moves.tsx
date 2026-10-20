import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { SecHead } from "@/components/desk-chrome";
import { getSourceScores, moveSourceByEditor } from "@/lib/news/desk";
import {
  STATUS_WORDS,
  buttonWord,
  movesFrom,
  sortOn,
  sortSourceRowList,
  DEFAULT_SORT,
  type SourceFilter,
  type SourceSort,
  type SourceSortKey,
  type To,
} from "@/lib/news/source-table";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

/*
  DYNAMIC SOURCES, UNIT 8 (D169; spec 6a/6b).

  The source list now changes by itself: suggested sites go on trial, trials
  are kept or dropped, quiet sources go dormant and come back when they change.
  This is where the editor sees what the system did and moves anything back.
  Every move is one click, no confirmation, and can be moved again. Nothing is
  removed.

  THIS TABLE IS THE SOURCE TABLE. Spec 6a: the ranked list by news score, sort
  by any column, the state on every row, and a counts strip that is itself the
  filter. The old read-only "Source inventory" table under it on the same page
  said the same things a second way, so it was folded in here and removed.

  The words, the sort and the filter are in `lib/news/source-table.ts` so a test
  can read them without a browser; this file only draws them.
*/

/** What the desk last recorded about a source, in the editor's words. */
const OBSERVATION_WORDS: Record<string, string> = {
  changed: "The page changed",
  quiet: "No change",
  "retrieval-error": "Could not load the page",
  "extraction-failure": "Could not read the page",
  "asked-to-wait": "Asked us to come back later",
  blocked: "Blocked us",
  "never-checked": "Never checked",
  "verified-claim": "A claim checked out",
  "filled-gap": "Filled a gap in a story",
  "corrected-draft": "Corrected a draft",
  replaced: "Replaced in a story",
  "produced-lead": "Produced a lead",
  promoted: "Moved up",
  demoted: "Moved down",
};

export function MoveButtons({
  sourceId,
  status,
  title,
  onMoved,
}: {
  sourceId: number;
  status: string;
  title: string;
  /** Called after a move lands, so a second screen listing the same rows
   *  (the Sources page) can refetch its own list. */
  onMoved?: () => void;
}) {
  const qc = useQueryClient();
  const [pressed, setPressed] = useState<To | null>(null);
  const move = useMutation({
    mutationFn: (to: To) => moveSourceByEditor({ data: { id: sourceId, to } }),
    onSuccess: (answer) => {
      if (answer.ok) {
        void qc.invalidateQueries({ queryKey: ["source-scores"] });
        void qc.invalidateQueries({ queryKey: ["sources"] });
        onMoved?.();
      }
    },
  });
  const refused = !move.isPending && move.data && !move.data.ok ? move.data.error : null;
  const failed = move.isError ? (move.error instanceof Error ? move.error.message : "The move was not saved.") : refused;
  return (
    <div className="flex flex-wrap gap-2">
      {movesFrom(status).map((to) => (
        <ActionButton
          key={to}
          small
          tone={to === "accepted" ? "primary" : "secondary"}
          phase={pressed === to ? rowActionPhase({ isPending: move.isPending, problem: failed }) : "idle"}
          disabled={move.isPending && pressed !== to}
          workingLabel="Saving…"
          ariaLabel={`${buttonWord(status, to)}: ${title}`}
          onAct={() => {
            setPressed(to);
            move.mutate(to);
          }}
        >
          {buttonWord(status, to)}
        </ActionButton>
      ))}
      {failed ? <span role="alert">{failed}</span> : null}
    </div>
  );
}

function daysOrRhythm(row: { rhythm: string | null; intervalMinutes: number | null }): string {
  if (row.rhythm?.startsWith("weekly:")) {
    const day = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" }[row.rhythm.slice(7)];
    return `Posts on ${day}s`;
  }
  if (row.rhythm?.startsWith("monthly:")) return `Posts in week ${row.rhythm.slice(8)} of the month`;
  if (!row.intervalMinutes) return "Every day";
  const hours = row.intervalMinutes / 60;
  return hours < 24 ? `Every ${hours} hours` : hours === 24 ? "Every day" : `Every ${Math.round(hours / 24)} days`;
}

const COLUMNS: { key: SourceSortKey | null; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score" },
  { key: "leads", label: "Leads / published (90 d)" },
  { key: "lastLead", label: "Last lead" },
  { key: "reads", label: "Reads (90 d)" },
  { key: "howOften", label: "How often" },
  { key: "nextRead", label: "Next read" },
  { key: "lastObservation", label: "Last observation" },
  { key: null, label: "Change it" },
];

export function SourceMovesPanel({
  filter = null,
  onFilter,
}: {
  /** The status the counts strip has narrowed the table to, or null for all. */
  filter?: SourceFilter;
  onFilter?: (filter: SourceFilter) => void;
}) {
  const { formatListDateTime } = usePaperDateFormatters();
  const [sort, setSort] = useState<SourceSort>(DEFAULT_SORT);
  const { data, error, isPending } = useQuery({
    queryKey: ["source-scores"],
    queryFn: () => getSourceScores(),
  });
  if (isPending) return <p className="py-3">Loading the source list…</p>;
  if (error || !data) return <p className="py-3" role="alert">The source list could not be loaded.</p>;
  const { counts, moves, rows } = data;
  const shown = sortSourceRowList(rows, sort, filter);

  /*
    The strip is the filter (spec 6b). Each count is a press that narrows the
    table to that status; "Show all" clears it. The suggested count is a link
    rather than a filter because suggested sites are NOT in this table -- they
    are the review queue on /desk/sources, one tab away.
  */
  const stripButton = (status: To, label: string, count: number) => {
    const on = filter === status;
    return (
      <button
        type="button"
        className={"underline decoration-dotted" + (on ? " font-bold" : "")}
        aria-pressed={on}
        onClick={() => onFilter?.(on ? null : status)}
      >
        <strong>{count}</strong> {label}
      </button>
    );
  };

  return (
    <section className="source-moves" aria-label="Sources that update themselves">
      <SecHead
        title="Sources that update themselves"
        count={counts.accepted + counts.trial + counts.dormant}
        sub="New sites are tried, kept or dropped, and quiet sources are checked less often, without you. Any move can be changed with one click."
      />
      <div className="flex flex-wrap items-center gap-6 py-3">
        {stripButton("accepted", "read by the scan", counts.accepted)}
        {stripButton("trial", "on trial", counts.trial)}
        {stripButton("dormant", "dormant", counts.dormant)}
        <Link to="/desk/sources" search={{ tab: "proposed" }} className="underline decoration-dotted">
          <strong>{counts.suggestedSites}</strong> suggested sites
        </Link>
        {filter ? (
          <button type="button" className="underline" onClick={() => onFilter?.(null)}>
            Show all
          </button>
        ) : null}
      </div>
      <p className="pb-3" aria-live="polite">
        {filter
          ? `Showing ${shown.length} ${STATUS_WORDS[filter].toLowerCase()}.`
          : `Showing all ${shown.length} sources the scan reads, tries or checks monthly.`}
      </p>

      <h3 className="pt-4 pb-2 font-bold">What the system did</h3>
      {moves.length === 0 ? (
        <p className="pb-4">No moves yet. The first trials start within the hour.</p>
      ) : (
        <ul className="source-moves-list pb-4">
          {moves.map((m) => (
            <li key={m.id} className="border-b border-rule py-3">
              <div>
                <strong>{formatListDateTime(m.at)}</strong>
                {" · "}
                <a href={m.url} target="_blank" rel="noreferrer" className="underline">
                  {m.title || m.url}
                </a>
                {" · "}
                {m.by === "editor" ? "You" : "The system"}: {m.note}
              </div>
              <div className="pt-1">
                Now: {STATUS_WORDS[m.statusNow] ?? m.statusNow}
              </div>
              <div className="pt-2">
                <MoveButtons sourceId={m.sourceId} status={m.statusNow} title={m.title || m.url} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="pt-4 pb-2 font-bold">Every source, by news score (last 90 days)</h3>
      <div className="overflow-x-auto pb-6">
        <table className="source-scores w-full border-collapse">
          <thead>
            <tr className="border-b border-ink text-left">
              {COLUMNS.map((column) => {
                const key = column.key;
                const active = key != null && sort.key === key;
                const arrow = active ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={column.label}
                    scope="col"
                    className="p-2"
                    aria-sort={
                      active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    {key == null ? (
                      column.label
                    ) : (
                      <button
                        type="button"
                        className="underline decoration-dotted text-left"
                        onClick={() => setSort((current) => sortOn(key, current))}
                        title={`Sort by ${column.label.toLowerCase()}`}
                      >
                        {column.label}
                        {arrow}
                        <span className="sr-only">
                          {active
                            ? sort.direction === "asc"
                              ? ", sorted ascending"
                              : ", sorted descending"
                            : ", not the current sort"}
                        </span>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className="p-2" colSpan={COLUMNS.length}>
                  {filter
                    ? `No source is ${STATUS_WORDS[filter].toLowerCase()} right now.`
                    : "No sources yet."}
                </td>
              </tr>
            ) : null}
            {shown.map((row) => (
              <tr key={row.id} className="border-b border-rule align-top">
                <td className="p-2" data-label="Source">
                  <Link
                    to="/desk/sources"
                    search={{ tab: "accepted", source: row.id }}
                    className="underline"
                    title="Open this source on the Sources screen"
                  >
                    {row.title || row.url}
                  </Link>
                </td>
                <td className="p-2" data-label="Status">
                  <span className={"astra-chip " + (row.status === "trial" ? "wait" : "same")}>
                    {STATUS_WORDS[row.status] ?? row.status}
                  </span>
                  {row.status === "trial" ? ` (${row.trialReads} of 6 reads)` : ""}
                </td>
                <td className="p-2" data-label="Score">
                  {row.score == null ? "Not enough reads" : row.score.toFixed(2)}
                </td>
                <td className="p-2" data-label="Leads / published">
                  {row.leads90} / {row.published90}
                </td>
                <td className="p-2" data-label="Last lead">
                  {row.lastLeadAt ? formatListDateTime(row.lastLeadAt) : "No lead yet"}
                </td>
                <td className="p-2" data-label="Reads">{row.reads90}</td>
                <td className="p-2" data-label="How often">{daysOrRhythm(row)}</td>
                <td className="p-2" data-label="Next read">
                  {row.status === "accepted" ? (row.nextDueAt ? formatListDateTime(row.nextDueAt) : "Due now") : row.status === "trial" ? "Within 4 hours" : "Monthly check"}
                </td>
                <td className="p-2" data-label="Last observation">
                  {row.lastObservationAt
                    ? `${OBSERVATION_WORDS[row.lastObservationKind ?? ""] ?? row.lastObservationKind} · ${formatListDateTime(row.lastObservationAt)}`
                    : "Nothing recorded yet"}
                </td>
                <td className="p-2" data-label="Change it">
                  <MoveButtons sourceId={row.id} status={row.status} title={row.title || row.url} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
