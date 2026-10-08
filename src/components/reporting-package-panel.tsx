import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePaper } from "@/lib/paper-context-state";
import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { Field } from "@/components/desk-chrome";
import { Notice } from "@/components/states";
import { invalidateDeskJobs } from "@/components/job-card-state";
import type { CurrentReportingDocumentChecks } from "@/lib/news/reporting-document-check";
import { assertHttpUrl } from "@/lib/news/url-guard";
import {
  answerReportingFollowUp,
  loadLeadReportingPackage,
  listReportingObservations,
  saveReportingCorrection,
} from "@/lib/news/desk";
import {
  SCORE_COMPONENTS,
  actionEvidenceLine,
  claimBadge,
  hasReportingPackage,
  heldLine,
  methodLine,
  packageGaps,
  reportingNotice,
  reportingPackageHistory,
  reportingRunState,
} from "@/lib/news/reporting-package-view";
import type { PackageSource, ReportingPackage } from "@/lib/news/civic-reporting";

type EarlierReportingPackage = { requestId: number; createdAt: string; pkg: ReportingPackage };

/*
  The structured reporting package, drawn BESIDE the editable copy.

  WHAT THIS IS. When an editor presses Report this meeting or Develop this
  lead, the runner runs the installed civic-scanner method and files a
  ReportingPackage (civic-reporting.ts): the coverage ledger, the claim/source
  ledger with real locators, the four-part score, the readiness tier, the
  explicit unknowns and the run receipt. This panel is where an editor reads
  that package next to the draft it produced, and where the follow-up, the
  correction and the run monitoring live.

  WHAT IT MUST NOT DO. It must not present a COMPLETE run as published-ready
  (the coverage gate is about the RECORD, not the copy), it must not re-upgrade
  a claim the parser left UNVERIFIED, and it must not invent a locator. Every
  honesty rule lives in reporting-package-view.ts so it is unit-testable; this
  component only draws what those functions return.

  A FOLLOW-UP IS A NEW RUN. The follow-up box asks for TARGETED work and sends
  it as a new request whose parent is this run (answerReportingFollowUp). It
  never edits this draft, these notes or the checked states -- the runner files
  its result as a new version. Nothing here auto-submits: the editor writes the
  ask and presses the button.
*/
export function ReportingPackagePanel({ leadId }: { leadId: number }) {
  const qc = useQueryClient();
  const { timezone } = usePaper();
  const query = useQuery({
    queryKey: ["reporting-package", leadId],
    queryFn: () => loadLeadReportingPackage({ data: { leadId } }),
    refetchInterval: (state) => state.state.data?.latestRun?.status === "PENDING" ? 2000 : false,
    refetchIntervalInBackground: true,
  });
  /*
    The kept records are scoped to THIS assignment, not the whole newsroom.

    WHAT WAS WRONG. The query ran unscoped ("reporting-observations"), so the
    server returned the newest observations for the entire paper and every
    story drew the same unrelated editor corrections. A correction filed
    against one lead leaked onto every other lead.

    WHAT IT DOES NOW. The package read already tells us which request filed
    this lead; the request carries the run's seed sources. The observations
    query is keyed by lead + request + seeds and only runs once that scope is
    known (from the package read), so the key and the request always agree and
    a lead with no package yet still scopes by its own lead id.
  */
  const scope = query.data;
  const observations = useQuery({
    queryKey: [
      "reporting-observations",
      leadId,
      scope?.requestId ?? null,
      (scope?.seedUrls ?? []).join(" "),
    ],
    queryFn: () =>
      listReportingObservations({
        data: {
          leadId,
          requestId: scope?.requestId ?? undefined,
          seedUrls: scope?.seedUrls ?? undefined,
        },
      }),
    staleTime: 30_000,
  });
  if (query.isPending) {
    return (
      <section className="reporting-package" aria-label="Reporting package">
        <h2>Reporting package</h2>
        <p className="meta">Loading the reporting package for this lead...</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <section className="reporting-package" aria-label="Reporting package">
        <h2>Reporting package</h2>
        <Notice kind="err">The reporting package for this lead could not be read.</Notice>
      </section>
    );
  }
  const row = query.data;
  if (!row || !hasReportingPackage(row.pkg)) {
    return (
      <section className="reporting-package" aria-label="Reporting package">
        <h2>Reporting package</h2>
        {row?.latestRun ? (() => {
          const state = reportingRunState(row.latestRun, timezone);
          return <Notice kind={state.tone}><p>{state.label}</p><p>{state.detail}</p></Notice>;
        })() : null}
        <p className="meta">
          No reporting run has filed a package for this lead yet. Use Report this
          meeting or Develop this lead to start one.
        </p>
      </section>
    );
  }
  const history = reportingPackageHistory({ requestId: row.requestId, pkg: row.pkg }, row.earlierPackages ?? []);
  return (
    <>
    {row.latestRun && row.latestRun.requestId !== row.requestId ? (
      <Notice kind={row.latestRun.status === "FAILED" ? "err" : "ok"}>
        {reportingRunState(row.latestRun, timezone).label} {reportingRunState(row.latestRun, timezone).detail}
        {" "}Your earlier draft and package are still here.
      </Notice>
    ) : null}
    <button type="button" className="inline-link" disabled={query.isFetching} onClick={() => {
      void query.refetch();
      void qc.invalidateQueries({ queryKey: ["finding-evidence-review", leadId] });
    }}>Recheck saved evidence</button>
    <p className="meta">Checks the filed claims against retained documents; keeps your copy, original report and evidence judgments.</p>
    <PackageBody
      leadId={leadId}
      requestId={row.requestId}
      latestStatus={row.latestRun?.status}
      draftId={row.draftId ?? null}
      report={history.current.pkg}
      earlierPackages={history.earlier}
      currentDocumentChecks={row.currentDocumentChecks ?? {}}
      storyLeads={row.storyLeads ?? []}
      observations={observations.data ?? []}
      onRefresh={() => {
        void qc.invalidateQueries({ queryKey: ["reporting-package", leadId] });
        void qc.invalidateQueries({ queryKey: ["reporting-observations", leadId] });
      }}
    />
    </>
  );
}

function PackageBody({
  leadId,
  requestId,
  latestStatus,
  draftId,
  report,
  earlierPackages,
  currentDocumentChecks,
  storyLeads,
  observations,
  onRefresh,
}: {
  leadId: number;
  requestId: number;
  latestStatus: string | undefined;
  draftId: number | null;
  report: ReportingPackage;
  earlierPackages: EarlierReportingPackage[];
  currentDocumentChecks: CurrentReportingDocumentChecks;
  /**
   * Where each story landed, from the runner's own job result. A story the
   * runner could not file has no entry, so the packet draws no link rather than
   * a wrong one.
   */
  storyLeads: { storyId: string; leadId: number; draftId: number | null }[];
  observations: ObservationRow[];
  onRefresh: () => void;
}) {
  const run = reportingRunState(report);
  const gaps = packageGaps(report);
  return (
    <section className="reporting-package" aria-label="Reporting package">
      <header className="reporting-package-head">
        <h2>Reporting package</h2>
        <p className="meta">{methodLine(report)}</p>
      </header>
      <div className={`reporting-run reporting-run-${run.tone}`} role="status">
        <strong>{run.label}</strong>
        <p className="meta">{run.detail}</p>
      </div>
      {report.stories.length > 1 ? (
        <nav className="reporting-story-links" aria-label="Stories in this package">
          <p className="side-label">This run returned {report.stories.length} stories</p>
          <ul>
            {report.stories.map((story) => (
              <li key={story.id}>
                <a href={`#reporting-story-${story.id}`} className="inline-link">
                  {story.headline || "Untitled"}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <StoryPackets report={report} storyLeads={storyLeads} currentDocumentChecks={currentDocumentChecks} />
      <CoverageLedger report={report} />
      {gaps.length ? (
        <section className="reporting-gaps" aria-label="What this package does not settle">
          <h3>What this package does not settle</h3>
          <ul>
            {gaps.map((gap, i) => (
              <li key={i}>{gap}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.held.length ? (
        <section className="reporting-held" aria-label="Held possibilities">
          <h3>Held for later</h3>
          <ul>
            {report.held.map((held, index) => (
              <li key={`${held.storyId}-${index}`}>
                <strong>{heldLine(held)}</strong> - {held.reason}
                {held.nextCheck ? <span className="meta"> Next: {held.nextCheck}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {draftId ? (
        <p className="meta">
          Open the saved version to compare with your current draft:
          {" "}
          <Link to="/desk/filed-draft/$draftId" params={{ draftId: String(draftId) }} className="inline-link">
            Open the draft this run filed
          </Link>
          .
        </p>
      ) : <p className="meta">This run filed no draft</p>}
      <ScoreAndReceipt report={report} />
      <FollowUpBox requestId={requestId} latestStatus={latestStatus} onRefresh={onRefresh} />
      <CorrectionBox leadId={leadId} requestId={requestId} onRefresh={onRefresh} />
      <ObservationsList observations={observations} />
      {earlierPackages.length ? (
        <details className="reporting-earlier">
          <summary>Earlier</summary>
          <ol>
            {earlierPackages.map((entry) => (
              <li key={entry.requestId}>
                <h3>Package from {new Date(entry.createdAt).toLocaleString()}</h3>
                {entry.pkg.stories.map((story) => (
                  <div key={story.id}>
                    <h4>{story.headline || "Untitled"}</h4>
                    {story.plainBrief ? <p>{story.plainBrief}</p> : null}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

/*
  The four-part score, drawn in the drawing own four words. A null score is
  drawn as not-scored: a zero here is not-measured, not measured-at-zero.
*/
function ScoreAndReceipt({ report }: { report: ReportingPackage }) {
  if (!report.score) return null;
  const score = report.score;
  return (
    <section className="reporting-score" aria-label="Why this matters">
      <h3>Why it matters</h3>
      <ul className="reporting-score-list">
        {SCORE_COMPONENTS.map((component) => (
          <li key={component.key}>
            {component.label}: {score[component.key]}
          </li>
        ))}
      </ul>
      <p className="meta">{score.whyItMatters}</p>
    </section>
  );
}

/*
  The returned stories, each with ITS OWN claims and sources. The method makes
  the ledger travel with the story, so this is per-packet. Each packet is
  anchored by id so the multi-story link list above lands on it, and each
  carries an Open link into the story the runner created when it names one.
*/
function StoryPackets({
  report,
  storyLeads,
  currentDocumentChecks,
}: {
  report: ReportingPackage;
  currentDocumentChecks: CurrentReportingDocumentChecks;
  storyLeads: { storyId: string; leadId: number; draftId: number | null }[];
}) {
  return (
    <section className="reporting-stories" aria-label="Stories in this package">
      <h3>Stories from this run</h3>
      {report.stories.length === 0 ? (
        <p className="meta">The run filed no story. See the gaps above for why.</p>
      ) : (
        <ol className="reporting-story-list">
          {report.stories.map((story) => {
            const filed = storyLeads.find((link) => link.storyId === story.id) ?? null;
            return (
            <li id={`reporting-story-${story.id}`} key={story.id} className="reporting-story">
              <h4>{story.headline || "Untitled"}</h4>
              {story.plainBrief ? <p className="reporting-brief">{story.plainBrief}</p> : null}
              {filed ? (
                <p>
                  <Link to="/desk/story/$leadId" params={{ leadId: String(filed.leadId) }} className="inline-link">
                    Open this story
                  </Link>
                </p>
              ) : null}
              <details className="reporting-claims">
                <summary>{story.claims.length} claim{story.claims.length === 1 ? "" : "s"} and {story.sources.length} source{story.sources.length === 1 ? "" : "s"}</summary>
                <ul className="reporting-claim-list">
                  {story.claims.map((claim) => {
                    const badge = claimBadge(claim, story);
                    const currentCheck = currentDocumentChecks[story.id]?.[claim.id];
                    return (
                      <li key={claim.id} className={`claim claim-${badge.tone}`}>
                        <p>{claim.text}</p>
                        <p className="meta">
                          <strong>Recorded reporter status: {badge.status}</strong>{badge.note ? ` - ${badge.note}` : ""}
                        </p>
                        {currentCheck ? <div className="meta">
                          <p><strong>Current saved-document check: {currentCheck.status ?? "Unavailable"}</strong></p>
                          <p>{currentCheck.note}</p>
                          <p>This checks the filed claim, separately from your current copy and evidence judgment.</p>
                          {currentCheck.references.map((reference, index) => <p key={`${reference.id}:${index}`}>{reference.title}: {reference.locator || "Locator unresolved"}</p>)}
                        </div> : null}
                        {claim.sourceIds.length ? (
                          <ul className="reporting-claim-sources">
                            {claim.sourceIds.map((id) => {
                              const source = story.sources.find((s) => s.id === id);
                              if (!source) return null;
                              const href = publicSourceHref(source.url);
                              const locator = sourceLocatorText(source, Boolean(href));
                              return (
                                <li key={id}>
                                  <span className="chip">Tier {source.tier}</span> {source.title}
                                  {href ? (
                                    <> - <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-link"
                                      aria-label={`Open source: ${source.title}`}
                                    >Open source ↗</a></>
                                  ) : null}
                                  {locator ? (
                                    <> - <span className="meta">{locator}</span></>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="meta">No source in this package is attached to this claim yet.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {story.cannotSay ? (
                  <p className="meta">This story cannot yet say: {story.cannotSay}</p>
                ) : null}
              </details>
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** A package link is active only when its recorded URL is a public HTTP(S) URL. */
function publicSourceHref(raw: string): string | null {
  if (!raw.trim()) return null;
  try {
    const url = assertHttpUrl(raw);
    if (url.username || url.password) return null;
    // Keep the complete URL, including query/fragment timestamp locators.
    return url.toString();
  } catch {
    return null;
  }
}

/** Keep raw invalid URLs and all offline qualification visible as plain text. */
function sourceLocatorText(source: PackageSource, hasPublicLink: boolean): string {
  return [
    !hasPublicLink ? source.url : "",
    source.locator,
    source.offlineReference,
  ].filter(Boolean).join(" | ");
}

/*
  The full action ledger: every substantive action the record shows, with its
  evidence locator and the disposition the run recorded. A row with no
  disposition is drawn in the warning colour and says so, because an
  undispositioned action is the gap the coverage gate is about.
*/
function CoverageLedger({ report }: { report: ReportingPackage }) {
  if (report.actions.length === 0) {
    return (
      <section className="reporting-ledger" aria-label="Action ledger">
        <h3>Action ledger</h3>
        <p className="meta">
          The run filed no coverage ledger. Nothing was read from the record, so
          there is nothing here to check.
        </p>
      </section>
    );
  }
  return (
    <section className="reporting-ledger" aria-label="Action ledger">
      <h3>Action ledger ({report.actions.length})</h3>
      <details className="reporting-ledger-details">
        <summary>Show all {report.actions.length} meeting actions</summary>
        <table className="reporting-ledger-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Item</th>
              <th scope="col">Action</th>
              <th scope="col">Outcome</th>
              <th scope="col">Vote</th>
              <th scope="col">Evidence and disposition</th>
            </tr>
          </thead>
          <tbody>
            {report.actions.map((action, index) => {
              const settled = action.disposition.trim().length > 0;
              return (
                <tr key={`${action.actionId}-${index}`} className={settled ? "" : "ledger-gap"}>
                  <td>{action.timestamp}</td>
                  <td>{action.agendaItem}</td>
                  <td>{action.motionOrAction}</td>
                  <td>{action.outcome}</td>
                  <td>{action.vote}</td>
                  <td>
                    {actionEvidenceLine(action) || "No evidence or disposition recorded."}
                    {!settled ? <strong className="ledger-flag"> Needs a disposition</strong> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
      {report.meetingCoverage.map((coverage) => (
        <p key={`${coverage.body}-${coverage.date}`} className="meta">
          {coverage.body} - {coverage.date} - {coverage.coverageStatus}
          {coverage.recordingUrl ? (
            <> - <a href={coverage.recordingUrl} target="_blank" rel="noreferrer" className="inline-link">recording</a></>
          ) : null}
          {coverage.gaps ? ` - gaps: ${coverage.gaps}` : ""}
        </p>
      ))}
    </section>
  );
}

/**
  One saved observation, as `relevantReportingObservations` returns it: scoped
  to this lead/request/seeds and carrying where it came from. `createdAt` is the
  stored timestamp; `observedOn` is the day a source observation was observed
  (null for a reporting observation). The UI prints whichever the row actually
  has, so no date is invented.
*/
type ObservationRow = {
  kind: string;
  text: string;
  evidence: string;
  createdAt: string;
  observedOn: string | null;
  scope: string[];
};

/*
  The follow-up box. It asks for TARGETED work and starts a NEW run whose
  parent is this one. It never touches the draft, the notes or the checked
  states -- the runner files its result as a new version, and the existing
  draft stays where it is until a new one lands.
*/
function FollowUpBox({ requestId, latestStatus, onRefresh }: { requestId: number; latestStatus: string | undefined; onRefresh: () => void }) {
  const qc = useQueryClient();
  const [ask, setAsk] = useState("");
  const [seeds, setSeeds] = useState("");
  const follow = useMutation({
    mutationFn: () =>
      answerReportingFollowUp({
        data: { parentRequestId: requestId, assignment: ask.trim(), seedUrls: seeds.trim() || undefined },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setAsk("");
        setSeeds("");
        invalidateDeskJobs(qc);
        void qc.invalidateQueries({ queryKey: ["desk-jobs"] });
      }
      onRefresh();
    },
  });
  const refused = follow.data && !follow.data.ok ? follow.data.error : null;
  return (
    <section className="reporting-follow-up" aria-label="Ask for more reporting">
      <h3>Ask for more reporting</h3>
      <p className="meta">
        A follow-up is a new run. It keeps this draft, your notes and your checked
        states exactly as they are, and files whatever it finds as a new version.
      </p>
      <Field label="What to find out next" hint="One thing, specifically. This is the ask that goes to the next run.">
        <textarea
          rows={3}
          value={ask}
          maxLength={4000}
          disabled={follow.isPending}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="For example: Get the exact vote tally for Ordinance 2026-57 and who recorded it."
        />
      </Field>
      <Field label="Sources to start from" hint="Optional. One public link per line.">
        <textarea
          rows={2}
          value={seeds}
          maxLength={20000}
          disabled={follow.isPending}
          onChange={(e) => setSeeds(e.target.value)}
        />
      </Field>
      <ActionButton
        tone="secondary"
        phase={follow.isPending ? "working" : "idle"}
        workingLabel="Starting..."
        disabled={follow.isPending || ask.trim().length === 0}
        disabledReason={ask.trim().length === 0 ? "Write what to find out next first." : null}
        onAct={() => follow.mutate()}
      >
        Start a follow-up run
      </ActionButton>
      {reportingNotice(follow.data, latestStatus) === "started" ? (
        <Notice kind="ok">A new reporting run was started. Watch its progress under Running.</Notice>
      ) : null}
      {refused ? <Notice kind="warn">{refused}</Notice> : null}
      {follow.isError ? <Notice kind="err">The follow-up did not start.</Notice> : null}
    </section>
  );
}

/*
  The editor's dated, sourced correction or disposition. Scope and evidence are
  REQUIRED: a note with no source is not a record, and this changes nothing
  about the model own prompts -- it records what the editor decided, dated,
  so the next relevant assignment can retrieve it.
*/
function CorrectionBox({
  leadId,
  requestId,
  onRefresh,
}: {
  leadId: number;
  requestId: number;
  onRefresh: () => void;
}) {
  const [kind, setKind] = useState<"correction" | "disposition" | "source">("correction");
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("");
  const save = useMutation({
    mutationFn: () =>
      saveReportingCorrection({
        data: { leadId, requestId, kind, text: text.trim(), evidence: evidence.trim() },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setText("");
        setEvidence("");
        onRefresh();
      }
    },
  });
  const refused = save.data && !save.data.ok ? save.data.error : null;
  const ready = text.trim().length > 0 && evidence.trim().length > 0;
  return (
    <section className="reporting-correction" aria-label="Record a correction or disposition">
      <h3>Record a correction or disposition</h3>
      <p className="meta">
        Dated and sourced, kept for the next relevant assignment. This does not
        change the story or any model instructions.
      </p>
      <Field label="What to record">
        <select value={kind} disabled={save.isPending} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="correction">A correction</option>
          <option value="disposition">A disposition (what was decided)</option>
          <option value="source">A source note</option>
        </select>
      </Field>
      <Field label="Your note" hint="Required. What should the next run know?">
        <textarea
          rows={3}
          value={text}
          maxLength={4000}
          disabled={save.isPending}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <Field label="Evidence" hint="Required. A public link or an honest offline reference for where this comes from.">
        <textarea
          rows={2}
          value={evidence}
          maxLength={4000}
          disabled={save.isPending}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </Field>
      <ActionButton
        tone="secondary"
        phase={save.isPending ? "working" : save.data?.ok ? "done" : "idle"}
        workingLabel="Saving..."
        doneLabel="Saved"
        disabled={save.isPending || !ready}
        disabledReason={!ready ? "A note and a source are both required." : null}
        onAct={() => save.mutate()}
      >
        Save this record
      </ActionButton>
      {refused ? <Notice kind="warn">{refused}</Notice> : null}
      {save.isError ? <Notice kind="err">That record did not save.</Notice> : null}
    </section>
  );
}

/*
  The records kept for THIS assignment, so an editor can see what a next run
  on this lead/request/seeds will find. The list is already scoped by the
  server; this only draws it. Each row names why it is here (its scope) and
  dates itself with the day it was observed when the row has one, otherwise
  with the day it was saved.
*/
function ObservationsList({ observations }: { observations: ObservationRow[] }) {
  if (observations.length === 0) return null;
  return (
    <section className="reporting-observations" aria-label="Records kept for the next assignment">
      <h3>Kept for the next assignment</h3>
      <ul>
        {observations.map((row, i) => (
          <li key={i}>
            <strong>{row.kind}</strong> - {row.text}
            <span className="meta">
              {" "}
              - {row.evidence} - {observationDate(row)}
              {row.scope.length ? ` (${row.scope.join(", ")})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The day to print for a kept record: the observed day if it has one. */
function observationDate(row: ObservationRow): string {
  return row.observedOn || row.createdAt;
}
