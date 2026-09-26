import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import {
  addCorrection,
  deleteArticle,
  listMemory,
  listPublishedDesk,
  resolveMeetingArticleReview,
  suggestCorrectionTemplate,
  suggestCorrectionWording,
  updateArticleHeadline,
} from "@/lib/news/desk";
import { editorActionError } from "@/lib/news/desk-copy";
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
  /*
    0.6.70: the two lines an editor types -- what the story got wrong, and what
    is right -- so the desk can write the note for them. They are kept apart
    from the note in `corrBySlug` on purpose: the note is what gets published
    and the editor may rewrite every word of it, while these two are the fact
    the note is about, and pressing Suggest twice should not append to them.
  */
  const [corrWrongBySlug, setCorrWrongBySlug] = useState<Record<string, string>>({});
  const [corrRightBySlug, setCorrRightBySlug] = useState<Record<string, string>>({});
  /*
    "Also fix the story text", per slug, and the text being worked on. The
    printed body is seeded from the row when the box is opened, so the editor
    is editing the words on the paper rather than a blank page.
  */
  const [corrFixBySlug, setCorrFixBySlug] = useState<Record<string, boolean>>({});
  const [corrBodyBySlug, setCorrBodyBySlug] = useState<Record<string, string>>({});
  // Working / done / failed, and why, for the wording suggestion only.
  const [wordingFor, setWordingFor] = useState<
    { slug: string; kind: "working" | "ok" | "err"; text: string } | null
  >(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Which story is asking to be taken off the paper. Null when none is.
  const [killFor, setKillFor] = useState<string | null>(null);
  /*
    The headline of a printed story, being rewritten.

    Keyed by slug because that is what identifies the row on this page; the
    write itself goes by article id (`p.id`), which is what `articles` is keyed
    by. The slug never changes here -- a printed link must keep working -- so
    this is a change of words only.
  */
  const [headFor, setHeadFor] = useState<string | null>(null);
  const [headBySlug, setHeadBySlug] = useState<Record<string, string>>({});
  // The trash id of the last removal, so Undo is right here.
  const [undo, setUndo] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [reviewChecks, setReviewChecks] = useState<Record<number, number[]>>({});
  /*
    Post the correction, and -- when the editor asked for it -- the story text
    that goes with it.

    Both are one call because they are one act: the note says the paper got
    something wrong and the text is the paper no longer saying it. Two calls
    could land one and not the other, which leaves a published correction
    promising a fix the story does not carry.

    The default is what it always was: the note alone, above a story whose text
    is untouched.
  */
  const corr = useMutation({
    /*
      The flag travels with the call rather than being read back off state in
      `onSuccess`: the message the editor gets afterwards has to describe the
      post that actually happened, not the one the next render would make.
    */
    mutationFn: (input: { slug: string; fixing: boolean }) =>
      addCorrection({ data: {
        articleSlug: input.slug,
        body: (corrBySlug[input.slug] ?? "").trim(),
        meetingReviewId: corrReviewFor[input.slug],
        alsoFixBody: input.fixing,
        storyBody: input.fixing ? (corrBodyBySlug[input.slug] ?? "") : undefined,
      } }),
    onSuccess: (res, input) => {
      const { slug } = input;
      if (res.ok) {
        setCorrBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrWrongBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrRightBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrFixBySlug((prev) => ({ ...prev, [slug]: false }));
        /*
          DELETED, not set to "". An empty string is still a KEY, and the box's
          value is `corrBodyBySlug[slug] ?? p.body` -- `??` only falls through
          on null and undefined, so a key holding "" wins over the story's own
          text. That is the blank box the walk caught: after a note-only
          correction, the next "Also fix the story text" opened on nothing, and
          the editor would have been editing an empty page over a story that
          already printed. Absent is what "not touched since the last post"
          means, so the next open seeds itself from the freshly refetched row.
        */
        setCorrBodyBySlug((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        });
        setWordingFor(null);
        setCorrFor(null);
        setCorrReviewFor((previous) => ({ ...previous, [slug]: undefined }));
        setNote({
          kind: "ok",
          text: input.fixing
            ? "Correction is public, and the story now reads the corrected text."
            : "Correction is public.",
        });
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
        text:
          editorActionError(err instanceof Error ? err.message : "", "post that correction") ??
          "Could not post that correction.",
      });
    },
  });

  /**
   * Have the story model draft the note from the editor's two lines.
   *
   * It goes through the same provider ladder as every other story call, and it
   * changes nothing: the answer lands in the box the editor is already looking
   * at, and the post button is still the only thing that publishes. A failure
   * leaves the box exactly as they left it and says why, because a suggestion
   * that silently did nothing looks the same as one that worked.
   */
  const suggestWording = useMutation({
    mutationFn: (slug: string) =>
      suggestCorrectionWording({ data: {
        articleSlug: slug,
        wasWrong: (corrWrongBySlug[slug] ?? "").trim(),
        isRight: (corrRightBySlug[slug] ?? "").trim(),
      } }),
    onMutate: (slug) => {
      setWordingFor({ slug, kind: "working", text: "Writing a correction note…" });
    },
    onSuccess: (res, slug) => {
      if (res.ok) {
        setCorrBySlug((prev) => ({ ...prev, [slug]: res.wording }));
        setWordingFor({
          slug,
          kind: "ok",
          text: "Suggested below. Read it, change any of it, then post it.",
        });
      } else {
        setWordingFor({ slug, kind: "err", text: res.error });
      }
    },
    onError: (err, slug) => {
      setWordingFor({
        slug,
        kind: "err",
        text:
          editorActionError(err instanceof Error ? err.message : "", "suggest the wording") ??
          "Could not reach the story model. Your box is exactly as you left it.",
      });
    },
  });

  /**
   * The plain note, written on the desk from the same two lines.
   *
   * No model and no network, so this is the path that always works -- the
   * owner's complaint was an empty box, and this fills it on a machine where
   * nothing is configured at all.
   */
  const useTemplate = useMutation({
    mutationFn: (slug: string) =>
      suggestCorrectionTemplate({ data: {
        articleSlug: slug,
        wasWrong: (corrWrongBySlug[slug] ?? "").trim(),
        isRight: (corrRightBySlug[slug] ?? "").trim(),
      } }),
    onSuccess: (res, slug) => {
      if (res.ok) {
        setCorrBySlug((prev) => ({ ...prev, [slug]: res.wording }));
        setWordingFor({
          slug,
          kind: "ok",
          text: "Plain note written from your two lines. Change any of it, then post it.",
        });
      } else {
        setWordingFor({ slug, kind: "err", text: res.error });
      }
    },
    onError: (err, slug) => {
      setWordingFor({
        slug,
        kind: "err",
        text:
          editorActionError(err instanceof Error ? err.message : "", "write the note") ??
          "Could not write the note.",
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
      text:
        editorActionError(
          error instanceof Error ? error.message : "",
          "save the transcript review",
        ) ?? "Could not save the transcript review.",
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
        text:
          editorActionError(err instanceof Error ? err.message : "", "remove that") ??
          "Could not remove that.",
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
        text:
          editorActionError(err instanceof Error ? err.message : "", "put it back") ??
          "That would not go back.",
      }),
  });

  /**
   * Rewrite the headline of a story that is already on the paper.
   *
   * The paper prints the truth once; this is not a correction, so no notice
   * goes on the page (the corrections rule in lib/news/corrections.ts never
   * mentions headlines). The desk does keep the record: the server writes the
   * old words, the account and the time to `article_headline_history` and the
   * action log, so "when did that headline change?" has an answer.
   */
  const editHeadline = useMutation({
    mutationFn: (input: { articleId: number; slug: string; headline: string }) =>
      updateArticleHeadline({ data: { articleId: input.articleId, headline: input.headline } }),
    onSuccess: (res, input) => {
      if (!res.ok) {
        setNote({
          kind: "err",
          text: editorActionError(res.error, "change that headline") ?? "Could not change that headline.",
        });
        return;
      }
      setHeadFor(null);
      setNote({ kind: "ok", text: "The paper now reads that headline." });
      void qc.invalidateQueries({ queryKey: ["published-desk"] });
      void qc.invalidateQueries({ queryKey: ["paper"] });
      void qc.invalidateQueries({ queryKey: ["article", input.slug] });
    },
    onError: (err) =>
      setNote({
        kind: "err",
        text:
          editorActionError(err instanceof Error ? err.message : "", "change that headline") ??
          "Could not change that headline.",
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
            editorActionError(
              pubError instanceof Error ? pubError.message : "",
              "load what's published",
            ) ?? "Could not load what's published."
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
                {/*
                  Rewriting the headline of a story already on the paper. It
                  sits directly under the h2 that shows the words live right
                  now, so the editor is looking at what they are replacing.
                */}
                {headFor === p.slug ? (
                  <div className="corr-form head-edit">
                    <label htmlFor={`pub-head-${p.slug}`}>
                      Type the headline this story should read instead. The link does not change,
                      so nothing that points here breaks. The paper keeps a record of the old words.
                    </label>
                    <textarea
                      id={`pub-head-${p.slug}`}
                      rows={2}
                      value={headBySlug[p.slug] ?? p.headline}
                      onChange={(e) =>
                        setHeadBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }))
                      }
                    />
                    <div className="row-acts static">
                      <InkButton
                        small
                        disabled={!(headBySlug[p.slug] ?? "").trim() || editHeadline.isPending}
                        onClick={() =>
                          editHeadline.mutate({
                            articleId: p.id,
                            slug: p.slug,
                            headline: (headBySlug[p.slug] ?? "").trim(),
                          })
                        }
                      >
                        {editHeadline.isPending ? "Saving…" : "Save the new headline"}
                      </InkButton>
                      <InkButton tone="quiet" small onClick={() => setHeadFor(null)}>
                        Cancel
                      </InkButton>
                    </div>
                  </div>
                ) : null}
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
                    {/*
                      The two lines the note is made of. An editor correcting a
                      story knows both of them -- they are looking at the wrong
                      number and the right one -- and the empty box the owner
                      hit asked them to turn that into house style by hand.
                    */}
                    <label htmlFor={`pub-corr-wrong-${p.slug}`}>What was wrong</label>
                    <input
                      id={`pub-corr-wrong-${p.slug}`}
                      type="text"
                      value={corrWrongBySlug[p.slug] ?? ""}
                      onChange={(e) =>
                        setCorrWrongBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }))
                      }
                      placeholder="The fee was $4,200"
                    />
                    <label htmlFor={`pub-corr-right-${p.slug}`}>What is right</label>
                    <input
                      id={`pub-corr-right-${p.slug}`}
                      type="text"
                      value={corrRightBySlug[p.slug] ?? ""}
                      onChange={(e) =>
                        setCorrRightBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }))
                      }
                      placeholder="The fee is $2,400"
                    />
                    <div className="row-acts static">
                      <InkButton
                        small
                        disabled={
                          !(corrWrongBySlug[p.slug] ?? "").trim() ||
                          !(corrRightBySlug[p.slug] ?? "").trim() ||
                          suggestWording.isPending
                        }
                        onClick={() => suggestWording.mutate(p.slug)}
                      >
                        {suggestWording.isPending && wordingFor?.slug === p.slug
                          ? "Suggesting…"
                          : "Suggest wording"}
                      </InkButton>
                      {/*
                        The same note, written on the desk with no model at all.
                        Kept as its own button so "the model is unreachable" and
                        "here is your note" are never the same event: the first
                        leaves the box alone, the second fills it.
                      */}
                      <InkButton
                        tone="quiet"
                        small
                        disabled={
                          !(corrWrongBySlug[p.slug] ?? "").trim() ||
                          !(corrRightBySlug[p.slug] ?? "").trim() ||
                          useTemplate.isPending
                        }
                        onClick={() => useTemplate.mutate(p.slug)}
                      >
                        {useTemplate.isPending && wordingFor?.slug === p.slug
                          ? "Writing…"
                          : "Use a plain note"}
                      </InkButton>
                    </div>
                    {wordingFor?.slug === p.slug ? (
                      <p
                        className="meta"
                        role={wordingFor.kind === "err" ? "alert" : "status"}
                      >
                        {wordingFor.text}
                      </p>
                    ) : null}
                    <label htmlFor={`pub-corr-note-${p.slug}`}>The correction</label>
                    <textarea
                      id={`pub-corr-note-${p.slug}`}
                      rows={3}
                      value={corrBySlug[p.slug] ?? ""}
                      onChange={(e) =>
                        setCorrBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }))
                      }
                      placeholder="What was wrong, and what is right."
                    />
                    {/*
                      The second choice. Off by default, so the common case is
                      still a note above an untouched story; on, it opens the
                      printed text so the editor changes the words they can see
                      rather than retyping the story from memory. The two are
                      posted together, in one transaction.
                    */}
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={corrFixBySlug[p.slug] === true}
                        onChange={(e) => {
                          const opened = e.target.checked;
                          setCorrFixBySlug((prev) => ({ ...prev, [p.slug]: opened }));
                          /*
                            Opening the box puts the story's printed text in it,
                            as state rather than only as a render fallback: the
                            POST reads this state, so a box that showed the
                            story while the post carried "" would be the editor
                            pressing Publish on words the desk never sent. Seeded
                            only when the key is absent -- a box the editor has
                            already typed in, or deliberately cleared to an empty
                            string, keeps what they left there.
                          */
                          if (opened) {
                            setCorrBodyBySlug((prev) =>
                              prev[p.slug] === undefined ? { ...prev, [p.slug]: p.body } : prev,
                            );
                          }
                        }}
                      />
                      Also fix the story text
                    </label>
                    {corrFixBySlug[p.slug] === true ? (
                      <>
                        <label htmlFor={`pub-corr-body-${p.slug}`}>
                          The story text as it should read. The link does not change, and the
                          paper keeps the words that printed.
                        </label>
                        <textarea
                          id={`pub-corr-body-${p.slug}`}
                          rows={10}
                          value={corrBodyBySlug[p.slug] ?? p.body}
                          onChange={(e) =>
                            setCorrBodyBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }))
                          }
                        />
                      </>
                    ) : null}
                    <div className="row-acts static">
                      <InkButton
                        small
                        disabled={!(corrBySlug[p.slug] ?? "").trim() || corr.isPending}
                        onClick={() =>
                          corr.mutate({ slug: p.slug, fixing: corrFixBySlug[p.slug] === true })
                        }
                      >
                        {corr.isPending ? "Publishing…" : "Publish correction"}
                      </InkButton>
                      <InkButton
                        tone="quiet"
                        small
                        onClick={() => {
                          setCorrFor(null);
                          setWordingFor(null);
                        }}
                      >
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
                <InkButton
                  tone="quiet"
                  small
                  onClick={() => {
                    // Seed the box with the words on the paper, so pressing
                    // Edit twice is never a way to lose them.
                    setHeadBySlug((prev) => (prev[p.slug] ? prev : { ...prev, [p.slug]: p.headline }));
                    setHeadFor(headFor === p.slug ? null : p.slug);
                  }}
                >
                  {headFor === p.slug ? "Close headline" : "Edit headline"}
                </InkButton>
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
