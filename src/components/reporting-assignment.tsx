import { startReporting } from "@/components/scoped-actions";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog } from "@/components/dialog";
import { Field } from "@/components/desk-chrome";
import { ModelPicker } from "@/components/model-picker";
import { Notice } from "@/components/states";
import { invalidateDeskJobs } from "@/components/job-card-state";

import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import type { StoryModelChoice } from "@/lib/news/model-choice";

/*
  Report a town / beat / date / issue -- a direct reporting assignment with no
  lead behind it yet.

  WHAT THIS IS. The four direct actions do not name an existing lead: the editor
  is asking for reporting on a place, a beat, a date or a question, and the
  runner creates the lead(s) for whatever it finds. This dialog is where that
  ask is entered -- the subject, optional seed sources and editorial direction
  -- and where the model is pinned through the SAME picker every other press
  uses. It never transfers a file or runs a command: everything is typed here,
  the way the rest of the desk works.

  WHY A DIALOG AND NOT A BUTTON. Four different assignments share one shape and
  each needs the same three fields plus a model; a dialog is the desk's own
  place for that (see dialog.tsx), and it keeps the desk home from growing four
  more buttons that only differ in a word.
*/
export type ReportingDirectAction = "report-town" | "report-beat" | "report-date" | "report-issue";

const ACTION_LABELS: Record<ReportingDirectAction, string> = {
  "report-town": "Report a town",
  "report-beat": "Report a beat",
  "report-date": "Report a date",
  "report-issue": "Report an issue",
};

const PLACEHOLDERS: Record<ReportingDirectAction, string> = {
  "report-town": "For example: What the Longmont council decided this month and what it changes for residents.",
  "report-beat": "For example: St. Vrain Valley Schools -- the budget, the board votes and what families should know.",
  "report-date": "For example: The Oct 6 public hearing on the 2027 budget -- who spoke and what was decided.",
  "report-issue": "For example: Why the city's water rates are changing and who pays more.",
};

export function ReportingAssignmentDialog({
  action,
  open,
  onClose,
}: {
  action: ReportingDirectAction;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [assignment, setAssignment] = useState("");
  const [seedUrls, setSeedUrls] = useState("");
  const [researchScope, setResearchScope] = useState<"public" | "supplied">("public");
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(null);
  const [startedLeadIds, setStartedLeadIds] = useState<number[] | null>(null);
  const run = useMutation({
    mutationFn: () =>
      startReporting({
        data: {
          action,
          assignment: assignment.trim(),
          seedUrls: seedUrls.trim() || undefined,
          modelChoice,
          modelEffort,
          researchScope,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        invalidateDeskJobs(qc);
        void qc.invalidateQueries({ queryKey: ["desk-jobs"] });
      }
    },
  });
  const refused = run.data && !run.data.ok ? run.data.error : run.isError ? String(run.error) : null;
  const done = Boolean(run.data?.ok);
  const close = () => {
    setStartedLeadIds(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={ACTION_LABELS[action]}
      subtitle="The run reports what it finds and files a package beside each story it opens."
      primaryLabel={done ? "Done" : "Start reporting"}
      onPrimary={done ? close : () => run.mutate()}
      primaryDisabled={done ? false : run.isPending || assignment.trim().length === 0}
      pending={run.isPending}
      primaryPendingLabel="Starting..."
    >
      <Field
        label="What to report on"
        hint="The subject and the direction. This is the assignment the run works to; it is not printed as evidence."
      >
        <textarea
          rows={4}
          value={assignment}
          maxLength={4000}
          disabled={run.isPending || done}
          onChange={(e) => setAssignment(e.target.value)}
          placeholder={PLACEHOLDERS[action]}
        />
      </Field>
      <Field label="Sources to start from" hint="Optional. One public link per line -- an agenda, a recording, a document.">
        <textarea
          rows={2}
          value={seedUrls}
          maxLength={20000}
          disabled={run.isPending || done}
          onChange={(e) => setSeedUrls(e.target.value)}
        />
      </Field>
      <Field label="Research" hint="Public research lets the run look things up; supplied uses only what you gave it.">
        <select
          value={researchScope}
          disabled={run.isPending || done}
          onChange={(e) => setResearchScope(e.target.value as "public" | "supplied")}
        >
          <option value="public">Public research</option>
          <option value="supplied">Supplied material only</option>
        </select>
      </Field>
      <ModelPicker
        value={modelChoice}
        onChange={(choice) => {
          setModelChoice(choice);
          setModelEffort(defaultModelEffort(choice));
        }}
        effort={modelEffort}
        onEffortChange={setModelEffort}
        disabled={run.isPending || done}
      />
      {refused ? <Notice kind="warn">{refused}</Notice> : null}
      {run.data?.ok ? (
        <Notice kind="ok">
          Reporting started on {run.data.modelLabel}. Its progress shows under Running; the stories it
          opens will appear on the desk as they are filed.
          {startedLeadIds && startedLeadIds.length ? (
            <> {" "}<Link to="/desk/story/$leadId" params={{ leadId: String(startedLeadIds[0]) }} className="inline-link">Open the first story</Link>.</>
          ) : null}
        </Notice>
      ) : null}
    </Dialog>
  );
}
