import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice } from "@/components/states";
import { addCorrection, deleteArticle, listMemory, listPublishedDesk } from "@/lib/news/desk";
import { restoreTrashItem } from "@/lib/news/trash";
import { formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/published")({ component: PublishedPage });

function PublishedPage() {
  const qc = useQueryClient();
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  const [corrFor, setCorrFor] = useState<string | null>(null);
  const [corrBySlug, setCorrBySlug] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Which story is asking to be taken off the paper. Null when none is.
  const [killFor, setKillFor] = useState<string | null>(null);
  // The trash id of the last removal, so Undo is right here.
  const [undo, setUndo] = useState<number | null>(null);
  const corr = useMutation({
    mutationFn: (slug: string) =>
      addCorrection({ data: { articleSlug: slug, body: (corrBySlug[slug] ?? "").trim() } }),
    onSuccess: (res, slug) => {
      if (res.ok) {
        setCorrBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrFor(null);
        setNote({ kind: "ok", text: "Correction is public." });
        void qc.invalidateQueries({ queryKey: ["published-desk"] });
        void qc.invalidateQueries({ queryKey: ["corrections"] });
        void qc.invalidateQueries({ queryKey: ["article", slug] });
      } else {
        setNote({
          kind: "err",
          text: "error" in res ? String(res.error) : "Could not post that correction.",
        });
      }
    },
    onError: (err) => {
      setNote({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not post that correction.",
      });
    },
  });

  /**
   * Take a story off the paper.
   *
   * The paper's convention is that a printed piece is corrected, never quietly
   * changed — so this is the exception, and it says what it costs before it
   * does it. The operator's rule is that an editor can always remove
   * something, before or after it prints.
   */
  const remove = useMutation({
    mutationFn: (slug: string) => deleteArticle({ data: slug }),
    onSuccess: (res) => {
      setKillFor(null);
      if (res?.ok) {
        setUndo(res.trashId);
        setNote({ kind: "ok", text: "Taken off the paper, and kept for 30 days." });
        void qc.invalidateQueries({ queryKey: ["published-desk"] });
        void qc.invalidateQueries({ queryKey: ["leads"] });
        void qc.invalidateQueries({ queryKey: ["articles"] });
      } else {
        setNote({ kind: "err", text: res?.error ?? "Could not remove that." });
      }
    },
    onError: (err) =>
      setNote({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not remove that.",
      }),
  });

  const undoRemove = useMutation({
    mutationFn: (id: number) => restoreTrashItem({ data: id }),
    onSuccess: (res) => {
      setUndo(null);
      setNote(
        res?.ok
          ? { kind: "ok", text: "Back on the paper." }
          : { kind: "err", text: res?.error ?? "That would not go back." },
      );
      void qc.invalidateQueries({ queryKey: ["published-desk"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
    },
    onError: (err) =>
      setNote({
        kind: "err",
        text: err instanceof Error ? err.message : "That would not go back.",
      }),
  });

  const rows = published.data ?? [];

  return (
    <DeskShell title="Published" kicker="The record">
      <p className="lede">
        What is live on the paper, with its corrections. Corrections are public.
      </p>
      {note ? (
        <Notice kind={note.kind}>
          {note.text}
          {undo != null ? (
            <>
              {" "}
              <button
                type="button"
                className="inline-link"
                disabled={undoRemove.isPending}
                onClick={() => undoRemove.mutate(undo)}
              >
                {undoRemove.isPending ? "Putting it back…" : "Undo"}
              </button>
            </>
          ) : null}
        </Notice>
      ) : null}
      {published.isPending && !rows.length ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <p className="wire-sum">Empty until you publish.</p>
      ) : (
        <div className="pub-list">
          {rows.map((p) => (
            <div key={p.id} className="pub-row">
              <div className="pub-main">
                <p className="meta">
                  {p.topic} · {formatShortDate(p.published_at)}
                  {p.lead_score != null ? ` · scored ${p.lead_score}/20 at filing` : ""}
                </p>
                <h3 className="pub-h">{p.headline}</h3>
                {p.dek ? <p className="pub-dek">{p.dek}</p> : null}
                {p.corrections.map((c, i) => (
                  <p key={i} className="pub-corr">
                    <b>Correction, {formatShortDate(c.date)}:</b> {c.body}
                  </p>
                ))}
                {killFor === p.slug ? (
                  <p className="pub-corr del-warn">
                    <b>This takes it off the paper.</b> Its URL becomes a 404, the
                    feed and the sitemap drop it, and anyone holding a link has a
                    dead link. Its corrections go too. Consider a correction
                    instead — that is what the paper normally does.
                  </p>
                ) : null}
                {corrFor === p.slug ? (
                  <div className="corr-form">
                    <textarea
                      rows={3}
                      value={corrBySlug[p.slug] ?? ""}
                      onChange={(e) =>
                        setCorrBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }))
                      }
                      placeholder="What was wrong, and what is right."
                    />
                    <div className="row-acts static">
                      <InkButton
                        small
                        disabled={!(corrBySlug[p.slug] ?? "").trim() || corr.isPending}
                        onClick={() => corr.mutate(p.slug)}
                      >
                        Publish correction
                      </InkButton>
                      <InkButton tone="quiet" small onClick={() => setCorrFor(null)}>
                        Cancel
                      </InkButton>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="pub-acts">
                <Link to="/articles/$slug" params={{ slug: p.slug }} className="btn quiet small">
                  Read on the paper
                </Link>
                <InkButton tone="quiet" small onClick={() => setCorrFor(p.slug)}>
                  Post correction
                </InkButton>
                {killFor === p.slug ? (
                  <>
                    <InkButton
                      tone="ghost"
                      small
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(p.slug)}
                    >
                      {remove.isPending ? "Removing…" : "Yes, take it off"}
                    </InkButton>
                    <InkButton tone="quiet" small onClick={() => setKillFor(null)}>
                      Keep it
                    </InkButton>
                  </>
                ) : (
                  <InkButton tone="quiet" small onClick={() => setKillFor(p.slug)}>
                    Delete
                  </InkButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <SecHead
        title="Beat memory"
        count={memory.data?.length ?? 0}
        sub="What the drafting AI is told we already covered, so the paper doesn't repeat itself."
      />
      <table className="ltable">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Last angle</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {(memory.data ?? []).map((m) => (
            <tr key={m.id} className="lead-tr">
              <td className="td-hl" data-label="Entity">
                <span className="src-t">{m.entity}</span>
              </td>
              <td className="td-meta wide" data-label="Last angle">{m.last_angle}</td>
              <td className="td-meta" data-label="Updated">{formatShortDate(m.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DeskShell>
  );
}
