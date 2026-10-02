import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { areaClass, inputClass } from "@/components/desk-chrome-utils";
import { ListSkeleton, ScreenError } from "@/components/states";
import { DeskJobCard } from "@/components/JobCard";
import { invalidateDeskJobs } from "@/components/job-card-state";
import { CopyButton } from "@/components/copy-button";
import {
  deleteEditorial,
  discardEditorialRequest,
  fileWrittenEditorial,
  getEditorial,
  getFailedEditorialMaterial,
  listEditorials,
  opinionReadiness,
  publishEditorial,
  startEditorial,
} from "@/lib/news/opinion";
import { editorDraftError, stalledRunCopy } from "@/lib/news/desk-copy";
import { restoreTrashItem } from "@/lib/news/trash";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { ModelPicker } from "@/components/model-picker";
import { useFirstRunPickerSeed } from "@/components/first-run-picker-default";
import { DEFAULT_OPINION_MODEL, type OpinionModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { StoryDocumentUpload, type StoryUpload } from "@/components/story-documents";
import { DeskNameCheck } from "@/components/desk-name-check";
import { DeskLengthCut } from "@/components/desk-length-cut";
import { editorialSourcesError, parseEditorial } from "@/lib/news/editorial";
import { readSuppliedMaterialCut } from "@/lib/news/supplied-material-cap";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";
import {
  editorialAttribution,
  editorialRemovalCopy,
  openedEditorial,
  toggleEditorialReader,
} from "@/lib/news/opinion-view";

export const Route = createFileRoute("/desk/opinion")({
  head: () => ({ meta: [{ title: "Opinion — TownReporter" }] }),
  component: OpinionPage,
});

/**
 * The Opinion desk.
 *
 * Kept apart from the news queue on purpose. An unsigned editorial states the
 * paper's own position, and the one thing that must never happen is picking one
 * up mid-edit and mistaking it for a report.
 *
 * Writing takes ten to forty minutes — the voice fetches its own records
 * before it writes a word — so this page never waits on the model. It asks, and
 * then shows the piece when it lands.
 */
function OpinionPage() {
  const { formatDateTime } = usePaperDateFormatters();
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [askedFor, setAskedFor] = useState("");
  const [documents, setDocuments] = useState<StoryUpload[]>([]);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [retryRequestId, setRetryRequestId] = useState<number | undefined>();
  /*
    The first-load choice, and the effort that goes with it. Both come from
    `DEFAULT_OPINION_MODEL`, which is Automatic since unit U29b (the owner's
    "use deepseek" reached only the editors who opened the picker while this
    was a pinned Codex Sol). An editor who picks something else this session
    overrides it, and the run they queue carries what they picked -- this is
    only the state before anyone has chosen.
  */
  const [modelChoice, setModelChoice] = useState<OpinionModelChoice>(DEFAULT_OPINION_MODEL);
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(defaultModelEffort(DEFAULT_OPINION_MODEL));
  /*
    F3b: F3 stores the first-run default for Opinion's scope too, and this page
    sends whatever the picker shows as an explicit pick -- so on a fresh
    install that finished setup with a local model in memory, this picker
    opens on Local model and "Write editorial" runs it. The owner's own touch
    wins, and every other paper keeps `DEFAULT_OPINION_MODEL` (Automatic) as
    before (see first-run-picker-default.ts).
  */
  const modelChoiceTouched = useRef(false);
  useFirstRunPickerSeed({
    surface: "opinion",
    current: modelChoice,
    touched: () => modelChoiceTouched.current,
    apply: (choice) => {
      setModelChoice(choice);
      setModelEffort(defaultModelEffort(choice));
    },
  });
  const [openId, setOpenId] = useState<number | null>(null);
  /*
    Where the opened piece is drawn, so it can be scrolled to.

    The panel renders after the whole list, and the operator reported Read it
    doing nothing: the button flipped to Close and no text appeared. Measured
    in a browser -- the panel's heading landed at 722px in a 720px viewport,
    two pixels below the fold. It was working perfectly and was invisible,
    which is indistinguishable from broken and considerably more annoying.
  */
  const pieceRef = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState<{
    text: string;
    kind: "info" | "success" | "error";
    /** The provider's raw error, kept only so the sign-in button can read it. */
    authDetail?: string | null;
  } | null>(null);
  const setError = (text: string, authDetail?: string | null) =>
    setNotice({ text, kind: "error", authDetail });
  const setSuccess = (text: string) => setNotice({ text, kind: "success" });
  const setInfo = (text: string) => setNotice({ text, kind: "info" });
  /*
    A piece the editor wrote somewhere else.

    This desk could only generate, so a column written in the operator's own
    voice -- in their own editor, or in another session against the voice file
    that deliberately lives outside this repository -- had no way in. Closed by
    default: the common case is still writing one here, and an always-open
    textarea would say otherwise.
  */
  const [written, setWritten] = useState("");
  const [showWritten, setShowWritten] = useState(false);
  /*
    CY item 8: the same shut-by-default shape for the AI intake, because the
    drawing draws it as a door rather than as a form standing open. The header's
    "+ New editorial" and the card itself both open it.
  */
  const [showAi, setShowAi] = useState(false);
  // Which row is asking "are you sure". Null when nothing is.
  const [confirmId, setConfirmId] = useState<number | null>(null);
  // The trash id of the last delete, so Undo is here rather than on Server.
  const [undo, setUndo] = useState<number | null>(null);

  // Asked before anything is typed: a dependency you cannot satisfy should be
  // visible while you are deciding whether to start. Audit finding UIUX-05.
  const ready = useQuery({
    queryKey: ["opinion-ready", modelChoice],
    queryFn: () => opinionReadiness({ data: modelChoice }),
  });

  const list = useQuery({
    queryKey: ["editorials"],
    queryFn: () => listEditorials(),
    // Something is usually in flight and takes a quarter of an hour.
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (openId == null) return;
    // After paint, or the element is not there to scroll to yet.
    const id = requestAnimationFrame(() => {
      pieceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [openId]);

  const piece = useQuery({
    queryKey: ["editorial", openId],
    queryFn: () => getEditorial({ data: openId! }),
    enabled: openId != null,
  });

  /*
    Two different deletes, because they are two different things.

    A request with a piece written is deleted through its DRAFT, which keeps a
    copy for thirty days. A request that finished without producing anything
    has no copy to keep, so it is simply removed -- and until now it could not
    be removed at all, because the button was keyed on the draft. The operator
    found two stuck on the live desk, one of which reported neither a piece nor
    an error.
  */
  const discard = useMutation({
    mutationFn: (requestId: number) => discardEditorialRequest({ data: requestId }),
    onSuccess: (r) => {
      setConfirmId(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSuccess("Cleared off the desk. Nothing was written, so there was nothing to keep.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: () => setError("That would not clear. Nothing was changed."),
  });

  const fileWritten = useMutation({
    mutationFn: (text: string) => fileWrittenEditorial({ data: text }),
    onSuccess: (r) => {
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setWritten("");
      setShowWritten(false);
      setSuccess("Filed as a draft. Read it below, then publish when you are ready.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: () => setError("That would not file. Nothing was changed."),
  });

  const start = useMutation({
    mutationFn: () => startEditorial({ data: { subject, askedFor, modelChoice, modelEffort, documentIds: documents.map((d) => d.id), retryRequestId } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        const raw = res?.error ?? "That did not start.";
        setError(editorDraftError(raw) ?? raw, raw);
        return;
      }
      setSubject("");
      setAskedFor("");
      setDocuments([]);
      setRetryRequestId(undefined);
      setInfo("Writing. It fetches its own records first, so give it 10–40 minutes.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
      // FB1: the editorial is a job too -- without this its card waits out the
      // idle poll, and the Opinion screen shows a chip and a clock instead.
      invalidateDeskJobs(qc);
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "That did not start.";
      setError(editorDraftError(raw) ?? raw, raw);
    },
  });

  const restoreMaterial = useMutation({
    mutationFn: (requestId: number) => getFailedEditorialMaterial({ data: requestId }),
    onSuccess: (res) => {
      if (!res.ok) { setError(res.error); return; }
      setSubject(res.sourceText);
      setAskedFor(res.askedFor);
      setRetryRequestId(res.requestId);
      setSuccess(`The complete saved material is back in the form above.${res.attachmentCount ? ` ${res.attachmentCount} retained attachment${res.attachmentCount === 1 ? " is" : "s are"} ready for retry.` : ""}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: () => setError("The saved material could not be restored. Nothing was changed."),
  });

  /*
    Publish, from the reading view. The button also lives in the full editor,
    but the operator pasted a finished piece, opened it here to check it, and
    found only Close / Edit / Delete -- the one action a done draft actually
    wants was hidden behind "Edit", and the hint spelled it "print". Same
    server fn, same guard: nothing publishes without this click.
  */
  const publish = useMutation({
    mutationFn: (draftId: number) => publishEditorial({ data: draftId }),
    onSuccess: (r) => {
      if (!r?.ok) {
        setError(r?.error ?? "That did not print.");
        return;
      }
      setSuccess("On the paper. See it under Published, or read it on the paper.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "That did not print."),
  });

  const remove = useMutation({
    mutationFn: (draftId: number) => deleteEditorial({ data: draftId }),
    onSuccess: (res, draftId) => {
      setConfirmId(null);
      if (!res?.ok) {
        setError(res?.error ?? "That did not delete.");
        return;
      }
      if (openId === draftId) setOpenId(null);
      setSuccess("Deleted, and kept for 30 days. Undo is available below.");
      setUndo(res.trashId);
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "That did not delete."),
  });

  const undoDelete = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (res) => {
      setUndo(null);
      if (!res?.ok) setError(res?.error ?? "That would not go back.");
      else setSuccess("Put back on the Opinion desk.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "That would not go back."),
  });

  const rows = list.data ?? [];
  const working = rows.filter((r) => !r.finished_at && !r.stalled);

  /*
    CY item 8: the readiness notice belongs to the card, not to the form inside
    it. UIUX-05 (scripts/desk-flows-e2e.mjs:211) requires the missing dependency
    to be visible *before anything is typed*, and the form now starts collapsed,
    so the notice is rendered in both states -- on the shut card as well as on
    the open one. Its copy is unchanged.
  */
  const readinessNotice =
    ready.isPending || ready.isFetching ? (
      <p role="status" className="border border-rule bg-paper-2 px-3 py-2.5 text-sm text-muted">
        Checking the editorial voice and writing model…
      </p>
    ) : ready.isError ? (
      <div role="alert" className="border border-rust/35 bg-paper-2 px-3 py-2.5 text-sm text-rust">
        <b>The desk could not check the writing model.</b> Nothing can be queued until the check
        succeeds.{" "}
        <button type="button" className="inline-link" onClick={() => void ready.refetch()}>
          Check again
        </button>
      </div>
    ) : ready.data && !ready.data.ready ? (
      <div role="alert" className="border border-rust/35 bg-paper-2 px-3 py-2.5 text-sm text-rust">
        <b>This desk cannot write yet.</b>
        <ul className="mt-1 list-disc pl-5">
          {ready.data.problems.map((problem, index) => (
            <li key={`${index}-${problem}`}>{problem}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <DeskShell title="Opinion" kicker="Editorials and requests" hideTitle>
      {/*
        The drawn header: kicker, title, the page's own action, rule. The
        drawing's "+ New editorial" opens the New-editorial dialog, which is
        lane 1's work and not in this tree; the button opens the card that does
        that job today -- the AI intake, which is also card one in the drawing
        -- and puts the cursor in its subject box.

        The lede moves out of the shell and into the body: `hideTitle` is what
        buys the action slot, and it drops the shell's sentence with the title,
        so the same prose is rendered here instead of being lost.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">Editorials and requests</p>
          <h1 className="h1">Opinion</h1>
        </div>
        <div className="astra-head-acts">
          <button
            type="button"
            className="btn solid"
            onClick={() => {
              /*
                CY item 8: the card starts shut, so the button has to open it
                before it can scroll to it or put the cursor anywhere. The
                rAF waits for React to have committed the open state, which
                happens before the next paint.
              */
              setShowAi(true);
              requestAnimationFrame(() => {
                document.getElementById("astra-new-editorial")?.scrollIntoView({ block: "start" });
                document.getElementById("astra-editorial-subject")?.focus();
              });
            }}
          >
            + New editorial
          </button>
        </div>
      </div>
      <p className="lede">
        Editorials run unsigned, as the paper's own position, with OPINION in the headline and the
        receipts at the end. They are drafts until you publish one, and a published piece is never
        edited — a correction runs as a dated note above it.
      </p>
      {/*
        CY item 8. These two live regions are the page's, not card one's. They
        used to sit in the AI card's action row, which was fine while that card
        was a form standing open -- but the card is a shut door now, and the
        only row this page had for "Filed as a draft" (the paste card reports
        through the same spans, desk.opinion.tsx:169) went shut with it. The
        walk that files a pasted piece says so out loud
        (scripts/paste-editorial-e2e.mjs:110).

        They stay in the document whether or not there is anything to say, which
        is what UIUX-03 asks for: a live region has to exist before its content
        changes, or the announcement is often never made.
      */}
      <div className="astra-notices">
        <span
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="text-sm text-rust"
        >
          {notice?.kind === "error" ? notice.text : ""}
          {notice?.kind === "error" && looksLikeProviderAuthFailure(notice.authDetail) ? (
            <ProviderSignInButton detail={notice.authDetail} />
          ) : null}
        </span>
        <span role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted">
          {notice && notice.kind !== "error" ? notice.text : ""}
        </span>
      </div>
      <div className="astra-2col wide">
        {/*
          CY item 8. The drawing draws the AI intake as a *door*, not as an open
          form: "Two entry cards: 'Have the AI write an editorial →' (yellow
          border) and 'File one you wrote →'" (handoff-2026-09-26/README.md:305),
          both of them `<a>` links in Desk Screens.dc.html:109-121. The desk had
          the form standing open under that heading, which is not the picture.
          Shut, the card is exactly the drawn card -- the drawn heading and the
          drawn sub-line, nothing else -- and it opens the form.

          The heading is inside the card's press target rather than the whole
          panel being one `<button>`: a `<button>` may not contain the `<h2>`
          (flow content inside phrasing content), and the readiness notice
          below carries a "Check again" button of its own that must not be
          nested in another control. `.astra-card-link` stretches the press
          target over the whole shut card (desk-astra.css), which is what the
          drawn card's hit area is.

          Sub-line is the drawing's, word for word; it replaced the desk's
          longer sentence about pasting source material, which said the same
          thing the label and placeholder on the subject box already say.
        */}
        {showAi ? (
          <div className="astra-panel hot astra-jump" id="astra-new-editorial">
            <h2 className="astra-panel-h lg">
              Have the AI write an editorial <span aria-hidden="true">→</span>
            </h2>
            <p className="astra-panel-sub">
              Give it documents and a position. It writes in the paper’s voice with a Claims and
              sources appendix.
            </p>
            {readinessNotice}
            <div className="space-y-3">
          <label className="block">
            <span className="text-sm tracking-[0.14em] text-muted uppercase">
              Subject, source text, or links
            </span>
            <textarea
              id="astra-editorial-subject"
              className={areaClass + " mt-1 w-full"}
              rows={3}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="The rail district wants a second tax for the same tracks — or paste a URL"
              maxLength={20_000_000}
            />
          </label>
          <StoryDocumentUpload
            documents={documents}
            onChange={setDocuments}
            onBusy={setDocumentsBusy}
            disabled={start.isPending}
          />
          <label className="block">
            <span className="text-sm tracking-[0.14em] text-muted uppercase">
              Anything you want it to know (optional)
            </span>
            <textarea
              className={inputClass + " mt-1 w-full"}
              rows={6}
              value={askedFor}
              onChange={(e) => setAskedFor(e.target.value)}
              placeholder="Angle, a document to start from, a length"
              maxLength={20_000_000}
            />
          </label>
          <ModelPicker
            scope="opinion"
            value={modelChoice}
            onChange={(choice) => { modelChoiceTouched.current = true; setModelChoice(choice); setModelEffort(defaultModelEffort(choice)); }}
            effort={modelEffort}
            onEffortChange={setModelEffort}
            disabled={start.isPending}
          />
          <div className="astra-panel-acts">
            <InkButton
              tone="solid"
              onClick={() => start.mutate()}
              disabled={
                start.isPending ||
                ready.isPending ||
                ready.isFetching ||
                ready.isError ||
                (subject.trim().length < 6 && documents.length === 0) ||
                documentsBusy ||
                !ready.data?.ready
              }
            >
              {start.isPending
                ? "Starting…"
                : ready.isPending || ready.isFetching
                  ? "Checking…"
                  : "Write an editorial"}
            </InkButton>
            {/*
              CY item 8: a shut door needs a way back. Card two has had a
              "Cancel" on its own disclosure since it was built; this is the
              same control on card one, in the same place in the same row.
            */}
            <InkButton tone="quiet" onClick={() => setShowAi(false)}>
              Cancel
            </InkButton>
          </div>
          </div>
          </div>
        ) : (
          <div className="astra-panel hot astra-panel-open astra-jump" id="astra-new-editorial">
            <h2 className="astra-panel-h lg">
              <button type="button" className="astra-card-link" onClick={() => setShowAi(true)}>
                Have the AI write an editorial <span aria-hidden="true">→</span>
              </button>
            </h2>
            <p className="astra-panel-sub">
              Give it documents and a position. It writes in the paper’s voice with a Claims and
              sources appendix.
            </p>
            {readinessNotice}
          </div>
        )}

        <div className="astra-panel">
          <h2 className="astra-panel-h lg">
            File one you wrote <span aria-hidden="true">→</span>
          </h2>
          <p className="astra-panel-sub">
            Paste a finished piece. It lands as a draft, exactly like one written here, and nothing
            publishes without your click.
          </p>
        {showWritten ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm tracking-[0.14em] text-muted uppercase">The piece</span>
              <textarea
                className={areaClass + " mt-1 w-full"}
                rows={14}
                value={written}
                onChange={(e) => setWritten(e.target.value)}
                placeholder="Headline on the first line, then the piece. CLAIMS AND SOURCES, EDITOR'S FACT SHEET and the image prompt are picked up if they are there."
              />
            </label>
            <div className="astra-panel-acts">
              <InkButton
                tone="solid"
                onClick={() => fileWritten.mutate(written)}
                disabled={fileWritten.isPending || written.trim().length < 40}
              >
                {fileWritten.isPending ? "Filing…" : "File it as a draft"}
              </InkButton>
              <InkButton tone="quiet" onClick={() => setShowWritten(false)}>
                Cancel
              </InkButton>
            </div>
          </div>
        ) : (
          <div className="astra-panel-acts">
            <InkButton tone="ghost" onClick={() => setShowWritten(true)}>
              Paste a piece I wrote
            </InkButton>
          </div>
        )}
        </div>
      </div>

      {undo != null ? (
        <p className="mt-6 text-sm text-muted">
          Deleted, and kept for 30 days.{" "}
          <button
            type="button"
            className="inline-link"
            disabled={undoDelete.isPending}
            onClick={() => undoDelete.mutate(undo)}
          >
            {undoDelete.isPending ? "Putting it back…" : "Undo"}
          </button>
        </p>
      ) : null}

      <section className="mt-12">
        <SecHead
          title="Requests & editorials"
          count={rows.length || null}
          sub={
            working.length
              ? `${working.length} being written. This page checks every 20 seconds.`
              : undefined
          }
        />
        {list.isError && rows.length === 0 ? (
          <ScreenError
            message={
              list.error instanceof Error ? list.error.message : "Could not load editorials."
            }
            onRetry={() => void list.refetch()}
            retrying={list.isRefetching}
          />
        ) : list.isPending ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <p className="mt-4 text-ink-2">Nothing yet. Write the first one above.</p>
        ) : (
          <ul className="astra-plain">
            {rows.map((r) => {
              /*
                The chip is the row's state, and it is the only place the desk
                states one. `integrity_notes` is what the writer's own source
                check wrote when the piece was filed -- the same sentence
                `editorialSourcesError` produces -- so the chip reads the
                database rather than re-parsing every body on the list.
              */
              const claims = r.finished_at && !r.error && !r.published_slug ? r.integrity_notes || "" : "";
              return (
                <li key={r.id} className="astra-row opinion">
                  {!r.finished_at && r.stalled ? (
                    <span className="astra-chip fail">Stalled</span>
                  ) : !r.finished_at ? (
                    <span className="astra-chip run">
                      Writing <Elapsed since={r.created_at} />
                    </span>
                  ) : r.error ? (
                    <span className="astra-chip fail">Failed</span>
                  ) : r.published_slug ? (
                    <span className="astra-chip none">Published</span>
                  ) : claims ? (
                    <span className="astra-chip held" title={claims}>
                      ! Claims missing
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="astra-cell">
                    <span className="astra-row-t">{r.headline || r.subject.slice(0, 90)}</span>
                    <span className="astra-row-meta">
                      {r.source_kind === "article" ? "from our story" : "from a note"}
                      {r.words ? ` · ${r.words} words` : ""}
                      {` · ${editorialAttribution(r)}`}
                    </span>
                  </span>
                  <span className="astra-row-meta">
                    Asked {formatDateTime(r.created_at)}
                    {r.finished_at ? ` · finished ${formatDateTime(r.finished_at)}` : ""}
                  </span>
                  {/*
                    Read, Edit, Delete -- always shown, never behind a hover.
                    The drawn state primary sits in front of them: Repair claims
                    for a piece whose appendix is incomplete, View for one that
                    is already on the paper.
                  */}
                  <span className="astra-row-acts">
                    {claims && r.draft_id ? (
                      <Link
                        to="/desk/story/draft/$draftId"
                        params={{ draftId: String(r.draft_id) }}
                        className="btn solid"
                      >
                        Repair claims
                      </Link>
                    ) : null}
                    {/*
                      Unit CA, note 1. A finished piece offered Read it / Edit
                      / Delete and nothing else, and "Publish to the paper"
                      lived only inside the panel Read it opens -- so an editor
                      who pasted a piece, saved it and came back to the desk
                      could not find the one action a done draft wants. The row
                      draws it now: the drawn row puts its primary first
                      (`Desk Screens.dc.html`'s opinion rows, "Repair claims" /
                      "View"), and the drafts list draws "Publish…" as the
                      solid primary too.

                      The same `publish` mutation the panel's button calls, on
                      the same argument (both are the DRAFT id -- `openId` is
                      set to `r.draft_id` by `toggleEditorialReader`) and with
                      the same checks, because they are the same server call.
                      The panel has no confirm step and neither does this: the
                      press is the confirmation, exactly as it is up there.
                      `publishEditorial` still refuses a piece whose claims
                      appendix is incomplete, so the claims row keeps Repair
                      claims as its primary and draws no Publish at all.
                    */}
                    {r.draft_id && r.finished_at && !r.error && !r.published_slug && !claims ? (
                      <InkButton
                        tone="solid"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(r.draft_id!)}
                      >
                        {publish.isPending && publish.variables === r.draft_id
                          ? "Publishing…"
                          : "Publish"}
                      </InkButton>
                    ) : null}
                    {r.published_slug ? (
                      <Link
                        to="/articles/$slug"
                        params={{ slug: r.published_slug }}
                        className="btn solid"
                      >
                        View
                      </Link>
                    ) : null}
                    {r.draft_id ? (
                      <>
                        <InkButton
                          tone="quiet"
                          onClick={() =>
                            setOpenId((current) => toggleEditorialReader(current, r.draft_id!))
                          }
                        >
                          {openId === r.draft_id ? "Close" : "Read it"}
                        </InkButton>
                        <Link
                          to="/desk/story/draft/$draftId"
                          params={{ draftId: String(r.draft_id) }}
                          className="btn quiet"
                        >
                          Edit
                        </Link>
                      </>
                    ) : null}
                    {confirmId === r.id ? (
                      <>
                        {/*
                          Unit UI1a2: the confirm press is the one that does the
                          work, so it carries the states -- "Deleting…" with a
                          spinner, disabled, and the desk's own reason beside it
                          if the call is refused. One of the two mutations is
                          this row's, so `variables` says which.
                        */}
                        <ActionButton
                          tone="danger"
                          phase={rowActionPhase({
                            isPending:
                              (remove.isPending && remove.variables === r.draft_id) ||
                              (discard.isPending && discard.variables === r.id),
                            problem:
                              remove.isError && remove.variables === r.draft_id
                                ? remove.error instanceof Error
                                  ? remove.error.message
                                  : "That did not delete."
                                : discard.isError && discard.variables === r.id
                                  ? discard.error instanceof Error
                                    ? discard.error.message
                                    : "That did not clear."
                                  : null,
                          })}
                          workingLabel="Deleting…"
                          onAct={() => (r.draft_id ? remove.mutate(r.draft_id) : discard.mutate(r.id))}
                        >
                          {r.draft_id ? "Yes, delete" : "Yes, clear it"}
                        </ActionButton>
                        <ActionButton
                          tone="quiet"
                          phase="idle"
                          disabled={remove.isPending || discard.isPending}
                          disabledReason={
                            remove.isPending || discard.isPending
                              ? "The delete is still being saved."
                              : null
                          }
                          onAct={() => setConfirmId(null)}
                        >
                          Keep
                        </ActionButton>
                      </>
                    ) : (
                      <ActionButton
                        tone="danger"
                        phase="idle"
                        disabled={remove.isPending || discard.isPending}
                        onAct={() => setConfirmId(r.id)}
                      >
                        {r.draft_id ? "Delete" : "Clear"}
                      </ActionButton>
                    )}
                  </span>
                  {!r.finished_at && r.stalled ? (
                    <p className="astra-span text-rust">{stalledRunCopy("editorial")}</p>
                  ) : !r.finished_at ? (
                    <div className="astra-span">
                      {/*
                        FB7, item 4 (the U30 note). NOT `compact`.

                        The compact card drops the stage chip row
                        (JobCard.tsx: `!compact && job.stages`), which is the
                        whole of what the report found on this row: the chips
                        name the steps the editorial is working through, and
                        that is the only place on this screen they are drawn.
                        Drafts made the same swap (desk.drafts.tsx, FB6 item 6)
                        for the same reason -- a row that is one per request,
                        full width, has the room the compact card exists to
                        save. The editor gets the chips, the percent, the bar,
                        the step in words, and Cancel.
                      */}
                      {r.job ? <DeskJobCard job={r.job} /> : <Busy label={r.stage || "Working…"} />}
                    </div>
                  ) : null}
                  {/*
                    Unit B8P, the job-result half. The row IS the job result for
                    a finished editorial, and this is the line the editor comes
                    back to: the piece is done, and the material behind it was
                    longer than the writer was given. Read from the draft's own
                    stored record, so it is here on every load, not only in the
                    moment the job completed.
                  */}
                  {r.finished_at && !r.error && readSuppliedMaterialCut(r.research_json) ? (
                    <div className="astra-span">
                      <DeskLengthCut research={r.research_json} />
                    </div>
                  ) : null}
                  {r.error ? (
                    <div className="astra-span text-rust">
                      {editorDraftError(r.error) ?? r.error}
                      {looksLikeProviderAuthFailure(r.error) ? (
                        <ProviderSignInButton detail={r.error} />
                      ) : null}
                      {!r.draft_id ? (
                        <InkButton
                          tone="quiet"
                          disabled={restoreMaterial.isPending}
                          onClick={() => restoreMaterial.mutate(r.id)}
                        >
                          {restoreMaterial.isPending ? "Restoring…" : "Restore saved material"}
                        </InkButton>
                      ) : null}
                    </div>
                  ) : null}
                  {confirmId === r.id ? (
                    <p className="astra-span text-rust">
                      {editorialRemovalCopy(Boolean(r.draft_id), Boolean(r.published_slug))}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {openId != null ? (
        <section ref={pieceRef} className="astra-panel hot mt-12">
          <SecHead
            title="The piece"
            aside={
              <span className="flex items-center gap-2">
                {(() => {
                  const row = openedEditorial(rows, openId);
                  if (row?.published_slug) {
                    return (
                      <Link
                        to="/articles/$slug"
                        params={{ slug: row.published_slug }}
                        className="btn quiet"
                      >
                        On the paper
                      </Link>
                    );
                  }
                  if (piece.data) {
                    return (
                      <InkButton
                        tone="solid"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(openId)}
                      >
                        {publish.isPending ? "Publishing…" : "Publish to the paper"}
                      </InkButton>
                    );
                  }
                  return null;
                })()}
                <InkButton tone="quiet" onClick={() => setOpenId(null)}>
                  Close
                </InkButton>
              </span>
            }
            sub="Read it here, and publish it from here when it is ready. Edit opens the full editor for changes."
          />
          {piece.isPending ? (
            <ListSkeleton />
          ) : !piece.data ? (
            <p className="mt-4 text-muted">That draft is gone.</p>
          ) : (
            <div className="mt-4 space-y-6">
              <h3 className="font-display text-2xl font-semibold">{piece.data.headline}</h3>
              <pre className="max-w-3xl text-base leading-7 whitespace-pre-wrap">
                {piece.data.body}
              </pre>
              {editorialSourcesError(parseEditorial(`${piece.data.headline}\n\n${piece.data.body}`).appendix) ? (
                <p role="alert" className="rounded-lg border border-rust/30 bg-rust/5 p-3 text-rust">
                  {editorialSourcesError(parseEditorial(`${piece.data.headline}\n\n${piece.data.body}`).appendix)}
                </p>
              ) : null}
              <DeskNameCheck
                research={piece.data.research_json}
                headline={piece.data.headline}
                dek={piece.data.dek}
                body={piece.data.body}
              />
              {/*
                Unit B8P. Sits beside the name check because it is the same
                kind of thing: a note about the piece, read off the stored
                draft, still here after a reload. It draws nothing at all
                unless this piece's material was actually cut.
              */}
              <DeskLengthCut research={piece.data.research_json} />
              {piece.data.fact_sheet ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm tracking-[0.14em] text-muted uppercase">
                      Editor's fact sheet — not printed
                    </p>
                    <CopyButton text={piece.data.fact_sheet} announceText="Fact sheet copied." />
                  </div>
                  <pre className="mt-1 max-h-72 overflow-auto border border-rule bg-paper-2 p-3 text-sm whitespace-pre-wrap">
                    {piece.data.fact_sheet}
                  </pre>
                </div>
              ) : null}
              {piece.data.image_prompt ? (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm tracking-[0.14em] text-muted uppercase">
                      Image prompt — not printed
                    </p>
                    <CopyButton text={piece.data.image_prompt} announceText="Image prompt copied." />
                  </div>
                  <pre className="mt-1 max-h-56 overflow-auto border border-rule bg-paper-2 p-3 text-sm whitespace-pre-wrap">
                    {piece.data.image_prompt}
                  </pre>
                </div>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </DeskShell>
  );
}

/**
 * A clock that counts up while a piece is being written.
 *
 * An editorial takes ten to forty minutes, and for all of it the only signal
 * was the static word "Writing…" — indistinguishable from a hung job. A number
 * that changes every second is the cheapest possible proof of life, and it also
 * sets the expectation: at 3:40 the editor can see this is normal, not stuck.
 */
function Elapsed({ since }: { since: string }) {
  const started = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const secs = Number.isNaN(started) ? 0 : Math.max(0, Math.round((now - started) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");

  /*
    The clock only. The word "Writing" and the chip around it belong to the
    row, so the same clock can sit inside the drawn state chip without
    printing "Writing" twice.
  */
  return (
    <span className="inline-flex items-center gap-2">
      <span className="ink-dot" aria-hidden />
      {mm}:{ss}
    </span>
  );
}
