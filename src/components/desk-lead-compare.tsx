import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Chip, InkButton } from "@/components/desk-chrome";
import { Notice } from "@/components/states";
import { parseUrlList } from "@/lib/paper";
import {
  COMPARE_CURRENT_LABEL,
  COMPARE_HEADING,
  COMPARE_NO_ANSWER,
  COMPARE_PRIOR_LABEL,
  comparePressNote,
  KILLED_LEAD_HEADING,
  killRecordLine,
  KILL_THIS_ONE_LABEL,
  MOVE_TO_NEW_LABEL,
  REOPEN_LABEL,
  REOPEN_PRIOR_LABEL,
} from "@/lib/news/desk-copy";

/**
 * Unit AK items 5 and 6 (2026-09-26): what an editor sees when the scanner
 * says "this story may already be here".
 *
 * The owner's complaint: a "POSSIBLE DUPLICATE · COMPARE" link opened the
 * other lead's page, which knew nothing about the pair and said only "This
 * lead was killed. Nothing to draft." -- so the comparison the desk offered
 * did not exist, and the killed lead could not be read or reopened.
 *
 * This panel is the comparison: both leads side by side, the same six facts
 * for each (headline, why, sources, dates, status, kill record), and one press
 * per decision an editor can reach after reading them. Every press reports
 * itself, because a press that does nothing visible is the same failure the
 * link had.
 */
export type CompareSide = {
  id: number;
  headline: string;
  why?: string | null;
  status: string;
  source_urls?: string | null;
  created_at?: string | null;
  kill_reason?: string | null;
  kill_reason_url?: string | null;
  killed_at?: string | null;
};

/** What a press reports back. `false` means it did not land, and the panel
 * says so in the editor's words rather than the server's. */
export type CompareResult = { ok: boolean; error?: string };

export function LeadComparePanel({
  current,
  prior,
  onNotADuplicate,
  onKillThis,
  onReopenPrior,
  formatDate,
}: {
  current: CompareSide;
  prior: CompareSide;
  onNotADuplicate?: () => Promise<CompareResult>;
  onKillThis?: () => Promise<CompareResult>;
  onReopenPrior?: () => Promise<CompareResult>;
  /** The paper's own date formatter, passed in so the panel renders the same
   * dates as the rest of the desk and can be rendered in a test without the
   * paper-date context. */
  formatDate: (value: string | null | undefined) => string;
}) {
  const [busy, setBusy] = useState<"" | "not-a-duplicate" | "kill" | "reopen">("");
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const run = (
    which: "not-a-duplicate" | "kill" | "reopen",
    press: (() => Promise<CompareResult>) | undefined,
  ) => {
    if (!press || busy) return;
    setBusy(which);
    setNote(null);
    void press().then(
      (res) => {
        setBusy("");
        setNote(comparePressNote(which, res, { current, prior }));
      },
      () => {
        setBusy("");
        setNote(comparePressNote(which, undefined, { current, prior }));
      },
    );
  };

  const priorIsKilled = prior.status === "killed";
  return (
    <section className="lead-compare" aria-labelledby="lead-compare-heading">
      <div className="lead-compare-head">
        <div>
          <p className="kick">Possible duplicate</p>
          <h2 id="lead-compare-heading">{COMPARE_HEADING}</h2>
        </div>
      </div>
      <div className="lead-compare-sides">
        <CompareSideView side={current} label={COMPARE_CURRENT_LABEL} formatDate={formatDate} />
        <CompareSideView
          side={prior}
          label={COMPARE_PRIOR_LABEL}
          formatDate={formatDate}
          killedRecord
        />
      </div>
      <div className="lead-compare-actions">
        <InkButton
          tone="quiet"
          disabled={!onNotADuplicate || busy !== ""}
          onClick={() => run("not-a-duplicate", onNotADuplicate)}
          ariaLabel={`${MOVE_TO_NEW_LABEL}: ${current.headline}`}
        >
          {busy === "not-a-duplicate" ? "Saving…" : MOVE_TO_NEW_LABEL}
        </InkButton>
        {current.status !== "killed" && current.status !== "published" && onKillThis ? (
          <InkButton
            tone="quiet-danger"
            disabled={busy !== ""}
            onClick={() => run("kill", onKillThis)}
            ariaLabel={`${KILL_THIS_ONE_LABEL}: ${current.headline}`}
          >
            {busy === "kill" ? "Saving…" : KILL_THIS_ONE_LABEL}
          </InkButton>
        ) : null}
        {onReopenPrior ? (
          <InkButton
            tone="quiet"
            disabled={busy !== "" || !priorIsKilled}
            onClick={() => run("reopen", onReopenPrior)}
            ariaLabel={`${REOPEN_PRIOR_LABEL}: ${prior.headline}`}
          >
            {busy === "reopen" ? "Saving…" : REOPEN_PRIOR_LABEL}
          </InkButton>
        ) : null}
        {onReopenPrior && !priorIsKilled ? (
          <span className="meta">
            Reopening is for a killed lead; this one is {prior.status}.
          </span>
        ) : null}
      </div>
      {note ? (
        <Notice kind={note.kind}>
          <span role="status">{note.text}</span>
        </Notice>
      ) : null}
    </section>
  );
}

function CompareSideView({
  side,
  label,
  formatDate,
  killedRecord = false,
}: {
  side: CompareSide;
  label: string;
  formatDate: (value: string | null | undefined) => string;
  killedRecord?: boolean;
}) {
  const sources = parseUrlList(side.source_urls);
  return (
    <article className="lead-compare-side">
      <p className="kick">{label}</p>
      <h3 className="lead-compare-headline">
        <Link to="/desk/story/$leadId" params={{ leadId: String(side.id) }} className="hl-link">
          {side.headline}
        </Link>
      </h3>
      <p className="meta">
        <Chip s={side.status} />
        {side.created_at ? <> · filed {formatDate(side.created_at)}</> : null}
      </p>
      <p className="lead-compare-why">{side.why?.trim() || "No why was recorded for this lead."}</p>
      {sources.length ? (
        <ul className="lead-compare-sources">
          {sources.map((url) => (
            <li key={url}>
              <a href={url} className="inline-link" rel="noreferrer noopener" target="_blank">
                {url}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">No sources are recorded for this lead.</p>
      )}
      {killedRecord && side.status === "killed" ? (
        <>
          <p className="lead-compare-kill" role="note">
            {killRecordLine({ killedAt: side.killed_at, reason: side.kill_reason })}
          </p>
          {side.kill_reason_url ? (
            <p className="meta">
              <a href={side.kill_reason_url} className="inline-link" rel="noreferrer noopener" target="_blank">
                The piece it was killed against
              </a>
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

/**
 * Unit AK item 6: a killed lead's page, instead of "This lead was killed.
 * Nothing to draft." It shows what the lead was -- headline, why, sources --
 * and when and why it was killed, and offers the way back.
 *
 * `reopened` is the same record after the Compare view's "Newer facts" press:
 * the kill is not erased, it is marked undone (`killRecordLine`), because a
 * page that silently forgets a kill is the hidden state this unit is about.
 */
export function KilledLeadRecord({
  lead,
  reopened = false,
  onReopen,
  formatDate,
}: {
  lead: CompareSide;
  reopened?: boolean;
  onReopen?: () => Promise<CompareResult>;
  formatDate: (value: string | null | undefined) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sources = parseUrlList(lead.source_urls);
  return (
    <section className="lead-killed-record" aria-labelledby="lead-killed-heading">
      <h2 id="lead-killed-heading" className="lead-compare-headline">
        {KILLED_LEAD_HEADING}
      </h2>
      <p className="meta">
        <Chip s={lead.status} />
        {lead.created_at ? <> · filed {formatDate(lead.created_at)}</> : null}
      </p>
      <p className="lead-compare-why">{lead.why?.trim() || "No why was recorded for this lead."}</p>
      {sources.length ? (
        <ul className="lead-compare-sources">
          {sources.map((url) => (
            <li key={url}>
              <a href={url} className="inline-link" rel="noreferrer noopener" target="_blank">
                {url}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">No sources are recorded for this lead.</p>
      )}
      <p className="lead-compare-kill" role="note">
        {killRecordLine({
          killedAt: lead.killed_at,
          reason: lead.kill_reason,
          reopened,
        })}
      </p>
      {onReopen ? (
        <div className="lead-compare-actions">
          <InkButton
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void onReopen().then(
                (res) => {
                  setBusy(false);
                  if (!res?.ok) setError(res?.error || COMPARE_NO_ANSWER);
                },
                () => {
                  setBusy(false);
                  setError(COMPARE_NO_ANSWER);
                },
              );
            }}
            ariaLabel={`${REOPEN_LABEL} ${lead.headline}`}
          >
            {busy ? "Reopening…" : REOPEN_LABEL}
          </InkButton>
          {error ? (
            <Notice kind="err">
              <span role="status">{error}</span>
            </Notice>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
