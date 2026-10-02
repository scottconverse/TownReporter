import { useState } from "react";
import { ChoiceCard, Dialog } from "@/components/dialog";
import { setLeadStatus } from "@/lib/news/desk";

/**
 * The Kill dialog, drawn as `dialog-09-kill.png`.
 *
 * Unit BH2 decision 5. This one is new behavior rather than a restyle: the
 * only kill on the story page before this was `killAsDuplicateOfPrior`, which
 * names the earlier lead and nothing else. The record it writes is the one
 * `setLeadStatus` already keeps -- `leads.kill_reason` (500) and
 * `leads.kill_reason_url` (2000), the two fields migration 0094 added and the
 * Queue already fills in with `duplicateKillReason` -- so this dialog adds a
 * path to that record, not a second record.
 *
 * Two things the drawing asks for that this deliberately does not do:
 *
 *   - "The Kill button and the X key both open this." There is no keyboard
 *     shortcut on this screen (the same reason unit BH left the drawn ⌘S badge
 *     off Save: a badge for a key that does nothing is a lie to the reader), so
 *     that clause is left out of the footnote rather than advertised.
 *   - Undo on the row. That belongs to the Queue's row, which is lane 3's
 *     surface (unit BH2 decision 5), not to this dialog.
 */
const QUICK_FILLS: { key: string; label: string; note?: string; reason: string }[] = [
  {
    key: "not-news",
    label: "Not news",
    note: "Routine notice, no public interest",
    reason: "Routine notice with no public interest.",
  },
  {
    key: "already-printed",
    label: "Already printed",
    note: "Matches a story we ran",
    reason: "Matches a story we have already printed.",
  },
  {
    key: "outside-area",
    label: "Outside our area",
    reason: "Outside our coverage area.",
  },
  {
    key: "bad-source",
    label: "Bad source or unreadable",
    reason: "The source is unusable, or the document cannot be read.",
  },
];

export type KillDialogProps = {
  /** The lead to kill. `setLeadStatus` takes the row id. */
  leadId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the kill has landed, so the page can refetch the lead. */
  onKilled?: () => void | Promise<void>;
};

export function KillDialog({ leadId, open, onOpenChange, onKilled }: KillDialogProps) {
  const [fill, setFill] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trimmed = reason.trim();

  /*
   * Cancel keeps the lead -- no call at all -- and keeps the box as it is, so
   * pressing Kill again to reread what you wrote never loses it. Only a landed
   * kill clears it.
   */
  function close() {
    onOpenChange(false);
  }

  async function kill(withReason: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await setLeadStatus({
        data: {
          id: leadId,
          status: "killed",
          // The field is optional on the wire, so "Kill, no reason" sends it
          // absent rather than as an empty string: `setLeadStatus` turns "" into
          // NULL anyway, and absent is what the schema means by "no reason".
          killReason: withReason && trimmed ? trimmed : undefined,
          killReasonUrl: withReason && url.trim() ? url.trim() : undefined,
        },
      });
      if (!res || typeof res !== "object" || !("ok" in res)) {
        setError("The desk did not answer. Nothing changed; try again.");
        return;
      }
      if (!res.ok) {
        setError("The desk refused that kill. The lead is unchanged.");
        return;
      }
      setFill(null);
      setReason("");
      setUrl("");
      await onKilled?.();
      onOpenChange(false);
    } catch {
      setError("The kill did not reach the desk. The lead is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Kill this lead"
      subtitle="Moves to Killed. The reason stays with it, with the time and any link."
      footNote="Cancel keeps the lead. The lead stays under Killed, and Undo stays on the row."
      cancelLabel="Cancel"
      altLabel="Kill, no reason"
      onAlt={() => void kill(false)}
      altDisabled={busy}
      primaryLabel="Kill with this reason"
      onPrimary={() => void kill(true)}
      primaryDisabled={busy || !trimmed}
      primaryTone="solid"
      /*
        Unit UI1a2: the press says what it is doing while it is out. Its FAILED
        is the dialog's own `error` line above (already `role="alert"`), and its
        DONE is the lead leaving this page for Killed, with `KilledLeadRecord`
        in its place -- the existing flow, and the one confirmation rule PUB2
        set means there is no second green "Killed" here.
      */
      pending={busy}
      primaryPendingLabel="Killing…"
      altPendingLabel="Killing…"
    >
      <div className="astra-field">
        <span className="astra-field-label" id="kill-quick-fill">
          Quick fill <span className="astra-field-opt">optional</span>
        </span>
        <div className="astra-choice-set" role="radiogroup" aria-labelledby="kill-quick-fill">
          {QUICK_FILLS.map((f) => (
            <ChoiceCard
              key={f.key}
              label={f.label}
              note={f.note}
              selected={fill === f.key}
              onSelect={() => {
                // Pressing the selected fill again clears it and the reason it
                // wrote -- otherwise the only way out of a fill is to retype
                // over it by hand.
                const next = fill === f.key ? null : f.key;
                setFill(next);
                setReason(next ? f.reason : "");
              }}
            />
          ))}
        </div>
      </div>
      <label className="astra-field">
        <span className="astra-field-label">
          Reason in your words <span className="astra-field-opt">optional</span>
        </span>
        <textarea
          rows={3}
          value={reason}
          maxLength={500}
          disabled={busy}
          onChange={(e) => {
            setReason(e.target.value);
            // Typing over a fill makes it no longer that fill's sentence.
            setFill(null);
          }}
          placeholder="A quick fill goes here; edit it or write your own"
        />
      </label>
      <label className="astra-field">
        <span className="astra-field-label">
          Link <span className="astra-field-opt">optional</span>
        </span>
        <input
          type="url"
          value={url}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (optional)"
        />
      </label>
      {error ? (
        <p className="astra-modal-alert" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
