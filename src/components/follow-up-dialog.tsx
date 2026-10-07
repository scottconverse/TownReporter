import { useState } from "react";

import { Dialog, ChoiceCard } from "@/components/dialog";
import { ModelPicker } from "@/components/model-picker";
import { scheduleForAgent, type FollowUpSchedule } from "@/lib/news/follow-up-copy";
import { validateFollowUpDialog } from "@/lib/news/follow-up-dialog-validation";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import type { FollowUpAgentKind } from "@/lib/news/types";

/**
 * The "New AI follow-up" dialog, and its edit twin.
 *
 * Ported from the reference's dialog (`Desk Dialogs.dc.html`): "What to find
 * out" and "Where to look" are the two fields; "How" is the method, and the
 * method is what decides the cadence, so there is no separate schedule picker
 * -- `scheduleForAgent` IS that decision, and its option notes say the cadence
 * out loud ("Daily until found", "Checks when the body usually posts").
 *
 * The same component edits, because the two dialogs ask for exactly the same
 * four things and a second copy would be a second place for the validation
 * below to drift from the server's. In edit mode the row's own schedule is kept
 * unless the editor actually changes the method: an agent on "every 6 hours"
 * must not be pushed onto "every 2 hours" by opening its dialog.
 *
 * ONE DELIBERATE ADDITION to the drawing: the Story field. The reference has
 * none, and the drawn cards all show a linked story -- but a finding is written
 * into the story's reporting notes and nowhere else (`appendFindingNote`), so
 * an agent with no story can find something and have nowhere to put it. The
 * field is optional and defaults to "No story yet"; the card's own "Add to
 * story" sets it later, and `performUpdateAiFollowUp` writes the finding into
 * the notes at that moment.
 *
 * The client refuses the same two things the server refuses -- the same
 * sentences, so the message does not change when it crosses the wire -- because
 * a `recheck` with no links is a row that can never run, and the re-check agent
 * depends on this dialog never creating one (see `runRecheckAgent`).
 */
export type FollowUpDialogInput = {
  id?: number;
  what: string;
  agentKind: FollowUpAgentKind;
  schedule: FollowUpSchedule;
  targets: string[];
  leadId: number | null;
  modelChoice: StoryModelChoice;
};

export type FollowUpDialogInitial = {
  id?: number;
  what?: string;
  agentKind?: FollowUpAgentKind;
  schedule?: FollowUpSchedule;
  targets?: string;
  leadId?: number | null;
  modelChoice?: StoryModelChoice;
  /** Shown when the linked lead is outside the picker's recent window. */
  leadHeadline?: string | null;
};

/** The three drawn methods, in the drawn order. */
const METHODS: { kind: FollowUpAgentKind; label: string; note: string }[] = [
  { kind: "recheck", label: "Re-check these pages on a schedule", note: "Tells you when they change" },
  { kind: "search", label: "Search the web and public records", note: "Daily until found" },
  { kind: "agenda", label: "Watch for the next agenda or minutes", note: "Checks when the body usually posts" },
];

const MAX_TARGETS = 8;
const WHAT_MAX = 400;

/** One link per line (a comma or two is forgiven). */
function parseTargets(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function FollowUpDialog({
  mode = "create",
  initial,
  leads,
  onClose,
  onSubmit,
  pending = false,
  error = null,
}: {
  mode?: "create" | "edit";
  initial?: FollowUpDialogInitial;
  /** The recent leads the Story picker offers, newest first. */
  leads: { id: number; headline: string }[];
  onClose: () => void;
  onSubmit: (input: FollowUpDialogInput) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const [what, setWhat] = useState(initial?.what ?? "");
  const [kind, setKind] = useState<FollowUpAgentKind>(initial?.agentKind ?? "recheck");
  const [schedule, setSchedule] = useState<FollowUpSchedule>(
    initial?.schedule ?? scheduleForAgent(initial?.agentKind ?? "recheck"),
  );
  const [targetsText, setTargetsText] = useState(initial?.targets ?? "");
  const [leadId, setLeadId] = useState<string>(initial?.leadId ? String(initial.leadId) : "");
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>(initial?.modelChoice ?? "auto");

  const targets = parseTargets(targetsText);
  const overCap = targets.length > MAX_TARGETS;
  const validationIssues = validateFollowUpDialog({ what, agentKind: kind, targets });
  const whatIssue = validationIssues.find((issue) => issue.field === "what");
  const targetIssues = validationIssues.filter((issue) => issue.field === "targets");
  const targetsRequired = kind !== "search";
  const primaryDisabled = pending || validationIssues.length > 0;

  // The picker's window is recent leads; a row linked to an older one keeps its
  // headline in the list rather than silently showing the wrong story.
  const options = [...leads];
  if (initial?.leadId && !options.some((lead) => lead.id === initial.leadId)) {
    options.unshift({ id: initial.leadId, headline: initial.leadHeadline || "The linked story" });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "create" ? "New AI follow-up" : "Edit AI follow-up"}
      subtitle="An AI agent keeps looking for an answer and tells you what it finds."
      primaryLabel={mode === "create" ? "Start follow-up" : "Save changes"}
      primaryPendingLabel={mode === "create" ? "Starting…" : "Saving…"}
      onPrimary={() => {
        if (primaryDisabled) return;
        onSubmit({
          ...(mode === "edit" && initial?.id ? { id: initial.id } : {}),
          what: what.trim(),
          agentKind: kind,
          schedule,
          targets: targets.slice(0, MAX_TARGETS),
          leadId: leadId ? Number(leadId) : null,
          modelChoice,
        });
      }}
      primaryDisabled={primaryDisabled}
      footNote="When it finds something it adds it to the story’s reporting notes and tells you. It never publishes."
    >
      <div className="fu-form">
        <label className="fu-field">
          <span>What to find out</span>
          <textarea
            className="fu-input"
            style={{ minHeight: 60 }}
            maxLength={WHAT_MAX}
            placeholder="e.g. Which Oct. 8 meeting was cancelled?"
            value={what}
            required
            aria-invalid={Boolean(whatIssue)}
            onChange={(event) => setWhat(event.target.value)}
          />
        </label>
        {whatIssue ? (
          <p className="fu-err" role="alert" aria-live="polite">
            {whatIssue.message}
          </p>
        ) : null}

        <label className="fu-field">
          <span>
            Where to look <span className="fu-field-hint">{targetsRequired ? "required for this method" : "optional"}</span>
          </span>
          <textarea
            className="fu-input"
            style={{ minHeight: 60 }}
            placeholder={
              targetsRequired
                ? "http:// or https:// links, one per line"
                : "Links, one per line (optional; the AI can search)"
            }
            value={targetsText}
            aria-invalid={targetIssues.length > 0}
            onChange={(event) => setTargetsText(event.target.value)}
          />
        </label>
        {targetIssues.map((issue) => (
          <p key={issue.message} className="fu-err" role="alert" aria-live="polite">
            {issue.message}
          </p>
        ))}

        <label className="fu-field">
          <span>
            Story <span className="fu-field-hint">optional</span>
          </span>
          <select
            className="fu-input"
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
          >
            <option value="">No story yet</option>
            {options.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.headline}
              </option>
            ))}
          </select>
        </label>

        <ModelPicker
          scope="follow-up"
          label="Model for this follow-up"
          value={modelChoice}
          onChange={setModelChoice}
        />

        <div className="fu-choices" role="radiogroup" aria-label="How">
          <span className="fu-choices-label">How</span>
          {METHODS.map((method) => (
            <ChoiceCard
              key={method.kind}
              label={method.label}
              note={method.note}
              selected={kind === method.kind}
              onSelect={() => {
                if (method.kind === kind) return;
                setKind(method.kind);
                setSchedule(scheduleForAgent(method.kind));
              }}
            />
          ))}
        </div>

        {overCap ? (
          <p className="fu-err">Only the first {MAX_TARGETS} links are watched.</p>
        ) : null}
        {error ? <p className="fu-err" role="alert">{error}</p> : null}
      </div>
    </Dialog>
  );
}
