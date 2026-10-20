import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { SecHead } from "@/components/desk-chrome";
import { getSourceScores, moveSourceByEditor } from "@/lib/news/desk";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

/*
  DYNAMIC SOURCES, UNIT 8 (D169; spec 6a/6b).

  The source list now changes by itself: suggested sites go on trial, trials
  are kept or dropped, quiet sources go dormant and come back when they change.
  This is where the editor sees what the system did and moves anything back.
  Every move is one click, no confirmation, and can be moved again. Nothing is
  removed.
*/

type To = "accepted" | "trial" | "dormant";

export const STATUS_WORDS: Record<string, string> = {
  accepted: "Read by the scan",
  trial: "On trial",
  dormant: "Dormant (checked once a month)",
};

const BUTTON_WORDS: Record<To, string> = {
  accepted: "Keep it",
  trial: "Try it again",
  dormant: "Make it dormant",
};

/** The moves the editor can make from a status: every other status. */
export function movesFrom(status: string): To[] {
  return (["accepted", "trial", "dormant"] as To[]).filter((to) => to !== status);
}

function MoveButtons({ sourceId, status, title }: { sourceId: number; status: string; title: string }) {
  const qc = useQueryClient();
  const [pressed, setPressed] = useState<To | null>(null);
  const move = useMutation({
    mutationFn: (to: To) => moveSourceByEditor({ data: { id: sourceId, to } }),
    onSuccess: (answer) => {
      if (answer.ok) void qc.invalidateQueries({ queryKey: ["source-scores"] });
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
          ariaLabel={`${BUTTON_WORDS[to]}: ${title}`}
          onAct={() => {
            setPressed(to);
            move.mutate(to);
          }}
        >
          {BUTTON_WORDS[to]}
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

export function SourceMovesPanel() {
  const { formatListDateTime } = usePaperDateFormatters();
  const { data, error, isPending } = useQuery({
    queryKey: ["source-scores"],
    queryFn: () => getSourceScores(),
  });
  if (isPending) return <p className="py-3">Loading the source list…</p>;
  if (error || !data) return <p className="py-3" role="alert">The source list could not be loaded.</p>;
  const { counts, moves, rows } = data;

  return (
    <section className="source-moves" aria-label="Sources that update themselves">
      <SecHead
        title="Sources that update themselves"
        count={counts.accepted + counts.trial + counts.dormant}
        sub="New sites are tried, kept or dropped, and quiet sources are checked less often, without you. Any move can be changed with one click."
      />
      <div className="flex flex-wrap gap-6 py-3">
        <span><strong>{counts.accepted}</strong> read by the scan</span>
        <span><strong>{counts.trial}</strong> on trial</span>
        <span><strong>{counts.dormant}</strong> dormant</span>
        <span><strong>{counts.suggestedSites}</strong> suggested sites waiting</span>
      </div>

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

      <h3 className="pt-4 pb-2 font-bold">Sources by news score (last 90 days)</h3>
      <div className="overflow-x-auto pb-6">
        <table className="source-scores w-full border-collapse">
          <thead>
            <tr className="border-b border-ink text-left">
              <th className="p-2">Source</th>
              <th className="p-2">Status</th>
              <th className="p-2">Score</th>
              <th className="p-2">Leads / published</th>
              <th className="p-2">Reads</th>
              <th className="p-2">How often</th>
              <th className="p-2">Next read</th>
              <th className="p-2">Change it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-rule align-top">
                <td className="p-2" data-label="Source">
                  <a href={row.url} target="_blank" rel="noreferrer" className="underline">
                    {row.title || row.url}
                  </a>
                </td>
                <td className="p-2" data-label="Status">
                  {STATUS_WORDS[row.status] ?? row.status}
                  {row.status === "trial" ? ` (${row.trialReads} of 6 reads)` : ""}
                </td>
                <td className="p-2" data-label="Score">
                  {row.score == null ? "Not enough reads" : row.score.toFixed(2)}
                </td>
                <td className="p-2" data-label="Leads / published">
                  {row.leads90} / {row.published90}
                </td>
                <td className="p-2" data-label="Reads">{row.reads90}</td>
                <td className="p-2" data-label="How often">{daysOrRhythm(row)}</td>
                <td className="p-2" data-label="Next read">
                  {row.status === "accepted" ? (row.nextDueAt ? formatListDateTime(row.nextDueAt) : "Due now") : row.status === "trial" ? "Within 4 hours" : "Monthly check"}
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
