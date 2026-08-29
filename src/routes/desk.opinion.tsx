import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, DeskShell, InkButton, SecHead, areaClass, inputClass } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import { deleteEditorial, getEditorial, listEditorials, opinionReadiness, startEditorial } from "@/lib/news/opinion";
import { restoreTrashItem } from "@/lib/news/trash";
import { formatDateTime } from "@/lib/paper";

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
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [askedFor, setAskedFor] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  // Which row is asking "are you sure". Null when nothing is.
  const [confirmId, setConfirmId] = useState<number | null>(null);
  // The trash id of the last delete, so Undo is here rather than on Server.
  const [undo, setUndo] = useState<number | null>(null);

  // Asked before anything is typed: a dependency you cannot satisfy should be
  // visible while you are deciding whether to start. Audit finding UIUX-05.
  const ready = useQuery({ queryKey: ["opinion-ready"], queryFn: () => opinionReadiness() });

  const list = useQuery({
    queryKey: ["editorials"],
    queryFn: () => listEditorials(),
    // Something is usually in flight and takes a quarter of an hour.
    refetchInterval: 20_000,
  });

  const piece = useQuery({
    queryKey: ["editorial", openId],
    queryFn: () => getEditorial({ data: openId! }),
    enabled: openId != null,
  });

  const start = useMutation({
    mutationFn: () => startEditorial({ data: { subject, askedFor } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        setNotice(res?.error ?? "That did not start.");
        return;
      }
      setSubject("");
      setAskedFor("");
      setNotice("Writing. It fetches its own records first, so give it 10–40 minutes.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : "That did not start."),
  });

  const remove = useMutation({
    mutationFn: (draftId: number) => deleteEditorial({ data: draftId }),
    onSuccess: (res, draftId) => {
      setConfirmId(null);
      if (!res?.ok) {
        setNotice(res?.error ?? "That did not delete.");
        return;
      }
      if (openId === draftId) setOpenId(null);
      setNotice("");
      setUndo(res.trashId);
      void qc.invalidateQueries({ queryKey: ["editorials"] });
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : "That did not delete."),
  });

  const undoDelete = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (res) => {
      setUndo(null);
      if (!res?.ok) setNotice(res?.error ?? "That would not go back.");
      void qc.invalidateQueries({ queryKey: ["editorials"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : "That would not go back."),
  });

  const rows = list.data ?? [];
  const working = rows.filter((r) => !r.finished_at);

  return (
    <DeskShell
      title="Opinion"
      kicker="Editor desk"
      lede={
        <>
          Editorials run unsigned, as the paper's own position, with OPINION in
          the headline and the receipts at the end. They are drafts until you
          publish one, and a published piece is never edited — a correction runs
          as a dated note above it.
        </>
      }
    >
      <section className="mt-8">
        <SecHead
          title="Write one"
          sub="A subject, a URL, or a sentence. A pasted link gets opened and read before anything is written."
        />
        {ready.data && !ready.data.ready ? (
          <p
            role="status"
            className="mt-4 max-w-2xl border border-rust/35 bg-paper-2 px-3 py-2.5 text-sm text-rust"
          >
            <b>This desk cannot write yet.</b> {ready.data.why}
          </p>
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
          <div className="flex items-center gap-3">
            <InkButton
              tone="solid"
              onClick={() => start.mutate()}
              disabled={
                start.isPending ||
                subject.trim().length < 6 ||
                (ready.data ? !ready.data.ready : false)
              }
            >
              {start.isPending ? "Starting…" : "Write an editorial"}
            </InkButton>
            {notice ? <span className="text-sm text-muted">{notice}</span> : null}
          </div>
        </div>
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
        {list.isPending ? (
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
                    </span>
                  </span>
                  {!r.finished_at ? (
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
                        <InkButton tone="quiet" small onClick={() => setOpenId(r.draft_id)}>
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
                          disabled={remove.isPending || !r.draft_id}
                          onClick={() => r.draft_id && remove.mutate(r.draft_id)}
                        >
                          {remove.isPending ? "Deleting…" : "Yes, delete"}
                        </InkButton>
                        <InkButton tone="quiet" small onClick={() => setConfirmId(null)}>
                          Keep
                        </InkButton>
                      </>
                    ) : (
                      <InkButton
                        tone="quiet"
                        small
                        disabled={!r.draft_id && !r.error}
                        onClick={() => setConfirmId(r.id)}
                      >
                        Delete
                      </InkButton>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Asked {formatDateTime(r.created_at)}
                  {r.finished_at ? ` · finished ${formatDateTime(r.finished_at)}` : ""}
                </p>
                {!r.finished_at ? (
                  <div className="mt-2 max-w-md">
                    <Busy label="Reading the records before it writes a word" />
                  </div>
                ) : null}
                {r.error ? <p className="mt-1 text-sm text-rust">{r.error}</p> : null}
                {confirmId === r.id ? (
                  <p className="mt-1 text-sm text-rust">
                    This deletes the draft for good.
                    {r.published_slug
                      ? " The published piece stays on the paper — remove that under Published."
                      : " Nothing else has a copy."}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {openId != null ? (
        <section className="mt-12 border-2 border-ink p-4">
          <SecHead
            title="The piece"
            aside={
              <InkButton tone="quiet" small onClick={() => setOpenId(null)}>
                Close
              </InkButton>
            }
            sub="Read it here. Edit opens the full editor, where you can print it or throw it away."
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
