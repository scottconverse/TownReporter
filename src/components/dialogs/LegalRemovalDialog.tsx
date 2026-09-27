import { useEffect, useRef, useState } from "react";
import { ChoiceCard, Dialog } from "@/components/dialog";
import { InkButton } from "@/components/desk-chrome";
import { legalConfirm, legalPreview } from "@/lib/news/legal-removal";
import type { LegalPreview, LegalSelection } from "@/lib/news/legal-removal-types";

/**
 * Legal removal: one flow, two places to stand it.
 *
 * Unit BH2 decision 3. The flow itself -- preview, fingerprint, retain/destroy,
 * REMOVE to confirm, the danger press -- used to live inline in
 * `src/routes/desk.legal-removals.tsx` and nowhere else, so a link was the only
 * way in and the drawn `dialog-15-legal.png` could not exist. It is extracted
 * here once and rendered by both: the route (links keep working, same
 * behavior) and `LegalRemovalDialog` (the design's dialog, opened from a story).
 *
 * Unit BH3. The body now follows the drawing's order. `dialog-15-legal.png` is
 * ONE screen, top to bottom: the rule for the removed text, the reason, `Type
 * REMOVE to confirm`, then the four consequence rows, then the foot. Both
 * surfaces draw that same body -- the route keeps its step one above it (pick
 * the stories, `Review connected copies`), the dialog opens on one story and
 * loads the preview for it on open, because the drawing shows no picker.
 *
 * The gate is the dangerous part and it is NOT re-derived anywhere: the flow
 * computes one `disabled` expression -- busy, a stale preview, REMOVE not typed,
 * no case reference, blockers, or destruction while review is pending -- and
 * either draws the press itself or hands that same expression to a parent that
 * draws it in a dialog footer. A second copy of the gate is how one of the two
 * surfaces quietly becomes the soft one.
 */

const FIELD = "w-full border border-rule bg-paper p-2 text-sm";

export type LegalRemovalPress = {
  /** True when the press must not fire. The whole gate, in one place. */
  disabled: boolean;
  busy: boolean;
  label: string;
  onPress: () => void;
};

export type LegalRemovalFlowProps = {
  /**
   * The stories the owner may pick. `null` while they are loading, `[]` when
   * there are none.
   */
  articles: { id: number; headline: string }[] | null;
  articlesPending?: boolean;
  articlesError?: boolean;
  /** The stories this flow starts with selected -- the dialog is opened on one. */
  initialArticleIds?: number[];
  /** Called with the case id once a removal is confirmed. Never called otherwise. */
  onConfirmed: (caseId: string) => void | Promise<void>;
  /**
   * When given, the flow does not draw the danger press or the return link: it
   * reports the gate here on every change and the caller draws the footer.
   * Without it the flow draws them itself, exactly as the route always has.
   */
  onPressChange?: (press: LegalRemovalPress) => void;
  /**
   * Unit BH3: the drawn dialog opens on ONE story and shows no picker, so step
   * one is skipped and the preview is loaded on the spot -- the same
   * `legalPreview` call the route's `Review connected copies` press makes, with
   * the same selection object, so the gate and the fingerprint below are the
   * same gate and the same fingerprint.
   */
  autoPreview?: boolean;
};

export function LegalRemovalFlow({
  articles,
  articlesPending,
  articlesError,
  initialArticleIds,
  onConfirmed,
  onPressChange,
  autoPreview,
}: LegalRemovalFlowProps) {
  const [selection, setSelection] = useState<LegalSelection>({
    articleIds: initialArticleIds ?? [],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: false,
    reviewedEvidence: false,
  });
  const [preview, setPreview] = useState<LegalPreview | null>(null);
  const [policy, setPolicy] = useState<"retain" | "destroy">("retain");
  const [caseRef, setCaseRef] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copiesOpen, setCopiesOpen] = useState(false);

  const currentPreview = preview && JSON.stringify(preview.selection) === JSON.stringify(selection);

  function change(next: LegalSelection) {
    setSelection(next);
    setConfirm("");
  }

  async function review() {
    setBusy(true);
    setError("");
    try {
      const result = await legalPreview({ data: selection });
      if (result.ok) {
        setPreview(result.value);
        setSelection(result.value.selection);
      } else setError(result.error);
    } catch {
      setError("Could not load the impact preview. Your selection is preserved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await legalConfirm({
        data: { selection, fingerprint: preview.fingerprint, policy, caseRef },
      });
      if (result.ok) {
        await onConfirmed(result.value.caseId);
      } else setError(result.error);
    } catch {
      setError("No removal is confirmed. Reload the case list before retrying.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * The dialog's step one, done for the editor. `autoPreview` fires once, at
   * mount, which is the moment the dialog opens -- `Dialog` draws its children
   * only while `open`, so this component is not even mounted while the dialog
   * is shut and a shut dialog never calls the server. The ref is what keeps it
   * to one call: without it every later render of this effect would re-ask.
   */
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoPreview || autoLoaded.current || !selection.articleIds.length) return;
    autoLoaded.current = true;
    void reviewRef.current();
  }, [autoPreview, selection.articleIds.length]);

  const pressDisabled =
    busy ||
    !currentPreview ||
    confirm !== "REMOVE" ||
    !caseRef ||
    (preview?.blockers.length ?? 0) > 0 ||
    (policy === "destroy" && preview?.reviewPending === true);

  /*
   * The press, hoisted when a dialog owns the footer. `onPress` is read through
   * a ref so the effect below can depend on the two values that make up the
   * gate alone: a new closure every render would otherwise republish the gate
   * on every keystroke and re-render the footer for nothing.
   */
  const pressRef = useRef(remove);
  pressRef.current = remove;
  const publish = onPressChange;
  useEffect(() => {
    publish?.({
      disabled: pressDisabled,
      busy,
      label: "Remove selected stories and connected copies",
      onPress: () => void pressRef.current(),
    });
  }, [publish, pressDisabled, busy]);

  const storyCount = selection.articleIds.length;
  const captures = preview?.capturedCopies ?? [];

  return (
    <>
      {autoPreview ? null : (
        <>
          <p>
            This is separate from ordinary 30-day trash. There is no Undo. Retained copies are
            protected by owner access, <strong>not encryption</strong>. Existing backups, provider
            records and reader caches cannot be recalled by this application.
          </p>
          <fieldset className="astra-fieldset">
            <legend>Articles to remove</legend>
            {articlesPending ? (
              <p>Loading published articles…</p>
            ) : articlesError ? (
              <p role="alert">Could not load articles. Reload this page.</p>
            ) : !articles?.length ? (
              <p>
                No published stories to remove.{" "}
                <a className="underline" href="/desk/published">
                  Back to Published
                </a>
                .
              </p>
            ) : (
              articles.map((a) => (
                <label className="astra-check" key={a.id}>
                  <input
                    type="checkbox"
                    checked={selection.articleIds.includes(a.id)}
                    onChange={(e) =>
                      change({
                        ...selection,
                        articleIds: e.target.checked
                          ? [...selection.articleIds, a.id]
                          : selection.articleIds.filter((id) => id !== a.id),
                      })
                    }
                  />
                  <span>{a.headline}</span>
                </label>
              ))
            )}
          </fieldset>
          <InkButton disabled={busy || !selection.articleIds.length} onClick={() => void review()}>
            Review connected copies
          </InkButton>
        </>
      )}
      {preview ? (
        <>
          {/*
            `dialog-15-legal.png`, in the drawing's order: the rule for the text,
            the reason, REMOVE, then the four consequence rows. The rows are
            drawn as drawn -- "Will remove" on three of them and the danger
            border on the backups -- because the coordinator read BH2's
            objection to them and asked for the drawing anyway. Two of the four
            carry a claim this preview did not measure, and the report says
            which: the drawing's "the URL returns 410 Gone" (this application
            answers 404 -- `articles.$slug.tsx` throws `notFound()` for a story
            that is no longer published) and its search-index/RSS line (the
            feed and sitemap are built from the published rows at request time).
            The captured-records row is the one the preview really counts, and
            the count drawn there is the real number.
          */}
          <div className="astra-field">
            <span className="astra-field-label" id="legal-policy">
              What happens to the removed text
            </span>
            <div className="astra-choice-set" role="radiogroup" aria-labelledby="legal-policy">
              <ChoiceCard
                label="Keep a sealed copy for 12 months (default)"
                note="Owner-only, never public. Deleted automatically after 12 months."
                selected={policy === "retain"}
                onSelect={() => {
                  setPolicy("retain");
                  setConfirm("");
                }}
              />
              <ChoiceCard
                label="Keep nothing: a court order requires destruction"
                note="No copy of the text is kept anywhere the desk controls."
                selected={policy === "destroy"}
                onSelect={() => {
                  setPolicy("destroy");
                  setConfirm("");
                }}
              />
            </div>
          </div>
          <label className="astra-field">
            <span className="astra-field-label">Reason (required)</span>
            <input
              className={FIELD}
              value={caseRef}
              onChange={(e) => setCaseRef(e.target.value)}
              maxLength={120}
              placeholder="e.g. Court order, case no. …"
            />
          </label>
          <label className="astra-field">
            <span className="astra-field-label">Type REMOVE to confirm</span>
            <input
              className={FIELD}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="REMOVE"
            />
          </label>
          <div className="astra-impacts">
            <div className="astra-impact">
              <span className="astra-impact-what">
                <b>{storyCount === 1 ? "Public story page" : `${storyCount} public story pages`}</b>
                <span className="astra-impact-note">
                  {storyCount === 1
                    ? "Removed now; the URL returns 410 Gone"
                    : "Removed now; each URL returns 410 Gone"}
                </span>
              </span>
              <span className="astra-impact-act">Will remove</span>
            </div>
            <div className="astra-impact">
              <span className="astra-impact-what">
                <b>
                  {storyCount === 1
                    ? "Captured records for this story"
                    : "Captured records for these stories"}
                </b>
                <span className="astra-impact-note">
                  {captures.length
                    ? `${captures.length} capture${captures.length === 1 ? "" : "s"} · kept unless you also remove them`
                    : "No captured records found"}
                </span>
              </span>
              <button
                type="button"
                className="astra-impact-act astra-impact-toggle"
                aria-expanded={copiesOpen}
                aria-controls="legal-captured-copies"
                onClick={() => setCopiesOpen((open) => !open)}
              >
                Keep <span aria-hidden="true">▾</span>
              </button>
            </div>
            <div className="astra-impact">
              <span className="astra-impact-what">
                <b>Search index and RSS</b>
                <span className="astra-impact-note">Removed now</span>
              </span>
              <span className="astra-impact-act">Will remove</span>
            </div>
            <div className="astra-impact danger">
              <span className="astra-impact-what">
                <b>Nightly backups</b>
                <span className="astra-impact-note">
                  Up to 30 days of backups still hold the story. Needs operator review.
                </span>
              </span>
              <span className="astra-impact-act">Review</span>
            </div>
          </div>
          {/*
            What the drawing's "Keep ▾" opens. The list is the preview's real
            `capturedCopies`; the sentence around it is what this application
            does to them, which is the same thing the flow has always said and
            the same thing `removeLegally` does: the captures are never deleted,
            the watches aimed at the story are paused and matching sources stop
            being scanned, and a court destruction stays blocked until an
            operator resolves them.
          */}
          {copiesOpen && (
            <div className="astra-impact-more" id="legal-captured-copies">
              {captures.length ? (
                <>
                  <p>
                    Known captured copies need separate local-operator review:{" "}
                    {captures.map((c) => `${c.table} #${c.id}`).join(", ")}. They are independently
                    held evidence and are not deleted here; this removal pauses the watches aimed at
                    the story and excludes matching sources from scans instead. Court destruction
                    stays blocked until an operator resolves them — the review checkbox below does
                    not override that.
                  </p>
                </>
              ) : (
                <p>
                  The preview found no captured copies of this story. Removal still cannot reach
                  backups, provider records or reader caches that this application cannot see.
                </p>
              )}
            </div>
          )}
          {!currentPreview && (
            <p role="status">
              Selection changed. Use Review connected copies again to refresh counts before
              confirming.
            </p>
          )}
          {preview.blockers.map((message) => (
            <p role="alert" key={message}>
              {message}
            </p>
          ))}
          <p>
            {policy === "retain"
              ? "The retained copy expires automatically. Evidence review and external cleanup may remain pending."
              : "No removed text will enter the retained-copy table. Resolve the historical and shared-evidence review first. External erasure still needs operator verification."}
          </p>
          <p>
            Historical records do not always carry an article ID. Select only the drafts, memory
            entries, audit labels and trash copies that belong to these stories. Shared source
            documents remain independent evidence unless explicitly brought into the removal scope.
          </p>
          {preview.selectedHistorical.length > 0 && (
            <fieldset className="astra-fieldset">
              <legend>Selected historical records — uncheck to remove from scope</legend>
              {preview.selectedHistorical.map((c) => (
                <label className="astra-check" key={`${c.kind}-${c.id}`}>
                  <input
                    type="checkbox"
                    checked={selection[c.kind].includes(c.id)}
                    onChange={() =>
                      change({
                        ...selection,
                        [c.kind]: selection[c.kind].filter((id) => id !== c.id),
                      })
                    }
                  />
                  <span>
                    {c.kind.replace("Ids", "")} #{c.id}: {c.label}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <details>
            <summary>Review historical candidates ({preview.candidates.length})</summary>
            {preview.candidates.map((c) => (
              <label className="astra-check astra-check-wrap" key={`${c.kind}-${c.id}`}>
                <input
                  type="checkbox"
                  checked={selection[c.kind].includes(c.id)}
                  onChange={(e) =>
                    change({
                      ...selection,
                      [c.kind]: e.target.checked
                        ? [...selection[c.kind], c.id]
                        : selection[c.kind].filter((id) => id !== c.id),
                    })
                  }
                />
                <span>
                  {c.kind.replace("Ids", "")} #{c.id}: {c.label}
                </span>
              </label>
            ))}
          </details>
          {preview.sharedInvestigationIds.length > 0 && (
            <p>
              Related investigation files:{" "}
              {preview.sharedInvestigationIds.map((id) => `#${id}`).join(", ")}.{" "}
              <a className="underline" href="/desk/dark">
                Open Dark Desk to review these files
              </a>
              . Review independently shared evidence before claiming destruction complete.
            </p>
          )}
          <label className="astra-check">
            <input
              type="checkbox"
              checked={selection.reviewedLegacy}
              onChange={(e) => change({ ...selection, reviewedLegacy: e.target.checked })}
            />
            <span>
              I reviewed the historical candidates and selected the copies in scope. Unselected
              records are independent work.
            </span>
          </label>
          <label className="astra-check">
            <input
              type="checkbox"
              checked={selection.reviewedEvidence}
              onChange={(e) => change({ ...selection, reviewedEvidence: e.target.checked })}
            />
            <span>
              I reviewed shared evidence; anything retained is independently held and outside this
              removal scope.
            </span>
          </label>
          {onPressChange ? null : (
            <div className="astra-flow-press">
              <InkButton tone="danger" disabled={pressDisabled} onClick={() => void remove()}>
                Remove selected stories and connected copies
              </InkButton>
              <a className="ml-4 underline" href="/desk/published">
                Cancel and return to Published
              </a>
            </div>
          )}
        </>
      ) : autoPreview ? (
        /*
          Step one is not drawn here, so this is the only state that can stand
          in its place: the preview is on its way, or it failed. `review()` is
          fired once at mount, so a failure needs its own press -- there is no
          `Review connected copies` button on this surface to press again.
        */
        <div className="astra-flow-press">
          {error ? null : <p role="status">Loading the impact preview for this story…</p>}
          {error ? (
            <InkButton tone="ghost" disabled={busy} onClick={() => void review()}>
              Try the preview again
            </InkButton>
          ) : null}
        </div>
      ) : null}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export type LegalRemovalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The story this removal is about, selected when the dialog opens. */
  articleId?: number;
  articles: { id: number; headline: string }[] | null;
  articlesPending?: boolean;
  articlesError?: boolean;
  /** Called with the new case id once a removal is confirmed. */
  onConfirmed?: (caseId: string) => void | Promise<void>;
  /** Called on cancel and on success, so a page can refetch what it lists. */
  onDone?: () => void;
};

/**
 * The drawn `dialog-15-legal.png`. The dialog owns nothing but the footer: every
 * field, count, blocker and the gate itself come from `LegalRemovalFlow`, so the
 * route and this dialog cannot drift into two different legal removals.
 *
 * Unit BH3: it opens straight onto the drawn one-screen body -- no article
 * picker, the preview for `articleId` loaded on open. The drawing names no
 * story anywhere on it, so the dialog relies on the Published row it was opened
 * from; the story count and the captured-records count below are the two things
 * on screen that still say how much is in scope.
 */
export function LegalRemovalDialog({
  open,
  onOpenChange,
  articleId,
  articles,
  articlesPending,
  articlesError,
  onConfirmed,
  onDone,
}: LegalRemovalDialogProps) {
  const [press, setPress] = useState<LegalRemovalPress | null>(null);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Legal removal"
      subtitle="This bypasses the recoverable trash. Removing a page does not prove every copy is gone."
      footNote="The restricted record keeps who, when, why and what. The rule chosen above decides whether a sealed copy of the text is kept."
      cancelLabel="Cancel"
      primaryLabel="Remove permanently"
      primaryTone="quiet-danger"
      primaryDisabled={!press || press.disabled}
      onPrimary={() => press?.onPress()}
    >
      <LegalRemovalFlow
        articles={articles}
        articlesPending={articlesPending}
        articlesError={articlesError}
        initialArticleIds={articleId ? [articleId] : []}
        onPressChange={setPress}
        autoPreview
        onConfirmed={async (caseId) => {
          await onConfirmed?.(caseId);
          onDone?.();
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}
