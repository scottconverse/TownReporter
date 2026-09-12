import { DraftScopePicker } from "@/components/draft-scope-picker";
import { useEditorSections } from "@/lib/use-sections";
import { StoryDocumentUpload, type StoryUpload } from "@/components/story-documents";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { firstRunSetupState } from "@/lib/news/paper-settings";
import { Busy, InkButton, SecHead, areaClass, announceToDesk } from "@/components/desk-chrome";
import { LeadRowView } from "@/components/desk-leads";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  dropFollowUp,
  listFollowUps,
  listLeads,
  listRecentStoryWork,
  listMemory,
  listPublishedDesk,
  listScans,
  listSources,
  nudgeFollowUp,
  recordFollowUpReply,
  runScan,
  setLeadStatus,
  setSourceStatus,
  writeStoryFromInput,
} from "@/lib/news/desk";
import { FollowUpItem } from "@/components/follow-up-item";
import { listInvestigations, listWorthALook, openDarkInvestigation } from "@/lib/news/dark";
import {
  editorKindLabel,
  editorDraftError,
  editorFetchError,
  editorScanError,
  editorStatus,
  flakyFailureCopy,
  followUpsRailCopy,
  investigationStopKind,
  nearDuplicate,
  openLeads,
  pileForStatus,
  scanCountsLine,
  scanZeroWhy,
  sourceErrorKind,
  workingQueueEmptyCopy,
  worthItemOnDesk,
} from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context";
import { ModelPicker } from "@/components/model-picker";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";

export const Route = createFileRoute("/desk/")({ component: DeskHome });

const OPEN_KEY = "townreporter.dark.openId";

function DeskHome() {
  const sectionQuery = useEditorSections();
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  const qc = useQueryClient();
  const navigate = useNavigate();
  /*
    CITY-SETUP final slice: the owner sees the first-run setup screen
    exactly once, right after claiming a fresh desk. `needsSetup` goes
    false the moment completeFirstRunSetup runs (see paper-settings.ts) and
    stays false, so re-visiting the desk later never redirects again --
    only the Server page's "Paper setup" section reaches /desk/setup after
    that, on purpose.
  */
  const setupState = useQuery({
    queryKey: ["first-run-setup"],
    queryFn: () => firstRunSetupState(),
  });
  useEffect(() => {
    if (setupState.data?.needsSetup) {
      void navigate({ to: "/desk/setup" });
    }
  }, [setupState.data, navigate]);

  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
  const recentStories = useQuery({
    queryKey: ["recent-story-work"],
    queryFn: () => listRecentStoryWork(),
    refetchInterval: 5000,
  });
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const scans = useQuery({
    queryKey: ["scans"],
    queryFn: () => listScans(),
    refetchInterval: (q) => {
      const row = q.state.data?.[0];
      if (row && !row.finished_at && !row.error) return 2000;
      return false;
    },
  });
  const investigations = useQuery({
    queryKey: ["investigations"],
    queryFn: () => listInvestigations(),
  });
  const worth = useQuery({ queryKey: ["worth-a-look"], queryFn: () => listWorthALook() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  const followUps = useQuery({
    queryKey: ["follow-ups", "open"],
    queryFn: () => listFollowUps({ data: { status: "open" } }),
  });
  const replyFollowUp = useMutation({
    mutationFn: (input: { id: number; replyText: string; repliedOn: string }) =>
      recordFollowUpReply({ data: input }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk(
        res?.ok
          ? "Reply recorded."
          : (res && "error" in res && res.error) || "Could not save that reply.",
      );
    },
  });
  const nudgeFollow = useMutation({
    mutationFn: (id: number) => nudgeFollowUp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk("Nudge stamped.");
    },
  });
  const dropFollow = useMutation({
    mutationFn: (id: number) => dropFollowUp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk("Follow-up dropped.");
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "held" | "killed" | "new" }) =>
      setLeadStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const srcStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" }) =>
      setSourceStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
  const scan = useMutation({
    mutationFn: () => runScan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const [darkErr, setDarkErr] = useState<string | null>(null);
  const startDark = useMutation({
    mutationFn: (item: { seed: string; title: string }) =>
      openDarkInvestigation({ data: { paste: item.seed, title: item.title } }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        setDarkErr(null);
        try {
          sessionStorage.setItem(OPEN_KEY, String(res.investigationId));
          sessionStorage.setItem("townreporter.dark.autodig", String(res.investigationId));
        } catch {
          /* ignore */
        }
        void navigate({ to: "/desk/dark" });
        return;
      }
      setDarkErr(
        res && "error" in res && res.error ? String(res.error) : "Could not open that file.",
      );
    },
    onError: (err) => {
      setDarkErr(err instanceof Error ? err.message : "Could not open that file.");
    },
  });

  /*
    "Write a story" -- one box, one click, the way Opinion already works.

    Before this, the only path from a URL or an idea to a draft was Queue's
    four-field form (Headline, Why now, Topic, one Source URL) followed by a
    separate trip to the story page to paste the same text again as
    Reporting notes. That is three fields' worth of paraphrasing a link the
    editor could just paste. This box parses whatever lands in it -- see
    write-story.ts -- and files it exactly like the form does, with the full
    text kept so the draft reads it as evidence.
  */
  const [storyText, setStoryText] = useState("");
  const [storyInstructions, setStoryInstructions] = useState("");
  const storyInput = [storyInstructions.trim(), storyText.trim()].filter(Boolean).join("\n\n");
  const [storyDocuments, setStoryDocuments] = useState<StoryUpload[]>([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(false);
  const [storyScope, setStoryScope] = useState<"public" | "supplied">("public");
  const [storySection, setStorySection] = useState("");
  const [storyModel, setStoryModel] = useState<StoryModelChoice>("auto");
  const [storyNotice, setStoryNotice] = useState<{
    text: string;
    kind: "error" | "info";
    authDetail?: string | null;
  } | null>(null);
  const writeStory = useMutation({
    mutationFn: () =>
      writeStoryFromInput({
        data: {
          text: storyInput,
          documentIds: storyDocuments.map((d) => d.id),
          modelChoice: storyModel,
          researchScope: storyScope,
          sectionKey: storySection || undefined,
        },
      }),
    onSuccess: (res) => {
      if (!res?.ok) {
        const raw = res?.error ?? "That did not file.";
        setStoryNotice({ text: editorDraftError(raw) ?? raw, kind: "error", authDetail: raw });
        return;
      }
      setStoryText("");
      setStoryInstructions("");
      setStoryDocuments([]);
      setStoryNotice(null);
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void navigate({ to: "/desk/story/$leadId", params: { leadId: String(res.leadId) } });
      void qc.invalidateQueries({ queryKey: ["recent-story-work"] });
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "That did not file.";
      setStoryNotice({ text: editorDraftError(raw) ?? raw, kind: "error", authDetail: raw });
    },
  });

  const src = sources.data ?? [];
  const allLeads = leads.data ?? [];
  const queue = openLeads(allLeads).sort(
    (a, b) => (b.newsworthiness ?? 0) - (a.newsworthiness ?? 0),
  );
  const publishedCount = allLeads.filter((l) => l.status === "published").length;
  const accepted = src.filter((s) => s.status === "accepted");
  const proposed = src.filter((s) => s.status === "proposed");
  const officialFail = accepted.filter((s) => s.last_error && sourceErrorKind(s) === "official");
  const flakyFail = accepted.filter((s) => s.last_error && sourceErrorKind(s) === "flaky");
  const last = scans.data?.[0];
  const scanning = scan.isPending || Boolean(last && !last.finished_at && !last.error);
  const invs = investigations.data ?? [];
  const onDesk = invs.filter((r) => pileForStatus(r.status) === "desk");
  const aside = invs.filter((r) => pileForStatus(r.status) === "aside");
  const inbox = (worth.data ?? []).filter((item) => !worthItemOnDesk(item, invs));
  const errStops = onDesk.filter((i) => investigationStopKind(i) === "error");
  const roundStops = onDesk.filter((i) => investigationStopKind(i) === "round");
  const drafted = allLeads.filter((l) => l.status === "drafted").length;
  const scanStale =
    last?.error ||
    (last?.started_at && Date.now() - new Date(last.started_at).getTime() > 24 * 3600_000);
  const printed = published.data ?? [];

  const needs: { t: string; to: string; openDark?: number; quiet?: boolean }[] = [];
  if (drafted)
    needs.push({
      t: `${drafted} draft${drafted > 1 ? "s" : ""} ready to publish`,
      to: "/desk/queue",
    });
  if (errStops.length) {
    needs.push({
      t: `${errStops.length} Dark Desk file${errStops.length === 1 ? "" : "s"} stopped on an error — what it found is saved`,
      to: "/desk/dark",
      openDark: errStops[0]!.id,
    });
  }
  if (proposed.length) {
    needs.push({
      t: `${proposed.length} proposed source${proposed.length === 1 ? "" : "s"} await${proposed.length === 1 ? "s" : ""} review`,
      to: "/desk/sources",
    });
  }
  if (officialFail.length) {
    needs.push({
      t: `${officialFail.length} official source${officialFail.length === 1 ? "" : "s"} failing to fetch`,
      to: "/desk/sources",
    });
  }
  if (scanStale && last?.error) {
    needs.push({
      t:
        last.sources_fetched > 0
          ? "Last scan fetched sources but did not file leads"
          : "Last scan failed",
      to: "/desk/scan",
    });
  } else if (scanStale) needs.push({ t: "No scan in the last day", to: "/desk/scan", quiet: true });
  if (roundStops.length) {
    needs.push({
      t: `${roundStops.length} Dark Desk file${roundStops.length === 1 ? "" : "s"} ready for another round`,
      to: "/desk/dark",
      openDark: roundStops[0]!.id,
      quiet: true,
    });
  }

  const booting = (leads.isPending && !leads.data) || (sources.isPending && !sources.data);
  // The two queries the front page cannot render anything useful without.
  // Everything else on this page degrades gracefully to "empty"; these two
  // don't, so a failed fetch needs its own terminal state rather than an
  // infinite `booting` skeleton or a silently empty desk. Audit UIUX-02.
  const bootFailed = (leads.isError && !leads.data) || (sources.isError && !sources.data);

  return (
    <DeskShell title="A clear desk. A good story." kicker="Your newsroom">
      {recentStories.data
        ?.filter((story) => story.status === "running" || story.status === "queued")
        .map((story) => (
          <div className="desk-active-story" key={story.id}>
            <div>
              <strong>
                Your story is {story.status === "queued" ? "queued" : "being written"}
              </strong>
              <p>{story.stage || "Preparing your sources…"}</p>
            </div>
            <Link
              className="btn solid"
              to="/desk/story/$leadId"
              params={{ leadId: String(story.lead_id) }}
            >
              Open your story
            </Link>
          </div>
        ))}

      <div className="astra-metrics" aria-label="Newsroom at a glance">
        <Link to="/desk/queue">
          <strong>{drafted}</strong>
          <span>Drafts to review</span>
        </Link>
        <Link to="/desk/queue">
          <strong>{queue.length}</strong>
          <span>Leads in your queue</span>
        </Link>
        <Link to="/desk" hash="desk-followups">
          <strong>{followUps.data?.length ?? 0}</strong>
          <span>Open follow-ups</span>
        </Link>
        <Link to="/desk/published">
          <strong>{published.data?.length ?? 0}</strong>
          <span>Published stories</span>
        </Link>
      </div>
      <div className="desk-home">
        <section className="recent-story-work" aria-labelledby="recent-stories-title">
          <div className="recent-story-heading">
            <h2 id="recent-stories-title">Your recent drafts</h2>
            <Link to="/desk/queue" className="inline-link">
              View full queue
            </Link>
          </div>
          <p>Stories you start appear here. Open one to follow its progress or edit the draft.</p>
          {recentStories.isError ? (
            <p role="alert">
              Recent drafts could not load.{" "}
              <button type="button" className="btn" onClick={() => void recentStories.refetch()}>
                Try again
              </button>
            </p>
          ) : recentStories.isPending ? (
            <p role="status">Loading your drafts…</p>
          ) : !recentStories.data?.length ? (
            <p>No drafts started yet. Add your sources below to begin.</p>
          ) : (
            recentStories.data.map((story) => (
              <div className="recent-story-row" key={story.id}>
                <div>
                  <span className="recent-story-status">
                    {story.status === "completed"
                      ? "Ready to edit"
                      : story.status === "failed"
                        ? "Needs attention"
                        : story.status === "queued"
                          ? "Queued"
                          : "Writing in progress"}
                  </span>
                  <Link
                    to="/desk/story/$leadId"
                    params={{ leadId: String(story.lead_id) }}
                    className="recent-story-title"
                  >
                    {story.headline}
                  </Link>
                  <p>
                    {story.status === "completed"
                      ? "Draft saved. Review it before publishing."
                      : story.status === "failed"
                        ? "Open the story to see what stopped and resume."
                        : story.stage || "Waiting to start"}
                  </p>
                </div>
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(story.lead_id) }}
                  className="btn"
                >
                  {story.status === "running" || story.status === "queued"
                    ? "View progress"
                    : "Open draft"}
                </Link>
              </div>
            ))
          )}
        </section>

        <section
          id="story-composer"
          className="composer story-composer"
          aria-labelledby="story-composer-title"
        >
          <header className="story-composer-heading">
            <div>
              <p className="composer-eyebrow">Start a draft</p>
              <h2 id="story-composer-title">Write a story</h2>
            </div>
            <p>
              Bring your sources. Tell us the angle.
              <br />
              You review the draft before anything is published.
            </p>
          </header>
          <div className="composer-sources">
            <StoryDocumentUpload
              documents={storyDocuments}
              onChange={setStoryDocuments}
              onBusy={setUploadingDocuments}
              disabled={writeStory.isPending}
            />
            <div className="composer-pasted">
              <label htmlFor="story-source-text">Links or source text</label>
              <p>
                Paste website, PDF or YouTube links, or a full transcript. You can combine these
                with attached files.
              </p>
              <textarea
                id="story-source-text"
                className={areaClass}
                rows={6}
                value={storyText}
                disabled={writeStory.isPending}
                onChange={(e) => setStoryText(e.target.value)}
                placeholder="Paste source links or text here…"
              />
              <span className="composer-source-note">
                Original documents are saved in full. Scanned pages and images are read with OCR.
              </span>
            </div>
          </div>
          <div className="composer-instructions">
            <label htmlFor="story-instructions">What story do you want?</label>
            <span>Give an angle, a question to answer, or points to emphasize.</span>
            <textarea
              id="story-instructions"
              className={areaClass}
              rows={3}
              value={storyInstructions}
              disabled={writeStory.isPending}
              onChange={(e) => setStoryInstructions(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (
                    !writeStory.isPending &&
                    !uploadingDocuments &&
                    (storyInput.length >= 8 || storyDocuments.length)
                  )
                    writeStory.mutate();
                }
              }}
              placeholder="For example: Explain what the council decided, what it will cost, and what happens next."
            />
          </div>
          <details className="composer-options">
            <summary>
              Research & section{" "}
              <span>
                {storyScope === "public" ? "Public research enabled" : "Supplied material only"} ·{" "}
                {storySection || "Section suggested automatically"}
              </span>
            </summary>
            <div className="composer-options-grid">
              <DraftScopePicker
                value={storyScope}
                onChange={setStoryScope}
                disabled={writeStory.isPending}
              />
              <label>
                <span>Section (optional)</span>
                <select
                  value={storySection}
                  onChange={(e) => setStorySection(e.target.value)}
                  disabled={writeStory.isPending || sectionQuery.isPending}
                >
                  <option value="">Suggest from text — current default</option>
                  {sectionQuery.sections
                    .filter((s) => s.key !== "about" && s.key !== "opinion")
                    .map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  {storySection && !sectionQuery.sections.some((s) => s.key === storySection) ? (
                    <option value={storySection}>
                      Previous selection unavailable — choose again
                    </option>
                  ) : null}
                </select>
                <p>
                  {sectionQuery.isPending
                    ? "Loading sections…"
                    : sectionQuery.isError
                      ? "Sections could not load. Automatic selection is still available."
                      : "You can change the section after drafting."}
                </p>
              </label>
            </div>
          </details>
          <footer className="composer-footer">
            <ModelPicker
              scope="story"
              value={storyModel}
              onChange={setStoryModel}
              disabled={writeStory.isPending}
            />
            <div className="composer-submit">
              <InkButton
                tone="solid"
                onClick={() => writeStory.mutate()}
                disabled={
                  writeStory.isPending ||
                  uploadingDocuments ||
                  (storyInput.length < 8 && !storyDocuments.length)
                }
              >
                {writeStory.isPending ? "Starting draft…" : "Write draft"}
              </InkButton>
              <p>
                {uploadingDocuments
                  ? "Waiting for your documents to finish uploading."
                  : "Creates a draft for your review."}
              </p>
            </div>
          </footer>
          <div role="alert" aria-live="assertive" aria-atomic="true" className="composer-error">
            {storyNotice?.kind === "error" ? storyNotice.text : ""}
            {storyNotice?.kind === "error" &&
            looksLikeProviderAuthFailure(storyNotice.authDetail) ? (
              <ProviderSignInButton detail={storyNotice.authDetail} />
            ) : null}
          </div>
        </section>

        {needs.length > 0 ? (
          <div className="needs">
            <span className="needs-label">Needs you</span>
            {needs.map((n) => (
              <Link
                key={n.t}
                to={n.to}
                className={"needs-item" + (n.quiet ? " quiet" : "")}
                onClick={() => {
                  if (n.openDark == null) return;
                  try {
                    sessionStorage.setItem(OPEN_KEY, String(n.openDark));
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {n.t}
              </Link>
            ))}
          </div>
        ) : null}
        {bootFailed ? (
          <ScreenError
            message={
              (leads.error instanceof Error && leads.error.message) ||
              (sources.error instanceof Error && sources.error.message) ||
              "Could not load the desk."
            }
            onRetry={() => {
              void leads.refetch();
              void sources.refetch();
            }}
            retrying={leads.isRefetching || sources.isRefetching}
          />
        ) : booting ? (
          <ListSkeleton rows={6} />
        ) : (
          <div className="desk-cc-grid">
            <section className="gc-queue">
              <SecHead
                title="The queue"
                count={queue.length}
                aside={
                  <Link to="/desk/queue" className="np-link">
                    Full queue
                  </Link>
                }
              />
              {queue.length === 0 ? (
                !last && publishedCount === 0 ? (
                  <p className="wire-sum">
                    Queue is empty —{" "}
                    <Link to="/desk/scan" className="inline-link">
                      run the first scan
                    </Link>{" "}
                    or{" "}
                    <Link to="/desk/queue" className="inline-link">
                      file a lead
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="wire-sum">
                    {workingQueueEmptyCopy({
                      publishedCount,
                      lastScan: last
                        ? {
                            leads_created: last.leads_created,
                            sources_fetched: last.sources_fetched,
                            error: last.error,
                          }
                        : null,
                    })}{" "}
                    <Link to="/desk/scan" className="inline-link">
                      Run the scan again
                    </Link>
                    {publishedCount > 0 ? (
                      <>
                        {" · "}
                        <Link to="/desk/published" className="inline-link">
                          Published
                        </Link>
                      </>
                    ) : null}
                    .
                  </p>
                )
              ) : (
                <div className="lead-list">
                  {queue.slice(0, 8).map((l) => (
                    <LeadRowView
                      key={l.id}
                      lead={l}
                      dup={nearDuplicate(l, printed)}
                      onHold={() => setStatus.mutate({ id: l.id, status: "held" })}
                      onBack={() => setStatus.mutate({ id: l.id, status: "new" })}
                      onKill={() => setStatus.mutate({ id: l.id, status: "killed" })}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="nightpanel gc-darkdesk">
              <SecHead
                title="Dark Desk"
                aside={
                  <Link to="/desk/dark" className="np-link">
                    Open the desk
                  </Link>
                }
              />
              <p className="np-note">Investigates. Never prints.</p>
              {darkErr ? <p className="note err">{darkErr}</p> : null}
              {inbox.length === 0 && onDesk.length === 0 ? (
                <p className="wire-sum">
                  Nothing new tonight.{" "}
                  <Link to="/desk/dark" className="inline-link">
                    Start from a tip
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <p className="np-pile">To look at · {inbox.length}</p>
                  {inbox.slice(0, 3).map((item) => (
                    <div key={item.id} className="np-item">
                      <p className="np-kind">{editorKindLabel(item.kind)}</p>
                      <p className="np-title">{item.title}</p>
                      {item.source_line ? <p className="np-meta">{item.source_line}</p> : null}
                      <div className="np-acts">
                        <InkButton
                          tone="invert"
                          small
                          disabled={startDark.isPending}
                          onClick={() => startDark.mutate({ seed: item.seed, title: item.title })}
                        >
                          Start digging
                        </InkButton>
                      </div>
                    </div>
                  ))}
                  <p className="np-pile">On the desk · {onDesk.length}</p>
                  {onDesk.slice(0, 3).map((row) => (
                    <div key={row.id} className="np-item">
                      <p className="np-kind">{editorStatus(row.status)}</p>
                      <p className="np-title">{row.title}</p>
                      <p className="np-meta">
                        {Number(row.records ?? 0)} records · {Number(row.still_open ?? 0)} still to
                        open
                      </p>
                      <div className="np-acts">
                        <Link
                          to="/desk/dark"
                          className="btn solid small"
                          onClick={() => {
                            try {
                              sessionStorage.setItem(OPEN_KEY, String(row.id));
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          Open file
                        </Link>
                      </div>
                    </div>
                  ))}
                  <p className="np-pile">
                    Set aside · {aside.length}{" "}
                    <Link to="/desk/dark" className="np-link">
                      see the pile
                    </Link>
                  </p>
                </>
              )}
            </section>

            <section id="desk-followups" className="gc-followups">
              <SecHead
                title={`Follow-ups · ${followUps.data?.length ?? 0}`}
                aside={
                  <Link to="/desk/follow-ups" className="np-link">
                    All follow-ups
                  </Link>
                }
                sub={
                  followUpsRailCopy(followUps.isError) ??
                  ((followUps.data ?? []).length === 0
                    ? "No one owes you an answer right now."
                    : undefined)
                }
              />
              {followUps.isError || (followUps.data ?? []).length === 0
                ? null
                : (followUps.data ?? [])
                    .slice(0, 3)
                    .map((f) => (
                      <FollowUpItem
                        key={f.id}
                        item={f}
                        onReply={(replyText, repliedOn) =>
                          replyFollowUp.mutate({ id: f.id, replyText, repliedOn })
                        }
                        onNudge={() => nudgeFollow.mutate(f.id)}
                        onDrop={() => dropFollow.mutate(f.id)}
                        nudging={nudgeFollow.isPending}
                        dropping={dropFollow.isPending}
                        replying={replyFollowUp.isPending}
                      />
                    ))}
            </section>

            <section className="wirecol gc-wire">
              <SecHead
                title="The wire"
                aside={
                  <InkButton small disabled={scanning} onClick={() => scan.mutate()}>
                    {scanning ? "Scanning…" : "Run scan"}
                  </InkButton>
                }
              />
              {scanning ? <Busy label="Fetching the watch list, then one pass for leads." /> : null}
              {last ? (
                <>
                  <p className="wire-line">
                    <b>Last scan</b> · {formatDateTime(last.started_at)} ·{" "}
                    {last.leads_created > 0 ? (
                      scanCountsLine(last)
                    ) : (
                      <>
                        {last.sources_fetched} fetched · <b>filed nothing</b>
                      </>
                    )}
                  </p>
                  {/*
                  The scan note (PrimeGov summary / why-zero explanation) can
                  run to several sentences -- a rail this narrow cannot carry
                  it inline without becoming a wall of text, so it reads
                  collapsed by default. The one-line stat above is always
                  visible; nothing is lost, only tucked behind a click.
                */}
                  {scanZeroWhy(last) ? (
                    <details className="wire-flaky">
                      <summary>Read the scan note</summary>
                      <p className="wire-sum">{scanZeroWhy(last)}</p>
                    </details>
                  ) : null}
                  {last.error && last.leads_created > 0 ? (
                    <p className="wire-warn">{editorScanError(last.error)}</p>
                  ) : null}
                </>
              ) : (
                <p className="wire-sum">No scans yet — the watch list is ready.</p>
              )}
              <div className="wire-block">
                <p className="wire-line">
                  <b>Source health</b> · {accepted.length} on watch
                  {officialFail.length ? ` · ${officialFail.length} failing` : ""}
                  {flakyFail.length ? ` · ${flakyFail.length} flaky` : ""}
                  {" · "}
                  <Link to="/desk/sources" className="np-link">
                    Sources
                  </Link>
                </p>
                {officialFail.map((s) => (
                  <p key={s.id} className="wire-warn">
                    {s.title} — {editorFetchError(s.last_error, s.url) ?? s.last_error}
                  </p>
                ))}
                {flakyFail.length ? (
                  <details className="wire-flaky">
                    <summary>{flakyFailureCopy(flakyFail.length)}</summary>
                    {flakyFail.map((s) => (
                      <p key={s.id}>
                        {s.title} — {editorFetchError(s.last_error, s.url) ?? s.last_error}
                      </p>
                    ))}
                  </details>
                ) : null}
                {!officialFail.length && !flakyFail.length ? (
                  <p className="meta">All quiet.</p>
                ) : null}
              </div>
              {proposed.length ? (
                <div className="wire-block">
                  <p className="wire-line">
                    <b>Proposed sources</b> · {proposed.length}
                  </p>
                  {proposed.slice(0, 5).map((s) => (
                    <div key={s.id} className="wire-row wire-proposed">
                      <span title={s.title}>{s.title}</span>
                      <span className="wire-proposed-acts">
                        <InkButton
                          tone="quiet"
                          small
                          onClick={() => srcStatus.mutate({ id: s.id, status: "accepted" })}
                        >
                          Accept
                        </InkButton>
                        <InkButton
                          tone="quiet"
                          small
                          onClick={() => srcStatus.mutate({ id: s.id, status: "rejected" })}
                        >
                          Drop
                        </InkButton>
                      </span>
                    </div>
                  ))}
                  {proposed.length > 5 ? (
                    <p className="wire-sum">
                      {proposed.length - 5} more proposed ·{" "}
                      <Link to="/desk/sources" className="inline-link">
                        Review them in Sources
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="wire-block">
                <p className="wire-line">
                  <b>On the paper</b>
                </p>
                {(published.data ?? []).slice(0, 3).map((p) => (
                  <p key={p.id} className="wire-row">
                    <Link to="/desk/published" className="hl-link sm">
                      {p.headline}
                    </Link>
                    <span className="meta-inline">
                      {formatShortDate(p.published_at)}
                      {p.corrections.length ? " · corrected" : ""}
                    </span>
                  </p>
                ))}
                {(published.data ?? []).length === 0 ? (
                  <p className="meta">Empty until you publish.</p>
                ) : null}
              </div>
              <div className="wire-block">
                <p className="wire-line">
                  <b>Beat memory</b> · what we already covered
                </p>
                {(memory.data ?? []).slice(0, 4).map((m) => (
                  <p key={m.id} className="wire-row wire-mem-row" title={m.last_angle}>
                    <b className="mem-e">{m.entity}</b>
                  </p>
                ))}
                {/* Every sibling widget explains its empty state; this one rendered
                  a bare heading over nothing (UX-002). */}
                {(memory.data ?? []).length === 0 ? (
                  <p className="meta">No beat memory yet — it builds as you publish.</p>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </div>
    </DeskShell>
  );
}
