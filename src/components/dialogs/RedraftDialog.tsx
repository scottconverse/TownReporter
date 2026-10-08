import { useEffect, useState } from "react";
import { ChoiceCard, Dialog } from "@/components/dialog";
import { ModelPicker } from "@/components/model-picker";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import type { ModelEffort } from "@/lib/news/provider-registry";

/**
 * The Redraft dialog, drawn as `dialog-04-redraft.png`.
 *
 * Unit BH2 decision 6. Same behavior as the press it replaces: the box is the
 * lead's story direction, and the start is `saveReportingNotes` followed by
 * `draftLead` -- the two calls the story page's own Redraft button already
 * makes, in the same order, with the same arguments. Nothing here writes
 * anything by itself.
 *
 * THREE PLACES THIS DIFFERS FROM THE DRAWING, each because the drawing claims
 * something the desk does not do:
 *
 *   - the subtitle. Drawn: "any text you marked as yours are kept." There is no
 *     mark for text. The only thing a redraft is known to preserve is the
 *     headline the editor wrote -- `headlineForRedraft` keeps it when
 *     `headline_source` is "editor", and takes the model's line otherwise --
 *     so the subtitle says that and nothing more.
 *   - the Keep group keeps one card, not three. `draftLead` has no keep-mode at
 *     all: the body is regenerated whichever card is pressed, and a card that
 *     offered "start fresh from the records" or "my headline only" would be a
 *     control for a parameter that does not exist. The card that is left states
 *     the one rule the desk actually enforces.
 *   - the model row is the desk's own `ModelPicker`. The drawing shows the model
 *     and the effort as values with a note pointing at Server → Models; they are
 *     per-job settings set on this screen ("Redraft settings" on the story
 *     page), and the picker is the control that sets them, so it is the control
 *     that goes in the row.
 */
export type RedraftDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lead's saved story direction. Seeds the box; never overwrites typing. */
  direction: string;
  modelChoice: StoryModelChoice;
  /**
   * `null` is the page's own state before a model is picked, and the same value
   * `ModelPicker` takes: it means "whatever this model defaults to". Typed to
   * match the picker rather than narrowed, so a page can hand its state over
   * without a second guess about what the default is.
   */
  modelEffort: ModelEffort | null;
  writerStatus?: { label: string; tone: string };
  onModelChange: (choice: StoryModelChoice) => void;
  onEffortChange: (effort: ModelEffort | null) => void;
  /** True while a draft is already running, so a second one cannot start. */
  busy?: boolean;
  /** Saves the direction and starts the redraft. */
  onStart: (direction: string) => void;
  /** Why the start did not happen, when the desk said so. */
  error?: string;
};

export function RedraftDialog({
  open,
  onOpenChange,
  direction,
  modelChoice,
  modelEffort,
  writerStatus,
  onModelChange,
  onEffortChange,
  busy,
  onStart,
  error,
}: RedraftDialogProps) {
  const [what, setWhat] = useState(direction);

  /*
   * The saved direction usually arrives after this component has mounted (the
   * lead is still loading), so an empty box takes it when it lands. A box the
   * editor has typed in is left alone -- Cancel keeps the typing, the same as
   * the Kill dialog keeps its reason.
   */
  useEffect(() => {
    setWhat((current) => (current.trim() ? current : direction));
  }, [direction]);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Redraft"
      subtitle="Ask for a new version. The AI writes the story; your headline is kept if you wrote it."
      footNote="The current draft is kept. You'll compare the two before choosing."
      cancelLabel="Cancel"
      primaryLabel="Start redraft"
      primaryDisabled={busy}
      primaryTone="solid"
      onPrimary={() => onStart(what)}
    >
      <label className="astra-field">
        <span className="astra-field-label">What should change?</span>
        <textarea
          rows={3}
          value={what}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="e.g. lead with the cancellation, cut the context paragraph, shorter"
        />
      </label>
      <div className="astra-field">
        <span className="astra-field-label" id="redraft-keep">
          Keep
        </span>
        <div className="astra-choice-set" role="radiogroup" aria-labelledby="redraft-keep">
          <ChoiceCard
            label="My headline and my edits"
            note="Your headline is kept when you wrote it; the model's own line otherwise."
            selected
          />
        </div>
      </div>
      <div className="astra-set-row">
        <span className="astra-field-label" id="redraft-model">
          Model and effort
        </span>
        <ModelPicker
          value={modelChoice}
          onChange={onModelChange}
          effort={modelEffort}
          onEffortChange={onEffortChange}
          disabled={busy}
          compact
        />
        <span className="astra-modal-note-inline">Set per job in Redraft settings.</span>
        {writerStatus ? <span className={`astra-wb-ready astra-wb-ready-${writerStatus.tone}`} role="status">{writerStatus.label}</span> : null}
      </div>
      {error ? (
        <p className="astra-modal-alert" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
