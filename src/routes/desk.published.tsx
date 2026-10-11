import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { Dialog } from "@/components/dialog";
import { ModelPicker } from "@/components/model-picker";
import { LegalRemovalDialog } from "@/components/dialogs/LegalRemovalDialog";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import {
  addCorrection,
  deleteArticle,
  listMemory,
  listPublishedDeskPage,
  resolveMeetingArticleReview,
  suggestCorrectionTemplate,
  suggestCorrectionWording,
  updateArticleHeadline,
} from "@/lib/news/desk";
import { editorActionError } from "@/lib/news/desk-copy";
import { refusedAnswer } from "@/lib/news/refused-answer";
import { PAGE_SIZE, showingLine } from "@/lib/news/list-window";
import { getViewStatsFn } from "@/lib/news/views";
import { myDesk } from "@/lib/news/claim";
import { restoreTrashItem } from "@/lib/news/trash";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { useEditorSections } from "@/lib/use-sections";
import { sectionDisplayName } from "@/components/sections-setup-copy";
import type { StoryModelChoice } from "@/lib/news/model-choice";

export const Route = createFileRoute("/desk/published")({ component: PublishedPage });

function PublishedPage() {
  const { formatShortDate } = usePaperDateFormatters();
  const qc = useQueryClient();
  const deskRole = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const { sections } = useEditorSections();
  // Which of the design's four filters is on. "All" is the list as it was.
  const [pubFilter, setPubFilter] = useState<"all" | "week" | "corrections" | "opinion">("all");
  const [pubQuery, setPubQuery] = useState("");
  /*
    How much of the list is asked for, and growing by one page per press. The
    real desk holds more published stories than the drawing ever saw (214 rows,
    17,615 px of them), so the screen asks the server for 25 at a time instead of
    fetching and drawing every one. `pubShown` is the whole window from the top
    -- "Show 25 more" widens it rather than fetching the next page into a second
    place -- which keeps the rows already on screen where the reader left them.
  */
  const [pubShown, setPubShown] = useState(PAGE_SIZE);
  /*
    The search box is deferred so a fast typist does not fire a request per
    keystroke: the box keeps up with the typing and the query follows a beat
    behind. It has to be a request at all because the filter runs before the
    window is cut -- searching only the 25 rows already drawn would report no
    matches for a story that is simply further down the list.
  */
  const deferredPubQuery = useDeferredValue(pubQuery);
  /*
    The window, not the list. The key carries the filter, the search and how far
    the reader has opened it, so each combination is cached on its own and going
    back to a filter already looked at is instant; `keepPreviousData` holds the
    rows on screen while the next window is in flight, so pressing a pill or
    typing does not blank the table. The bare `["published-desk"]` prefix is
    still the invalidation key every other screen uses, and a prefix match still
    catches this one.
  */
  const published = useQuery({
    queryKey: ["published-desk", pubFilter, deferredPubQuery, pubShown],
    queryFn: () =>
      listPublishedDeskPage({
        data: { limit: pubShown, offset: 0, filter: pubFilter, search: deferredPubQuery },
      }),
    placeholderData: keepPreviousData,
  });
  const {
    isError: pubIsError,
    error: pubError,
    refetch: pubRefetch,
    isRefetching: pubRefetching,
  } = published;
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });
  /*
    The drawn Views column. The desk already counts raw page views per story
    (`page_views`, keyed `story:<slug>`), and Stats already reads them through
    `getViewStatsFn`, which is what this calls -- the same numbers the Stats
    page shows, not a second counter. It is an editor-only read, so a
    non-owner's query fails and the column reads "-" rather than the page
    pretending every story has no readers.
  */
  const viewStats = useQuery({ queryKey: ["view-stats"], queryFn: () => getViewStatsFn() });
  const viewsBySlug = new Map((viewStats.data?.stories ?? []).map((s) => [s.slug, s.views]));
  const [legalFor, setLegalFor] = useState<number | null>(null);
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
  const [corrModelBySlug, setCorrModelBySlug] = useState<Record<string, StoryModelChoice>>({});
  /*
    "Also fix the story text", per slug, and the text being worked on. The
    printed body is seeded from the row when the box is opened, so the editor
    is editing the words on the paper rather than a blank page.
  */
  const [corrFixBySlug, setCorrFixBySlug] = useState<Record<string, boolean>>({});
  const [corrBodyBySlug, setCorrBodyBySlug] = useState<Record<string, string>>({});

  const [corrWarningBySlug, setCorrWarningBySlug] = useState<
    Record<string, { key: string; sentence: string }>
  >({});
  const [corrOverrideBySlug, setCorrOverrideBySlug] = useState<Record<string, string[]>>({});


  function clearCorrOverride(slug: string) {
    setCorrWarningBySlug((previous) => {
      if (!(slug in previous)) return previous;
      const next = { ...previous };
      delete next[slug];
      return next;
    });
    setCorrOverrideBySlug((previous) => {
      if (!(slug in previous)) return previous;
      const next = { ...previous };
      delete next[slug];
      return next;
    });
  }
  // Working / done / failed, and why, for the wording suggestion only.
  const [wordingFor, setWordingFor] = useState<{
    slug: string;
    kind: "working" | "ok" | "err";
    text: string;
  } | null>(null);
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
    mutationFn: (input: { slug: string; fixing: boolean; override?: string[] }) => {
      const payload = {
          articleSlug: input.slug,
          body: (corrBySlug[input.slug] ?? "").trim(),
          meetingReviewId: corrReviewFor[input.slug],
          alsoFixBody: input.fixing,
          storyBody: input.fixing ? (corrBodyBySlug[input.slug] ?? "") : undefined,
        override: input.override,
      };
      return addCorrection({ data: payload });
        },
    onSuccess: (res, input) => {
      const { slug } = input;
      if (res.ok) {
        setCorrBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrWrongBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrRightBySlug((prev) => ({ ...prev, [slug]: "" }));
        setCorrFixBySlug((prev) => ({ ...prev, [slug]: false }));
        clearCorrOverride(slug);
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
      } else if ("warning" in res) {

        setCorrWarningBySlug((previous) => ({ ...previous, [slug]: res.warning }));
        setCorrOverrideBySlug((previous) => ({
          ...previous,
          [slug]: [...new Set([...(previous[slug] ?? []), ...(input.override ?? [])])],
        }));
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
    mutationFn: ({ slug, modelChoice }: { slug: string; modelChoice: StoryModelChoice }) =>
      suggestCorrectionWording({
        data: {
          articleSlug: slug,
          wasWrong: (corrWrongBySlug[slug] ?? "").trim(),
          isRight: (corrRightBySlug[slug] ?? "").trim(),
          modelChoice,
        },
      }),
    onMutate: ({ slug }) => {
      setWordingFor({ slug, kind: "working", text: "Writing a correction note…" });
    },
    onSuccess: (res, { slug }) => {
      if (res.ok) {
        // New words, so any approval collected over the old ones is dropped.
        clearCorrOverride(slug);
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
    onError: (err, { slug }) => {
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
      suggestCorrectionTemplate({
        data: {
          articleSlug: slug,
          wasWrong: (corrWrongBySlug[slug] ?? "").trim(),
          isRight: (corrRightBySlug[slug] ?? "").trim(),
        },
      }),
    onSuccess: (res, slug) => {
      if (res.ok) {
        // New words, so any approval collected over the old ones is dropped.
        clearCorrOverride(slug);
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
      reviewId: number;
      slug: string;
      resolution: "still-accurate" | "correction-required";
      acceptedArtifactId: number;
    }) =>
      resolveMeetingArticleReview({
        data: {
          reviewId: input.reviewId,
          resolution: input.resolution,
          acceptedArtifactId: input.acceptedArtifactId,
          note: (reviewNotes[input.reviewId] ?? "").trim(),
          confirmedSegmentIndices: reviewChecks[input.reviewId] ?? [],
        },
      }),
    onSuccess: (res, input) => {
      if (!res.ok) {
        setNote({ kind: "err", text: res.error });
        return;
      }
      setNote({
        kind: "ok",
        text:
          input.resolution === "still-accurate"
            ? "Transcript revision reviewed. The published story remains unchanged."
            : "Marked for correction. Write and publish the correction below.",
      });
      if (input.resolution === "correction-required") {
        setCorrReviewFor((previous) => ({ ...previous, [input.slug]: input.reviewId }));
        setCorrFor(input.slug);
      }
      void qc.invalidateQueries({ queryKey: ["published-desk"] });
    },
    onError: (error) =>
      setNote({
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
          text:
            editorActionError(res.error, "change that headline") ??
            "Could not change that headline.",
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

  // The window the server sent: the rows to draw, how many matched in total,
  // and what each pill counts over the whole list rather than over this page.
  const rows = published.data?.rows ?? [];
  const pubTotal = published.data?.total ?? 0;
  const pubCounts = published.data?.counts;
  const transcriptReviews = rows.flatMap((article) =>
    article.transcriptReviews
      .map((review) => ({
        id: review.id,
        headline: article.headline,
        status: review.status,
      }))
      .filter((review) => review.status === "pending" || review.status === "correction-required"),
  );

  /*
    The four filters the design draws above the list, and the search box beside
    them, are decided in `src/lib/news/published-rows.ts`.

    They used to run here, over a list the screen had fetched whole, and they
    moved for one reason: a 25-row window is only correct if the filter runs
    BEFORE the page is cut, so the same predicates now run on the server. The
    reasoning behind each one -- "Opinion" reading the row's `topic`, "This week"
    measuring the last seven days against the row's own timestamp -- is recorded
    there, beside the code that does it, and each has a test that needs no
    database. What is left here is the window itself.
  */
  const shownRows = rows;

  return (
    <DeskShell title="Published" kicker="The record of what printed" hideTitle>
      {/*
        The drawn header: the kicker and title, the page's own action on the
        right, and the rule under the pair. DeskShell renders a title but no
        slot for a control beside it, so this screen draws the row itself and
        keeps `title` for the breadcrumb (see `.astra-head` in desk-astra.css).
        The action is a plain link to the paper: that is what the drawing puts
        there, and /desk/published is the screen where an editor is most likely
        to want to see the result.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">The record of what printed</p>
          <h1 className="h1">Published</h1>
        </div>
        <div className="astra-head-acts">
          <Link to="/" className="btn">
            View the paper <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
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
          <b>
            Priority: {transcriptReviews.length} published transcript{" "}
            {transcriptReviews.length === 1 ? "review needs" : "reviews need"} attention.
          </b>{" "}
          {transcriptReviews.map((review, index) => (
            <span key={review.id}>
              {index > 0 ? " · " : ""}
              <a href={`#transcript-review-${review.id}`} className="inline-link">
                {review.headline}
                {review.status === "correction-required"
                  ? " — correction required"
                  : " — review evidence"}
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
        <div>
          <div className="astra-toolbar">
            <div className="astra-seg" role="group" aria-label="Which stories to show">
              {(["all", "week", "corrections", "opinion"] as const).map((key) => {
                /*
                  Only "All" carries a number, which is how the drawing prints
                  the row ("All · 214", the other three bare). It counts the
                  whole list, not the page: a pill reading "All · 25" because 25
                  is as many rows as are loaded is the bug the window would
                  otherwise introduce.
                */
                const label =
                  key === "all"
                    ? `All · ${pubCounts?.all ?? rows.length}`
                    : key === "week"
                      ? "This week"
                      : key === "corrections"
                        ? "With corrections"
                        : "Opinion";
                return (
                  <button
                    key={key}
                    type="button"
                    className={"astra-seg-opt" + (pubFilter === key ? " on" : "")}
                    aria-pressed={pubFilter === key}
                    onClick={() => setPubFilter(key)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              className="astra-search"
              aria-label="Search published stories"
              placeholder="Search published stories…"
              value={pubQuery}
              onChange={(e) => setPubQuery(e.target.value)}
            />
          </div>
          {/*
            The column headers name the grid the rows below are laid out on. It
            is a plain row rather than a <table> because a row grows: the
            headline editor, the correction form and a transcript review all
            span it, and a table cell cannot do that without a colgroup for
            every case. Hidden below 980px, where the cells stack and labels
            stop meaning anything.
          */}
          <div className="astra-row pubhead" aria-hidden="true">
            <span>Printed</span>
            <span>Story</span>
            <span>Views</span>
            <span>Corrections</span>
            <span>Actions</span>
          </div>
          {shownRows.length === 0 ? <p className="wire-sum">Nothing matches that filter.</p> : null}
          {shownRows.map((p) => (
            <div key={p.id} className="astra-row pub">
              <LegalRemovalDialog open={legalFor === p.id} onOpenChange={(open) => { if (!open) setLegalFor(null); }} articleId={p.id} articles={[{ id: p.id, headline: p.headline }]} onDone={() => { void qc.invalidateQueries(); }} />
              <div className="astra-cell">
                <span className="astra-row-meta">{formatShortDate(p.published_at)}</span>
              </div>
              <div className="astra-cell">
                {/*
                  The section label and the headline, and nothing else, which is
                  how the design draws this row (docs/design/handoff-2026-09-26,
                  desk-19-published-dark.png / desk-20-published-light.png). The
                  dek and the filing score used to print here too, and between
                  them they made every row as tall as the story: a dek is ten
                  lines at this width. Both are on the story itself, one press
                  of View away, and the score is on the story's own page.
                */}
                <p className="astra-row-meta pub-kick">{sectionDisplayName(p.topic, sections)}</p>
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
                      Type the headline this story should read instead. The link does not change, so
                      nothing that points here breaks. The paper keeps a record of the old words.
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
                      <InkButton tone="quiet" onClick={() => setHeadFor(null)}>
                        Cancel
                      </InkButton>
                    </div>
                  </div>
                ) : null}
                {p.corrections.map((c, i) => (
                  <p key={i} className="pub-corr">
                    <b>Correction, {formatShortDate(c.date)}:</b> {c.body}
                  </p>
                ))}
                {p.transcriptReviews.map((review) => {
                  if (review.status === "verified" || review.status === "corrected") {
                    return (
                      <section
                        id={`transcript-review-${review.id}`}
                        key={review.id}
                        className="pub-corr"
                        aria-labelledby={`transcript-review-title-${review.id}`}
                      >
                        <h3 id={`transcript-review-title-${review.id}`}>
                          Transcript review history —{" "}
                          {review.status === "verified"
                            ? "marked still accurate"
                            : "correction published"}
                        </h3>
                        <p>
                          The published article remains tied to artifact A (
                          {review.priorArtifact.sha256.slice(0, 12)}…). The review concerned
                          artifact B ({review.currentArtifact.sha256.slice(0, 12)}…).
                        </p>
                        <p>
                          Completed{" "}
                          {review.resolvedAt
                            ? formatShortDate(review.resolvedAt)
                            : "at an unrecorded time"}
                          {review.resolvedBy
                            ? ` by editor account ${review.resolvedBy}`
                            : "; reviewer not recorded"}
                          .
                        </p>
                        {review.resolutionNote ? (
                          <p>
                            <b>Editor note:</b> {review.resolutionNote}
                          </p>
                        ) : null}
                        {review.status === "verified" ? (
                          review.acceptedEvidence ? (
                            <details>
                              <summary>
                                Accepted artifact B evidence (
                                {review.acceptedEvidence.citations.length} citations · SHA-256{" "}
                                {review.acceptedEvidence.artifactSha256.slice(0, 12)}…)
                              </summary>
                              <ul className="meeting-citations">
                                {review.acceptedEvidence.citations.map((citation) => (
                                  <li key={citation.segmentIndex}>
                                    <p>
                                      <b>Segment {citation.segmentIndex}</b> ·{" "}
                                      {Math.floor(citation.timestampSeconds / 60)}:
                                      {String(Math.floor(citation.timestampSeconds % 60)).padStart(
                                        2,
                                        "0",
                                      )}
                                    </p>
                                    <p>{citation.excerpt}</p>
                                    <p className="meta">
                                      Caption segment SHA-256 {citation.captionSha256}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : (
                            <p role="alert">
                              Accepted artifact B evidence is unavailable or malformed; consult the
                              review record before relying on this history.
                            </p>
                          )
                        ) : null}
                      </section>
                    );
                  }
                  const checked = reviewChecks[review.id] ?? [];
                  const allChecked =
                    review.citations.length > 0 &&
                    review.citations.every(
                      (c) => c.currentSegmentIndex != null && checked.includes(c.segmentIndex),
                    );
                  return (
                    <section
                      id={`transcript-review-${review.id}`}
                      key={review.id}
                      className="pub-corr"
                      aria-labelledby={`transcript-review-${review.id}`}
                    >
                      <h3 id={`transcript-review-${review.id}`}>
                        Transcript changed — evidence review required
                      </h3>
                      <p>
                        This story was published from artifact {review.priorArtifact.id} (
                        {review.priorArtifact.sha256.slice(0, 12)}…). The current recording is
                        artifact {review.currentArtifact.id} (
                        {review.currentArtifact.sha256.slice(0, 12)}…). The published story and its
                        original evidence have not been changed.
                      </p>
                      {review.citations.length ? (
                        review.citations.map((citation) => (
                          <div key={citation.segmentIndex} className="meeting-review-citation">
                            <p>
                              <b>Segment {citation.segmentIndex}</b>
                              {citation.timestampSeconds == null
                                ? ""
                                : ` · ${Math.floor(citation.timestampSeconds / 60)}:${String(Math.floor(citation.timestampSeconds % 60)).padStart(2, "0")}`}
                            </p>
                            <p>
                              <b>Published evidence:</b>{" "}
                              {citation.oldExcerpt ??
                                "The original excerpt is unavailable; inspect artifact A directly."}
                            </p>
                            <p>
                              <b>
                                Current evidence
                                {citation.currentSegmentIndex == null
                                  ? " comparison unavailable"
                                  : ` (artifact ${review.currentArtifact.id}, segment ${citation.currentSegmentIndex}${citation.currentTimestampSeconds == null ? "" : ` · ${Math.floor(citation.currentTimestampSeconds / 60)}:${String(Math.floor(citation.currentTimestampSeconds % 60)).padStart(2, "0")}`})`}
                                :
                              </b>{" "}
                              {citation.currentExcerpt ??
                                "No segment was found near the published citation timestamp. Inspect artifact B directly; this citation cannot be confirmed as still accurate yet."}
                            </p>
                            <label>
                              <input
                                type="checkbox"
                                disabled={citation.currentSegmentIndex == null}
                                checked={checked.includes(citation.segmentIndex)}
                                onChange={(event) =>
                                  setReviewChecks((previous) => ({
                                    ...previous,
                                    [review.id]: event.target.checked
                                      ? [
                                          ...new Set([
                                            ...(previous[review.id] ?? []),
                                            citation.segmentIndex,
                                          ]),
                                        ]
                                      : (previous[review.id] ?? []).filter(
                                          (value) => value !== citation.segmentIndex,
                                        ),
                                  }))
                                }
                              />
                              I checked this citation against the current recording.
                            </label>
                          </div>
                        ))
                      ) : (
                        <p>
                          No direct citation comparison is available. Treat this as correction work.
                        </p>
                      )}
                      <textarea
                        rows={2}
                        value={reviewNotes[review.id] ?? ""}
                        onChange={(event) =>
                          setReviewNotes((previous) => ({
                            ...previous,
                            [review.id]: event.target.value,
                          }))
                        }
                        placeholder="What did you verify, or what needs correction?"
                        aria-label={`Transcript review note for ${p.headline}`}
                      />
                      <div className="row-acts static">
                        <InkButton
                          disabled={
                            !allChecked ||
                            !(reviewNotes[review.id] ?? "").trim() ||
                            resolveTranscript.isPending
                          }
                          onClick={() =>
                            resolveTranscript.mutate({
                              reviewId: review.id,
                              slug: p.slug,
                              resolution: "still-accurate",
                              acceptedArtifactId: review.currentArtifact.id,
                            })
                          }
                        >
                          Still accurate — close review
                        </InkButton>
                        <InkButton
                          tone="quiet"
                          disabled={
                            !(reviewNotes[review.id] ?? "").trim() || resolveTranscript.isPending
                          }
                          onClick={() =>
                            resolveTranscript.mutate({
                              reviewId: review.id,
                              slug: p.slug,
                              resolution: "correction-required",
                              acceptedArtifactId: review.currentArtifact.id,
                            })
                          }
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
                  <Dialog
                    open
                    onClose={() => {
                      setCorrFor(null);
                      setWordingFor(null);
                      clearCorrOverride(p.slug);
                    }}
                    title="Add a correction"
                    subtitle={p.headline}
                    footNote="Appears on the story and in the public corrections log permanently."
                    primaryLabel={corrWarningBySlug[p.slug] ? "Publish anyway" : "Publish correction"}
                    primaryDisabled={corr.isPending}
                    pending={corr.isPending}
                    primaryPendingLabel="Publishing…"
                    onPrimary={() => {
                      const warning = corrWarningBySlug[p.slug];

                      const override = warning
                        ? [...new Set([...(corrOverrideBySlug[p.slug] ?? []), warning.key])]
                        : undefined;
                      if (override)
                        setCorrOverrideBySlug((previous) => ({ ...previous, [p.slug]: override }));
                      corr.mutate({
                        slug: p.slug,
                        fixing: corrFixBySlug[p.slug] === true,
                        override,
                      });
                    }}
                  >
                    <div className="r2-correction-fields">
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
                      onChange={(e) => {
                        clearCorrOverride(p.slug);
                        setCorrWrongBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }));
                      }}
                      placeholder="The fee was $4,200"
                    />
                    <label htmlFor={`pub-corr-right-${p.slug}`}>What is right</label>
                    <input
                      id={`pub-corr-right-${p.slug}`}
                      type="text"
                      value={corrRightBySlug[p.slug] ?? ""}
                      onChange={(e) => {
                        clearCorrOverride(p.slug);
                        setCorrRightBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }));
                      }}
                      placeholder="The fee is $2,400"
                    />
                    <ModelPicker
                      scope="story"
                      label="Correction wording model"
                      value={corrModelBySlug[p.slug] ?? "auto"}
                      onChange={(value) => setCorrModelBySlug((prev) => ({ ...prev, [p.slug]: value }))}
                      disabled={suggestWording.isPending}
                    />
                    <div className="row-acts static">
                      <InkButton
                        disabled={
                          !(corrWrongBySlug[p.slug] ?? "").trim() ||
                          !(corrRightBySlug[p.slug] ?? "").trim() ||
                          suggestWording.isPending
                        }
                        onClick={() => suggestWording.mutate({ slug: p.slug, modelChoice: corrModelBySlug[p.slug] ?? "auto" })}
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
                      <p className="meta" role={wordingFor.kind === "err" ? "alert" : "status"}>
                        {wordingFor.text}
                      </p>
                    ) : null}
                    <label htmlFor={`pub-corr-note-${p.slug}`}>The correction</label>
                    <textarea
                      id={`pub-corr-note-${p.slug}`}
                      rows={3}
                      value={corrBySlug[p.slug] ?? ""}
                      onChange={(e) => {
                        clearCorrOverride(p.slug);
                        setCorrBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }));
                      }}
                      placeholder="What was wrong, and what is right."
                    />
                    {/*
                      The second choice. Off by default, so the common case is
                      still a note above an untouched story; on, it opens the
                      printed text so the editor changes the words they can see
                      rather than retyping the story from memory. The two are
                      posted together, in one transaction.
                    */}
                    <label className="check-line design-check">
                      <input
                        type="checkbox"
                        checked={corrFixBySlug[p.slug] === true}
                        onChange={(e) => {
                          const opened = e.target.checked;
                          clearCorrOverride(p.slug);
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
                          The story text as it should read. The link does not change, and the paper
                          keeps the words that printed.
                        </label>
                        <textarea
                          id={`pub-corr-body-${p.slug}`}
                          rows={10}
                          value={corrBodyBySlug[p.slug] ?? p.body}
                          onChange={(e) => {
                            clearCorrOverride(p.slug);
                            setCorrBodyBySlug((prev) => ({ ...prev, [p.slug]: e.target.value }));
                          }}
                        />
                      </>
                    ) : null}
                    <div className="astra-preview">
                      <span className="astra-preview-kick">Preview · the note as readers will see it</span>
                      <p className="astra-preview-body"><b>Correction, {formatShortDate(new Date())}:</b> {(corrBySlug[p.slug] ?? "").trim() || "—"}</p>
                    </div>
                    {corrWarningBySlug[p.slug] ? (
                      <p className="astra-modal-alert" role="status">
                        {corrWarningBySlug[p.slug]!.sentence}
                      </p>
                    ) : null}
                    {note?.kind === "err" ? <p role="alert">{note.text}</p> : null}
                    </div>
                  </Dialog>
                ) : null}
              </div>
              {/*
                Corrections, as its own column rather than a paragraph under the
                story. What an editor scanning this list needs first is which
                stories have been corrected and which have a review still open;
                the words of the correction stay under the story where they are
                readable. A review that is still open is the one thing here that
                is a live obligation, so it is the one thing that carries amber.
              */}
              {/*
                Views, read out of the desk's own page-view counter by slug.
                A story with no recorded views prints 0, which is real
                information on this screen; a read that failed (a non-owner, or
                no views table yet) prints an em dash rather than 0, so "nobody
                is reading it" and "I cannot see" never look the same.
              */}
              <div className="astra-cell">
                <span className="astra-row-num">
                  <span className="r2-published-label">Views: </span>
                  {viewStats.isError ? "—" : (viewsBySlug.get(p.slug) ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="astra-cell">
                <span className="r2-published-label">Corrections:</span>
                {p.corrections.length > 0 ? (
                  <span className="astra-row-meta">
                    {p.corrections.length} correction{p.corrections.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="astra-row-meta">None</span>
                )}
                {p.transcriptReviews.some(
                  (review) =>
                    review.status === "pending" || review.status === "correction-required",
                ) ? (
                  <span className="astra-chip warn">Review needed</span>
                ) : null}
              </div>
              {/*
                Three acts on the row, as the design draws them: View, Edit
                headline, More. Reading, rewriting the headline and whatever is
                behind More is what this screen is for. Posting a correction and
                taking a story off the paper moved in behind More -- they are
                still here, one press further in, and the words a walk looks for
                did not change.
              */}
              <div className="astra-row-acts">
                <Link to="/articles/$slug" params={{ slug: p.slug }} className="btn quiet">
                  View
                </Link>
                <InkButton
                  tone="quiet"
                  onClick={() => {
                    // Seed the box with the words on the paper, so pressing
                    // Edit twice is never a way to lose them.
                    setHeadBySlug((prev) =>
                      prev[p.slug] ? prev : { ...prev, [p.slug]: p.headline },
                    );
                    setHeadFor(headFor === p.slug ? null : p.slug);
                  }}
                >
                  {headFor === p.slug ? "Close headline" : "Edit headline"}
                </InkButton>
                {/*
                  Delete's confirm stays on the row, exactly as it was: pressing
                  Delete in the More panel puts the panel away and the pair that
                  asks "are you sure" takes its place. The panel floats above the
                  row, so if it stayed open it would cover the pair it opened.
                */}
                {killFor === p.slug ? (
                  <>
                    {/*
                      Unit UI1a2: the confirm press carries the states --
                      "Removing…" with a spinner while the write is in flight.
                      Its DONE is the row leaving Published, which the list's
                      own removal already says.
                    */}
                    <ActionButton
                      tone="danger"
                      phase={rowActionPhase({
                        isPending: remove.isPending,
                        problem:
                          remove.isError && remove.variables === p.slug
                            ? remove.error instanceof Error
                              ? remove.error.message
                              : "Could not take that story off the paper."
                            : /* Unit UI1a3, finding 1: `deleteArticle` answers
                                 `{ ok: false, error }` for its ordinary refusal
                                 ("That story is already gone."), which settles
                                 as a SUCCESS -- so the reason is read off the
                                 settled answer too, or the control goes back to
                                 idle with the server's sentence nowhere near
                                 it. Gated on `!isPending` because React Query
                                 keeps the last answer on `data` while a new
                                 press runs. */
                              !remove.isPending && remove.variables === p.slug
                              ? refusedAnswer(remove.data)
                              : null,
                      })}
                      workingLabel="Removing…"
                      onAct={() => remove.mutate(p.slug)}
                    >
                      Yes, take it off
                    </ActionButton>
                    <ActionButton
                      tone="quiet"
                      phase="idle"
                      disabled={remove.isPending}
                      disabledReason={remove.isPending ? "The removal is still being saved." : null}
                      onAct={() => setKillFor(null)}
                    >
                      Keep it
                    </ActionButton>
                  </>
                ) : null}
                {/*
                  More, as the design draws it. The order is the design's: the
                  two things an editor does to a published story, then the two
                  rare ones -- hand the story to the legal removal desk, and jump
                  to an evidence review that is still open. The panel items are
                  plain buttons rather than InkButton because each one has to
                  close the panel it was pressed in, and InkButton hands its
                  onClick no event to find that panel with.
                */}
                <details className="row-more">
                  <summary className="btn quiet">More ▾</summary>
                  <div className="row-more-panel">
                    <button
                      type="button"
                      className="btn quiet"
                      onClick={(event) => {
                        const menu = event.currentTarget.closest("details");
                        menu?.removeAttribute("open");
                        menu?.querySelector<HTMLElement>("summary")?.focus();
                        setCorrFor(p.slug);
                      }}
                    >
                      Post correction
                    </button>
                    <button
                      type="button"
                      className="btn quiet"
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        setKillFor(p.slug);
                      }}
                    >
                      Delete
                    </button>
                    {deskRole.data?.ok && deskRole.data.role === "owner" ? (
                      <button type="button" className="btn quiet" onClick={(event) => {
                        const menu = event.currentTarget.closest("details");
                        menu?.removeAttribute("open");
                        menu?.querySelector<HTMLElement>("summary")?.focus();
                        setLegalFor(p.id);
                      }}>Legal removal</button>
                    ) : null}
                    {p.transcriptReviews.some(
                      (review) =>
                        review.status === "pending" || review.status === "correction-required",
                    ) ? (
                      <a
                        href={`#transcript-review-${p.transcriptReviews.find((review) => review.status === "pending" || review.status === "correction-required")?.id}`}
                      >
                        Go to the evidence review
                      </a>
                    ) : null}
                  </div>
                </details>
              </div>
            </div>
          ))}
          {/*
            The long-list footer. The real desk holds 214 published stories and
            drawing every one made a 17,615 px page nobody designed; the screen
            now asks the server for 25 at a time and this is where the reader
            asks for the next 25.

            Pagination is not drawn for any of the four lists -- the design only
            ever showed short ones -- so this borrows the Queue's drawn footer
            (see `.astra-list-foot`) and the button's words come from the brief
            rather than the drawing, which says "Load more" on the one footer it
            does draw. Both are recorded in SPEC-GAPS-0681.md.

            It sits above the note below so the note stays the screen's last
            word, where the drawing puts it.
          */}
          {pubTotal > 0 ? (
            <div className="astra-list-foot">
              <span>{showingLine(rows.length, pubTotal, "published stories")}</span>
              {rows.length < pubTotal ? (
                <button
                  type="button"
                  className="astra-list-more"
                  onClick={() => setPubShown((n) => n + PAGE_SIZE)}
                >
                  Show {PAGE_SIZE} more
                </button>
              ) : null}
            </div>
          ) : null}
          {/*
            The drawing's line under the table (`desk-19-published-dark.png`
            prints it in the gap after the last row, above whatever follows).
            It earns its place now that Legal removal is one press in behind
            More ▾: the only other signpost on this screen was a header link
            an editor had to already know to look for. Both halves are true of
            this application -- the flow asks for a required reason, and a
            removed story leaves the paper and the ordinary trash -- so the
            sentence is a description, not a promise. Owner-only, exactly as
            the panel's own link is: on any other desk it would name a door
            that is not there.
          */}
          {deskRole.data?.role === "owner" ? (
            <div className="mt-4">
              <p className="astra-note">
                Legal removal is under More ▾. It skips the trash and asks for a reason.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div id="beat-memory" />
      {/*
        0.6.82: the drawing's Published screen ends at the list. Beat memory is
        a working feature the drawing does not show, so it stays one press away,
        closed, instead of adding 80 rows (10,000 px) under the list.
      */}
      <details className="beat-memory">
        <summary className="astra-note">
          Beat memory ({memory.data?.length ?? 0}) — what the drafting AI is told we already covered
        </summary>
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
                <td className="td-meta wide" colSpan={3}>
                  Nothing tracked yet. Beat memory fills in once a story publishes and mentions an
                  entity.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </details>
    </DeskShell>
  );
}
