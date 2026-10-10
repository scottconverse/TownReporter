import { useEffect, useState } from "react";
import { ChoiceCard, Dialog } from "@/components/dialog";
import { ModelPicker } from "@/components/model-picker";
import { addCorrection, suggestCorrectionWording } from "@/lib/news/desk";
import { correctionTemplate } from "@/lib/news/correction-wording";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { formatShortDate } from "@/lib/paper";



const STORY_TEXT_AS_IS = { key: "as-is", label: "Leave the story text as is", note: "Default. Only the correction note is posted." };
const STORY_TEXT_FIX = { key: "also-fix", label: "Also fix the story text", note: "Changes the published text to match" };

/**
 * One core warning, as `override.ts` answers a first press:
 * `{ ok: false, warning: { key, sentence } }`. The sentence is shown, and
 * pressing again sends `override: [key]` -- the same request, now with the
 * editor's answer attached.
 */
type CorrectionWarning = { key: string; sentence: string };


function warningOf(res: unknown): CorrectionWarning | null {
  if (!res || typeof res !== "object" || !("warning" in res)) return null;
  const raw = (res as { warning?: unknown }).warning;
  if (!raw || typeof raw !== "object") return null;
  const { key, sentence } = raw as { key?: unknown; sentence?: unknown };
  return typeof key === "string" && typeof sentence === "string" ? { key, sentence } : null;
}

export type CorrectionDialogProps = {
  /** The article this correction belongs to, by slug -- `addCorrection` takes the slug. */
  articleSlug: string;
  /** The printed text, for the "Also fix the story text" box. */
  articleBody?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The open meeting/transcript review this correction answers, if any. */
  reviewId?: number;
  /** What that review is, for the read-only "Reader request" line. */
  reviewLabel?: string;
  /** Called after a correction lands, so the page can refetch what it lists. */
  onPosted?: () => void | Promise<void>;
  /** The paper's own short-date formatter, so the preview reads in its timezone. */
  formatDate?: (iso: string | Date | null | undefined) => string;
};

export function CorrectionDialog({
  articleSlug,
  articleBody = "",
  open,
  onOpenChange,
  reviewId,
  reviewLabel,
  onPosted,
  formatDate,
}: CorrectionDialogProps) {
  const [wasWrong, setWasWrong] = useState("");
  const [isRight, setIsRight] = useState("");
  /*
   * `null` means the editor has not touched the note, so it stays the desk's
   * own sentence and follows the two lines as they are typed. A string -- typed
   * or suggested -- wins from then on, which is what makes the AI suggestion and
   * a hand-written note the same kind of thing.
   */
  const [note, setNote] = useState<string | null>(null);
  const [fix, setFix] = useState(false);
  const [storyBody, setStoryBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<CorrectionWarning | null>(null);
  const [overrideKeys, setOverrideKeys] = useState<string[]>([]);
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [wording, setWording] = useState<{ kind: "working" | "ok" | "err"; text: string } | null>(null,
  );


  function resetOverride() {
    setWarning(null);
    setOverrideKeys([]);
  }

  useEffect(() => {
    // Reopening starts clean, even if the component stayed mounted through a
    // dismissed dialog. Written inline so the hook's dependency is exactly the
    // `open` flag and not a function that changes every render.
    if (open) {
      setWarning(null);
      setOverrideKeys([]);
    }
  }, [open]);

  const deskNote = correctionTemplate(wasWrong, isRight) ?? "";
  const effective = note ?? deskNote;
  const shortDate = formatDate ?? ((iso: string | Date | null | undefined) => formatShortDate(iso));

  function close() {
    resetOverride();
    setError("");
    onOpenChange(false);
  }

  async function suggest() {
    setBusy(true);
    setError("");
    setWording({ kind: "working", text: "Writing a correction note…" });
    try {
      const res = await suggestCorrectionWording({
        data: { articleSlug, wasWrong: wasWrong.trim(), isRight: isRight.trim(), modelChoice },
      });
      if (!res || typeof res !== "object" || !("ok" in res)) {
        setWording({ kind: "err", text: "The desk did not answer. Your box is exactly as you left it." });
        return;
      }
      if (!res.ok) {
        setWording({ kind: "err", text: res.error });
        return;
      }
      setNote(res.wording);
      setWording({ kind: "ok", text: "Suggested below. Read it, change any of it, then post it." });
    } catch {
      setWording({
        kind: "err",
        text: "Could not reach the story model. Your box is exactly as you left it.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    setBusy(true);
    setError("");
    try {
      const res = await addCorrection({
        data: {
          articleSlug,
          body: effective.trim(),
          meetingReviewId: reviewId,
          alsoFixBody: fix,
          storyBody: fix ? (storyBody ?? articleBody) : undefined,
          override: overrideKeys.length ? overrideKeys : undefined,
        },
      });
      if (!res || typeof res !== "object" || !("ok" in res)) {
        setError("The desk did not answer. Nothing was posted.");
        return;
      }
      if (!res.ok) {

        const warned = warningOf(res);
        if (warned) {
          setError("");
          setWarning(warned);
          setOverrideKeys((keys) => (keys.includes(warned.key) ? keys : [...keys, warned.key]));
          return;
        }
        setError("error" in res ? String(res.error) : "Could not post that correction.");
        return;
      }
      setWasWrong("");
      setIsRight("");
      setNote(null);
      setFix(false);
      setStoryBody(null);
      setWording(null);
      resetOverride();
      await onPosted?.();
      onOpenChange(false);
    } catch {
      setError("The correction did not reach the desk. Nothing was posted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a correction"
      subtitle="Appears at the bottom of the story and in the public corrections log."
      footNote="Posted on the story and in the public corrections log. The correction note stays permanently."
      cancelLabel="Cancel"
      altLabel="Suggest wording (AI)"
      onAlt={() => void suggest()}
      altDisabled={busy || !wasWrong.trim() || !isRight.trim()}
      primaryLabel={warning ? "Post anyway" :"Post as a plain note"}
      onPrimary={() => void post()}
      primaryDisabled={busy}
      primaryTone="solid"
    >
      <label className="astra-field">
        <span className="astra-field-label">What was wrong</span>
        <textarea
          rows={3}
          value={wasWrong}
          maxLength={400}
          disabled={busy}
          onChange={(e) => {
            resetOverride(); setWasWrong(e.target.value);
          }}
          placeholder="e.g. The story said Sept. 22; the incident was Sept. 21."
        />
      </label>
      <label className="astra-field">
        <span className="astra-field-label">What is right</span>
        <textarea
          rows={3}
          value={isRight}
          maxLength={400}
          disabled={busy}
          onChange={(e) => {
            resetOverride(); setIsRight(e.target.value);
          }}
          placeholder="What the story should have said"
        />
      </label>
      <ModelPicker
        scope="story"
        label="Correction wording model"
        value={modelChoice}
        onChange={(choice) => {
          resetOverride();setModelChoice(choice);
        }}
        disabled={busy}
      />
      <div className="astra-field">
        <span className="astra-field-label" id="correction-story-text">
          The story text
        </span>
        <div className="astra-choice-set" role="radiogroup" aria-labelledby="correction-story-text">
          <ChoiceCard
            label={STORY_TEXT_AS_IS.label}
            note={STORY_TEXT_AS_IS.note}
            selected={!fix}
            onSelect={() => {
              resetOverride(); setFix(false);
            }}
          />
          <ChoiceCard
            label={STORY_TEXT_FIX.label}
            note={STORY_TEXT_FIX.note}
            selected={fix}
            onSelect={() => {
              resetOverride(); setFix(true);
            }}
          />
        </div>
      </div>
      {fix ? (
        <label className="astra-field">
          <span className="astra-field-label">The story text as it should read</span>
          <textarea
            rows={8}
            value={storyBody ?? articleBody}
            disabled={busy}
            onChange={(e) => {
              resetOverride(); setStoryBody(e.target.value);
            }}
          />
        </label>
      ) : null}
      <label className="astra-field">
        <span className="astra-field-label">
          Reader request <span className="astra-field-opt">optional</span>
        </span>
        <input
          type="text"
          readOnly
          value={reviewLabel ?? ""}
          placeholder="No linked reader request"
        />
      </label>
      <label className="astra-field">
        <span className="astra-field-label">The correction</span>
        <textarea
          rows={4}
          value={effective}
          disabled={busy}
          onChange={(e) => {
            resetOverride(); setNote(e.target.value);
          }}
          placeholder="What was wrong, and what is right."
        />
      </label>
      {wording ? (
        <p className="astra-modal-alert" role={wording.kind === "err" ? "alert" : "status"}>
          {wording.text}
        </p>
      ) : null}
      <div className="astra-preview">
        <span className="astra-preview-kick">Preview · the note as readers will see it</span>
        <p className="astra-preview-body">
          <b>Correction, {shortDate(new Date())}:</b> {effective.trim() || "—"}
        </p>
        <p className="astra-preview-note">
          Shown at the bottom of the story and in the public corrections log. Nothing posts until
          you press Post.
        </p>
      </div>
      {warning ? (
        <p className="astra-modal-alert" role="alert">
          {warning.sentence}
        </p>
      ) : null}
      {error ? (
        <p className="astra-modal-alert" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
