import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Busy,
  DeskShell,
  InkButton,
  SecHead,
  areaClass,
  inputClass,
} from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  deleteEditorial,
  discardEditorialRequest,
  fileWrittenEditorial,
  getEditorial,
  listEditorials,
  opinionReadiness,
  publishEditorial,
  startEditorial,
} from "@/lib/news/opinion";
import { stalledRunCopy } from "@/lib/news/desk-copy";
import { restoreTrashItem } from "@/lib/news/trash";
import { usePaperDateFormatters } from "@/lib/paper-context";
import { ModelPicker } from "@/components/model-picker";
import type { OpinionModelChoice } from "@/lib/news/model-choice";
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
  const [modelChoice, setModelChoice] = useState<OpinionModelChoice>("auto");
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
  } | null>(null);
  const setError = (text: string) => setNotice({ text, kind: "error" });
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
    mutationFn: () => startEditorial({ data: { subject, askedFor, modelChoice } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        setError(res?.error ?? "That did not start.");
        return;
      }
      setSubject("");
      setAskedFor("");
      setInfo("Writing. It fetches its own records first, so give it 10–40 minutes.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "That did not start."),
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

  return (
    <DeskShell
      title="Opinion"
      kicker="Editor desk"
      lede={
        <>
          Editorials run unsigned, as the paper's own position, with OPINION in the headline and the
          receipts at the end. They are drafts until you publish one, and a published piece is never
          edited — a correction runs as a dated note above it.
        </>
      }
    >
      <section className="mt-8">
        <SecHead
          title="Write one"
          sub="A subject, a URL, or a sentence. A pasted link gets opened and read before anything is written."
        />
        {ready.isPending || ready.isFetching ? (
          <p
            role="status"
            className="mt-4 max-w-2xl border border-rule bg-paper-2 px-3 py-2.5 text-sm text-muted"
          >
            Checking the editorial voice and writing model…
          </p>
        ) : ready.isError ? (
          <div
            role="alert"
            className="mt-4 max-w-2xl border border-rust/35 bg-paper-2 px-3 py-2.5 text-sm text-rust"
          >
            <b>The desk could not check the writing model.</b> Nothing can be queued until the check
            succeeds.{" "}
            <button type="button" className="inline-link" onClick={() => void ready.refetch()}>
              Check again
            </button>
          </div>
        ) : ready.data && !ready.data.ready ? (
          <div
            role="alert"
            className="mt-4 max-w-2xl border border-rust/35 bg-paper-2 px-3 py-2.5 text-sm text-rust"
          >
            <b>This desk cannot write yet.</b>
            <ul className="mt-1 list-disc pl-5">
              {ready.data.problems.map((problem, index) => (
                <li key={`${index}-${problem}`}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 max-w-2xl space-y-3">
          <label className="block">
            <span className="text-[11px] tracking-[0.14em] text-muted uppercase">
              Subject or link
            </span>
            <textarea
              className={areaClass + " mt-1 w-full"}
              rows={3}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="The rail district wants a second tax for the same tracks — or paste a URL"
            />
          </label>
          <label className="block">
            <span className="text-[11px] tracking-[0.14em] text-muted uppercase">
              Anything you want it to know (optional)
            </span>
            <input
              className={inputClass + " mt-1 w-full"}
              value={askedFor}
              onChange={(e) => setAskedFor(e.target.value)}
              placeholder="Angle, a document to start from, a length"
            />
          </label>
          <ModelPicker
            scope="opinion"
            value={modelChoice}
            onChange={setModelChoice}
            disabled={start.isPending}
          />
          <div className="flex items-center gap-3">
            <InkButton
              tone="solid"
              onClick={() => start.mutate()}
              disabled={
                start.isPending ||
                ready.isPending ||
                ready.isFetching ||
                ready.isError ||
                subject.trim().length < 6 ||
                !ready.data?.ready
              }
            >
              {start.isPending
                ? "Starting…"
                : ready.isPending || ready.isFetching
                  ? "Checking…"
                  : "Write an editorial"}
            </InkButton>
            <span
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="text-sm text-rust"
            >
              {notice?.kind === "error" ? notice.text : ""}
            </span>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-sm text-muted"
            >
              {notice && notice.kind !== "error" ? notice.text : ""}
            </span>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <SecHead
          title="Or file one you wrote"
          sub="Paste a finished piece. It lands as a draft, exactly like one written here, and nothing publishes without your click."
        />
        {showWritten ? (
          <div className="mt-4 max-w-2xl space-y-3">
            <label className="block">
              <span className="text-[11px] tracking-[0.14em] text-muted uppercase">The piece</span>
              <textarea
                className={areaClass + " mt-1 w-full"}
                rows={14}
                value={written}
                onChange={(e) => setWritten(e.target.value)}
                placeholder="Headline on the first line, then the piece. CLAIMS AND SOURCES, EDITOR'S FACT SHEET and the image prompt are picked up if they are there."
              />
            </label>
            <div className="flex items-center gap-3">
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
          <div className="mt-4">
            <InkButton tone="ghost" onClick={() => setShowWritten(true)}>
              Paste a piece I wrote
            </InkButton>
          </div>
        )}
      </section>

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
          title="Editorials"
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
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-display text-lg">
                      {r.headline || r.subject.slice(0, 90)}
                    </span>
                    <span className="ml-2 text-sm text-muted">
                      {r.source_kind === "article" ? "from our story" : "from a note"}
                      {r.words ? ` · ${r.words} words` : ""}
                      {` · ${editorialAttribution(r)}`}
                    </span>
                  </span>
                  {!r.finished_at && r.stalled ? (
                    <span className="text-[11px] tracking-[0.14em] text-rust uppercase">
                      Stalled
                    </span>
                  ) : !r.finished_at ? (
                    // Fifteen minutes of a static word reads as hung. The rule
                    // animates, and the clock counts up, so it is visibly alive.
                    <Elapsed since={r.created_at} />
                  ) : r.error ? (
                    <span className="text-[11px] tracking-[0.14em] text-rust uppercase">
                      Failed
                    </span>
                  ) : r.published_slug ? (
                    <span className="text-[11px] tracking-[0.14em] text-muted uppercase">
                      Published
                    </span>
                  ) : null}
                  {/*
                    Read, Edit, Delete — always shown, never behind a hover.
                    Edit is the one that was missing entirely: the story
                    workbench opens by lead, and an editorial has no lead, so a
                    finished piece could be read here and nowhere else.
                  */}
                  <span className="row-acts static">
                    {r.draft_id ? (
                      <>
                        <InkButton
                          tone="quiet"
                          small
                          onClick={() =>
                            setOpenId((current) => toggleEditorialReader(current, r.draft_id!))
                          }
                        >
                          {openId === r.draft_id ? "Close" : "Read it"}
                        </InkButton>
                        <Link
                          to="/desk/story/draft/$draftId"
                          params={{ draftId: String(r.draft_id) }}
                          className="btn quiet small"
                        >
                          Edit
                        </Link>
                      </>
                    ) : null}
                    {confirmId === r.id ? (
                      <>
                        <InkButton
                          tone="ghost"
                          small
                          disabled={remove.isPending || discard.isPending}
                          onClick={() =>
                            r.draft_id ? remove.mutate(r.draft_id) : discard.mutate(r.id)
                          }
                        >
                          {remove.isPending || discard.isPending
                            ? "Deleting…"
                            : r.draft_id
                              ? "Yes, delete"
                              : "Yes, clear it"}
                        </InkButton>
                        <InkButton tone="quiet" small onClick={() => setConfirmId(null)}>
                          Keep
                        </InkButton>
                      </>
                    ) : (
                      <InkButton tone="quiet" small onClick={() => setConfirmId(r.id)}>
                        {r.draft_id ? "Delete" : "Clear"}
                      </InkButton>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Asked {formatDateTime(r.created_at)}
                  {r.finished_at ? ` · finished ${formatDateTime(r.finished_at)}` : ""}
                </p>
                {!r.finished_at && r.stalled ? (
                  <p className="mt-2 max-w-md text-sm text-rust">{stalledRunCopy("editorial")}</p>
                ) : !r.finished_at ? (
                  <div className="mt-2 max-w-md">
                    <Busy label="Reading the records before it writes a word" />
                  </div>
                ) : null}
                {r.error ? <p className="mt-1 text-sm text-rust">{r.error}</p> : null}
                {confirmId === r.id ? (
                  <p className="mt-1 text-sm text-rust">
                    {editorialRemovalCopy(Boolean(r.draft_id), Boolean(r.published_slug))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {openId != null ? (
        <section ref={pieceRef} className="mt-12 border-2 border-ink p-4">
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
                        className="btn quiet small"
                      >
                        On the paper
                      </Link>
                    );
                  }
                  if (piece.data) {
                    return (
                      <InkButton
                        small
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(openId)}
                      >
                        {publish.isPending ? "Publishing…" : "Publish to the paper"}
                      </InkButton>
                    );
                  }
                  return null;
                })()}
                <InkButton tone="quiet" small onClick={() => setOpenId(null)}>
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
              {piece.data.fact_sheet ? (
                <div>
                  <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                    Editor's fact sheet — not printed
                  </p>
                  <pre className="mt-1 max-h-72 overflow-auto border border-rule bg-paper-2 p-3 text-sm whitespace-pre-wrap">
                    {piece.data.fact_sheet}
                  </pre>
                </div>
              ) : null}
              {piece.data.image_prompt ? (
                <div>
                  <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                    Image prompt — not printed
                  </p>
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

  return (
    <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.14em] text-rust uppercase">
      <span className="ink-dot" aria-hidden />
      Writing {mm}:{ss}
    </span>
  );
}
