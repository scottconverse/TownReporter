import { updateLead } from "@/components/scoped-actions";
import { useState } from "react";
import { Dialog } from "@/components/dialog";

import { parseUrlList, TOPICS } from "@/lib/paper";

/**
 * "Edit the lead" (design review note 2, 0.6.80).
 *
 * The drawn row's own subtitle is "Change the title, notes or section before
 * drafting" (`docs/design/handoff-2026-09-26/design/Desk Dialogs.dc.html:152`,
 * `MORE_LEAD_ITEMS` in `editor-dialog-forms.ts:940`), so the three fields
 * below are exactly that: the headline (title), the why (notes) and the topic
 * (section) -- the same three fields `AddLeadDialog`'s sibling `fileLead`
 * carries for a brand-new lead, plus the source links a lead may already
 * carry. There is no summary field: leads have no summary column (that is
 * `drafts.dek`, a different row once a story has been started).
 *
 * DECISIONS.md 2026-09-27 8:25 PM (BN questions, item 3): "Edit the lead has
 * no path today: hide it; logged as backlog." The design review pass
 * (2026-09-27 5:58 PM, note 2) picked "build it" over "take it out of the
 * drawing" -- Scott's binding rule that every automated step has a manual
 * path. This is that path.
 *
 * Mounted the way `KillDialog` and `HoldLeadDialog` are: once per table,
 * re-pointed by the screen's own `editFor` state, `leadId` naming which row.
 */
export type EditLeadDialogProps = {
  leadId: number;
  headline: string;
  why: string;
  topic: string;
  sourceUrls: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the edit has landed, so the page can refetch the lead. */
  onSaved?: () => void | Promise<void>;
};

export function EditLeadDialog({
  leadId,
  headline: initialHeadline,
  why: initialWhy,
  topic: initialTopic,
  sourceUrls,
  open,
  onOpenChange,
  onSaved,
}: EditLeadDialogProps) {
  const [headline, setHeadline] = useState(initialHeadline);
  const [why, setWhy] = useState(initialWhy);
  const [topic, setTopic] = useState(initialTopic || "council");
  const [links, setLinks] = useState(() => parseUrlList(sourceUrls).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Set when the lead saved but its story draft kept its own words (the
     draft was already worked on). The dialog stays open to say so. */
  const [notice, setNotice] = useState("");

  function close() {
    onOpenChange(false);
  }

  /*
   * Reopening the dialog on the same row (Cancel, then More ▾ → Edit the
   * lead again) should show what the lead has now, not what this dialog last
   * held -- a stale draft of an edit the editor abandoned is worse than an
   * empty box. `key={leadId}-${open}`-style remounting is the caller's job
   * (the row passes fresh props each time it opens); this effect covers the
   * one case a remount does not: the same lead reopened without the row
   * itself changing identity.
   */
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  if (open && openedFor !== leadId) {
    setOpenedFor(leadId);
    setHeadline(initialHeadline);
    setWhy(initialWhy);
    setTopic(initialTopic || "council");
    setLinks(parseUrlList(sourceUrls).join("\n"));
    setError("");
    setNotice("");
  }

  const trimmedHeadline = headline.trim();
  const trimmedWhy = why.trim();
  const canSave = trimmedHeadline.length > 0 && !busy;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const urls = links
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const res = await updateLead({
        data: { id: leadId, headline: trimmedHeadline, why: trimmedWhy, topic, urls },
      });
      if (!res || typeof res !== "object" || !("ok" in res)) {
        setError("The desk did not answer. Nothing changed; try again.");
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onSaved?.();
      if (res.message) {
        setNotice(`The lead is saved. ${res.message}`);
        return;
      }
      onOpenChange(false);
    } catch {
      setError("The edit did not reach the desk. The lead is unchanged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Edit the lead"
      subtitle="Change the title, notes or section before drafting."
      footNote="Cancel leaves the lead exactly as it was."
      cancelLabel="Cancel"
      primaryLabel={notice ? "Close" : "Save changes"}
      onPrimary={() => (notice ? close() : void save())}
      primaryDisabled={notice ? false : !canSave}
      primaryTone="solid"
    >
      <label className="astra-field">
        <span className="astra-field-label">Title</span>
        <input
          type="text"
          value={headline}
          maxLength={180}
          disabled={busy}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="What happened, in one sentence"
        />
      </label>
      <label className="astra-field">
        <span className="astra-field-label">Notes</span>
        <textarea
          rows={3}
          value={why}
          maxLength={800}
          disabled={busy}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="Why this might matter"
        />
      </label>
      <label className="astra-field">
        <span className="astra-field-label">Section</span>
        <select value={topic} disabled={busy} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.filter((t) => t !== "about").map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {topic && !TOPICS.includes(topic as (typeof TOPICS)[number]) ? (
            <option value={topic}>{topic}</option>
          ) : null}
        </select>
      </label>
      <label className="astra-field">
        <span className="astra-field-label">
          Source links <span className="astra-field-opt">optional</span>
        </span>
        <textarea
          rows={3}
          value={links}
          disabled={busy}
          onChange={(e) => setLinks(e.target.value)}
          placeholder="https://… one per line"
        />
      </label>
      {trimmedHeadline.length > 0 && trimmedHeadline.length < 8 ? (
        <p className="astra-modal-alert" role="alert">
          Headline needs a full sentence.
        </p>
      ) : null}
      {notice ? (
        <p className="astra-modal-note" role="status">
          {notice}
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
