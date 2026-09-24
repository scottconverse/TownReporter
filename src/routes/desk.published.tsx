import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { addCorrection, deleteArticle, listMemory, listPublishedDesk, resolveMeetingArticleReview } from "@/lib/news/desk";
import { myDesk } from "@/lib/news/claim";
import { restoreTrashItem } from "@/lib/news/trash";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

export const Route = createFileRoute("/desk/published")({ component: PublishedPage });

function PublishedPage() {
  const { formatShortDate } = usePaperDateFormatters();
  const qc = useQueryClient();
  const deskRole = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const {
    isError: pubIsError,
    error: pubError,
    refetch: pubRefetch,
    isRefetching: pubRefetching,
  } = published;
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  const [corrFor, setCorrFor] = useState<string | null>(null);
  const [corrReviewFor, setCorrReviewFor] = useState<Record<string, number | undefined>>({});
  const [corrBySlug, setCorrBySlug] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Which story is asking to be taken off the paper. Null when none is.
  const [killFor, setKillFor] = useState<string | null>(null);
  // The trash id of the last removal, so Undo is right here.
  const [undo, setUndo] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [reviewChecks, setReviewChecks] = useState<Record<number, number[]>>({});
  const corr = useMutation({
    mutationFn: (slug: string) =>
      addCorrection({ data: {
        articleSlug: slug,
        body: (corrBySlug[slug] ?? "").trim(),
        meetingReviewId: corrReviewFor[slug],
      } }),
    onSuccess: (res, slug) => {
      if (res.ok) {
        setCorrBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrFor(null);
        setCorrReviewFor((previous) => ({ ...previous, [slug]: undefined }));
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

  const resolveTranscript = useMutation({
    mutationFn: (input: {
      reviewId: number; slug: string; resolution: "still-accurate" | "correction-required";
      acceptedArtifactId: number;
    }) => resolveMeetingArticleReview({ data: {
      reviewId: input.reviewId,
      resolution: input.resolution,
      acceptedArtifactId: input.acceptedArtifactId,
      note: (reviewNotes[input.reviewId] ?? "").trim(),
      confirmedSegmentIndices: reviewChecks[input.reviewId] ?? [],
    } }),
    onSuccess: (res, input) => {
      if (!res.ok) {
        setNote({ kind: "err", text: res.error });
        return;
      }
      setNote({
        kind: "ok",
        text: input.resolution === "still-accurate"
          ? "Transcript revision reviewed. The published story remains unchanged."
          : "Marked for correction. Write and publish the correction below.",
      });
      if (input.resolution === "correction-required") {
        setCorrReviewFor((previous) => ({ ...previous, [input.slug]: input.reviewId }));
        setCorrFor(input.slug);
      }
      void qc.invalidateQueries({ queryKey: ["published-desk"] });
    },
    onError: (error) => setNote({
      kind: "err",
      text: error instanceof Error ? error.message : "Could not save the transcript review.",
    }),
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
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["articles"] });
    },
    onError: (err) =>
      setNote({
        kind: "err",
        text: err instanceof Error ? err.message : "That would not go back.",
      }),
  });

  const rows = published.data ?? [];
  const transcriptReviews = rows.flatMap((article) => article.transcriptReviews.map((review) => ({
    id: review.id,
    headline: article.headline,
    status: review.status,
  })).filter((review) => review.status === "pending" || review.status === "correction-required"));

  return (
    <DeskShell title="Published" kicker="The record">
      {deskRole.data?.role === "owner" && (
        <p className="mb-4">
          <Link
            to="/desk/legal-removals"
            search={{ article: undefined, case: undefined }}
            className="underline"
          >
            Legal removal cases
          </Link>{" "}
          — retained-copy access and external cleanup records.
        </p>
      )}
      <p className="lede">
        What is live on the paper, with its corrections. Corrections are public.
      </p>
      {transcriptReviews.length > 0 ? (
        <Notice kind="err">
          <b>Priority: {transcriptReviews.length} published transcript {transcriptReviews.length === 1 ? "review needs" : "reviews need"} attention.</b>{" "}
          {transcriptReviews.map((review, index) => (
            <span key={review.id}>
              {index > 0 ? " · " : ""}
              <a href={`#transcript-review-${review.id}`} className="inline-link">
                {review.headline}{review.status === "correction-required" ? " — correction required" : " — review evidence"}
              </a>
            </span>
          ))}
        </Notice>
      ) : null}
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
      {pubIsError && !rows.length ? (
        <ScreenError
          message={
            pubError instanceof Error ? pubError.message : "Could not load what's published."
          }
          onRetry={() => void pubRefetch()}
          retrying={pubRefetching}
        />
      ) : published.isPending && !rows.length ? (
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
                {/*
                  h2, not h3. This list has no section heading of its own
                  above it (the page's only heading before it is the h1 in
                  DeskShell), so h3 here skipped a level. Audit finding
                  UIUX-04.
                */}
                <h2 className="pub-h">{p.headline}</h2>
                {p.dek ? <p className="pub-dek">{p.dek}</p> : null}
                {p.corrections.map((c, i) => (
                  <p key={i} className="pub-corr">
                    <b>Correction, {formatShortDate(c.date)}:</b> {c.body}
                  </p>
                ))}
                {p.transcriptReviews.map((review) => {
                  if (review.status === "verified" || review.status === "corrected") {
                    return (
                      <section id={`transcript-review-${review.id}`} key={review.id} className="pub-corr" aria-labelledby={`transcript-review-title-${review.id}`}>
                        <h3 id={`transcript-review-title-${review.id}`}>
                          Transcript review history — {review.status === "verified" ? "marked still accurate" : "correction published"}
                        </h3>
                        <p>
                          The published article remains tied to artifact A ({review.priorArtifact.sha256.slice(0, 12)}…).
                          The review concerned artifact B ({review.currentArtifact.sha256.slice(0, 12)}…).
                        </p>
                        <p>
                          Completed {review.resolvedAt ? formatShortDate(review.resolvedAt) : "at an unrecorded time"}
                          {review.resolvedBy ? ` by editor account ${review.resolvedBy}` : "; reviewer not recorded"}.
                        </p>
                        {review.resolutionNote ? <p><b>Editor note:</b> {review.resolutionNote}</p> : null}
                        {review.status === "verified" ? (
                          review.acceptedEvidence ? (
                            <details>
                              <summary>Accepted artifact B evidence ({review.acceptedEvidence.citations.length} citations · SHA-256 {review.acceptedEvidence.artifactSha256.slice(0, 12)}…)</summary>
                              <ul className="meeting-citations">
                                {review.acceptedEvidence.citations.map((citation) => (
                                  <li key={citation.segmentIndex}>
                                    <p><b>Segment {citation.segmentIndex}</b> · {Math.floor(citation.timestampSeconds / 60)}:{String(Math.floor(citation.timestampSeconds % 60)).padStart(2, "0")}</p>
                                    <p>{citation.excerpt}</p>
                                    <p className="meta">Caption segment SHA-256 {citation.captionSha256}</p>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : <p role="alert">Accepted artifact B evidence is unavailable or malformed; consult the review record before relying on this history.</p>
                        ) : null}
                      </section>
                    );
                  }
                  const checked = reviewChecks[review.id] ?? [];
                  const allChecked = review.citations.length > 0 && review.citations.every((c) => c.currentSegmentIndex != null && checked.includes(c.segmentIndex));
                  return (
                    <section id={`transcript-review-${review.id}`} key={review.id} className="pub-corr" aria-labelledby={`transcript-review-${review.id}`}>
                      <h3 id={`transcript-review-${review.id}`}>Transcript changed — evidence review required</h3>
                      <p>
                        This story was published from artifact {review.priorArtifact.id} ({review.priorArtifact.sha256.slice(0, 12)}…).
                        The current recording is artifact {review.currentArtifact.id} ({review.currentArtifact.sha256.slice(0, 12)}…).
                        The published story and its original evidence have not been changed.
                      </p>
                      {review.citations.length ? review.citations.map((citation) => (
                        <div key={citation.segmentIndex} className="meeting-review-citation">
                          <p><b>Segment {citation.segmentIndex}</b>{citation.timestampSeconds == null ? "" : ` · ${Math.floor(citation.timestampSeconds / 60)}:${String(Math.floor(citation.timestampSeconds % 60)).padStart(2, "0")}`}</p>
                          <p><b>Published evidence:</b> {citation.oldExcerpt ?? "The original excerpt is unavailable; inspect artifact A directly."}</p>
                          <p>
                            <b>Current evidence{citation.currentSegmentIndex == null ? " comparison unavailable" : ` (artifact ${review.currentArtifact.id}, segment ${citation.currentSegmentIndex}${citation.currentTimestampSeconds == null ? "" : ` · ${Math.floor(citation.currentTimestampSeconds / 60)}:${String(Math.floor(citation.currentTimestampSeconds % 60)).padStart(2, "0")}`})`}:</b>{" "}
                            {citation.currentExcerpt ?? "No segment was found near the published citation timestamp. Inspect artifact B directly; this citation cannot be confirmed as still accurate yet."}
                          </p>
                          <label>
                            <input
                              type="checkbox"
                              disabled={citation.currentSegmentIndex == null}
                              checked={checked.includes(citation.segmentIndex)}
                              onChange={(event) => setReviewChecks((previous) => ({
                                ...previous,
                                [review.id]: event.target.checked
                                  ? [...new Set([...(previous[review.id] ?? []), citation.segmentIndex])]
                                  : (previous[review.id] ?? []).filter((value) => value !== citation.segmentIndex),
                              }))}
                            />
                            I checked this citation against the current recording.
                          </label>
                        </div>
                      )) : <p>No direct citation comparison is available. Treat this as correction work.</p>}
                      <textarea
                        rows={2}
                        value={reviewNotes[review.id] ?? ""}
                        onChange={(event) => setReviewNotes((previous) => ({ ...previous, [review.id]: event.target.value }))}
                        placeholder="What did you verify, or what needs correction?"
                        aria-label={`Transcript review note for ${p.headline}`}
                      />
                      <div className="row-acts static">
                        <InkButton
                          small
                          disabled={!allChecked || !(reviewNotes[review.id] ?? "").trim() || resolveTranscript.isPending}
                          onClick={() => resolveTranscript.mutate({
                            reviewId: review.id, slug: p.slug, resolution: "still-accurate",
                            acceptedArtifactId: review.currentArtifact.id,
                          })}
                        >
                          Still accurate — close review
                        </InkButton>
                        <InkButton
                          tone="quiet"
                          small
                          disabled={!(reviewNotes[review.id] ?? "").trim() || resolveTranscript.isPending}
                          onClick={() => resolveTranscript.mutate({
                            reviewId: review.id, slug: p.slug, resolution: "correction-required",
                            acceptedArtifactId: review.currentArtifact.id,
                          })}
                        >
                          Needs correction
                        </InkButton>
                      </div>
                    </section>
                  );
                })}
                {killFor === p.slug ? (
                  <p className="pub-corr del-warn">
                    <b>This takes it off the paper.</b> Its URL becomes a 404, the feed and the
                    sitemap drop it, and anyone holding a link has a dead link. Its corrections go
                    too. Consider a correction instead — that is what the paper normally does.
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
                {deskRole.data?.ok && deskRole.data.role === "owner" && (
                  <a className="btn quiet small" href={`/desk/legal-removals?article=${p.id}`}>
                    Legal removal
                  </a>
                )}
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

      <div id="beat-memory" />
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
              <td className="td-meta wide" data-label="Last angle">
                {m.last_angle}
              </td>
              <td className="td-meta" data-label="Updated">
                {formatShortDate(m.updated_at)}
              </td>
            </tr>
          ))}
          {/* A header-only table read as broken, not empty (UX-002). */}
          {(memory.data ?? []).length === 0 ? (
            <tr>
              <td className="td-meta" colSpan={3}>
                Nothing tracked yet. Beat memory fills in once a story publishes and mentions an
                entity.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </DeskShell>
  );
}
