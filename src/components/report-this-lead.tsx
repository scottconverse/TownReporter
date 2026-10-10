import { startReporting } from "@/components/scoped-actions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActionButton } from "@/components/action-button";
import { Field } from "@/components/desk-chrome";
import { ModelPicker } from "@/components/model-picker";
import { Notice } from "@/components/states";
import { invalidateDeskJobs } from "@/components/job-card-state";
import { loadLeadReportingPackage } from "@/lib/news/desk";
import { reportingNotice, reportingRunState } from "@/lib/news/reporting-package-view";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { usePaper } from "@/lib/paper-context-state";
import type { StoryModelChoice } from "@/lib/news/model-choice";

/*
  Report this meeting / Develop this lead -- the press that starts a civic
  reporting run for THIS lead.

  WHAT THIS IS. One press becomes one reporting run: the runner runs the
  installed civic-scanner method over the meeting or lead and files a
  structured package (see reporting-package-panel.tsx), keeping this lead and
  saving the result as a NEW draft version. Nothing here overwrites the draft
  or the notes; the runner owns that.

  WHY IT ASKS FOR A MODEL HERE. The desk's one rule is that a run is pinned to
  the model the editor chose, through the SAME picker the draft path uses
  (ModelPicker), so the pin cannot drift between the press and the run. This
  control deliberately reuses that picker rather than inventing a second model
  chooser.

  DIRECT ASSIGNMENTS (town / beat / date / issue) ARE NOT HERE. They carry no
  lead, so they live on the desk home (reporting-assignment.tsx) where the
  editor is not looking at an existing lead. This control is only the two
  presses that anchor on the lead the editor already has open.
*/
export type ReportThisLeadControlProps = {
  leadId: number;
  /** The action words: what the editor is asking for. */
  action: "report-meeting" | "develop-lead";
  /** Whether this lead already has a draft body (decides the button label). */
  hasDraft: boolean;
  /** The picker state, owned by the page so the pin matches the writer row. */
  modelChoice: StoryModelChoice;
  modelEffort: ModelEffort | null;
  onModelChoice: (choice: StoryModelChoice) => void;
  onModelEffort: (effort: ModelEffort | null) => void;
  researchScope: "public" | "supplied";
  onResearchScope: (scope: "public" | "supplied") => void;
  /** Locked (killed / on paper) disables the press, as every other press is. */
  disabled: boolean;
  disabledReason?: string | null;
};

export function ReportThisLeadControl(props: ReportThisLeadControlProps) {
  const qc = useQueryClient();
  const { timezone } = usePaper();
  const [open, setOpen] = useState(false);
  const [assignment, setAssignment] = useState("");
  const [seedUrls, setSeedUrls] = useState("");
  const request = useQuery({
    queryKey: ["reporting-package", props.leadId],
    queryFn: () => loadLeadReportingPackage({ data: { leadId: props.leadId } }),
    refetchInterval: (state) => (state.state.data?.latestRun?.status === "PENDING" ? 2000 : false),
    refetchIntervalInBackground: true,
  });
  const run = useMutation({
    mutationFn: () =>
      startReporting({
        data: {
          action: props.action,
          leadId: props.leadId,
          assignment: assignment.trim(),
          seedUrls: seedUrls.trim() || undefined,
          modelChoice: props.modelChoice,
          modelEffort: props.modelEffort,
          researchScope: props.researchScope,
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        void qc.invalidateQueries({ queryKey: ["reporting-package", props.leadId] });
        invalidateDeskJobs(qc);
        void qc.invalidateQueries({ queryKey: ["desk-jobs"] });
      }
    },
  });
  const refused =
    run.data && !run.data.ok ? run.data.error : run.isError ? String(run.error) : null;
  const buttonWord = props.action === "report-meeting" ? "Report this meeting" : "Develop this lead";
  const ready = !props.disabled && assignment.trim().length > 0;
  const latestRun = request.data?.latestRun;
  const notice = reportingNotice(run.data, latestRun?.status);
  const started = notice === "started";
  return (
    <div className="report-this-lead">
      <ActionButton
        tone={props.hasDraft ? "quiet" : "primary"}
        phase={run.isPending ? "working" : started ? "done" : "idle"}
        workingLabel="Starting..."
        doneLabel="Reporting started"
        disabled={props.disabled || run.isPending}
        disabledReason={props.disabled ? props.disabledReason ?? null : null}
        onAct={() => {
          /*
            The press opens the ask-and-model box rather than firing blind: the
            runner needs the editor's assignment (what to account for) and the
            model to pin, and neither can be guessed. The box is the one press.
          */
          setOpen((value) => !value);
        }}
        ariaLabel={buttonWord}
      >
        {buttonWord}
      </ActionButton>
      {open ? (
        <section className="report-this-lead-box" aria-label={buttonWord}>
          <Field
            label="What to report on"
            hint="The specific meeting, vote, decision or question. This is the assignment the run works to; it is not printed as evidence."
          >
            <textarea
              rows={3}
              value={assignment}
              maxLength={4000}
              disabled={run.isPending}
              onChange={(e) => setAssignment(e.target.value)}
              placeholder={
                props.action === "report-meeting"
                  ? "For example: The Sept 29 council meeting -- every action and vote, and what each one changes for residents."
                  : "For example: Who profits from the 2027 budget, and what it does to services residents use."
              }
            />
          </Field>
          <Field label="Sources to start from" hint="Optional. One public link per line -- the agenda, the recording, a document.">
            <textarea
              rows={2}
              value={seedUrls}
              maxLength={20000}
              disabled={run.isPending}
              onChange={(e) => setSeedUrls(e.target.value)}
            />
          </Field>
          <ModelPicker
            value={props.modelChoice}
            onChange={(choice) => {
              props.onModelChoice(choice);
              props.onModelEffort(defaultModelEffort(choice));
            }}
            effort={props.modelEffort}
            onEffortChange={props.onModelEffort}
            disabled={run.isPending}
          />
          <Field label="Research" hint="Public research lets the run look things up; supplied uses only what you gave it.">
            <select
              value={props.researchScope}
              disabled={run.isPending}
              onChange={(e) => props.onResearchScope(e.target.value as "public" | "supplied")}
            >
              <option value="public">Public research</option>
              <option value="supplied">Supplied material only</option>
            </select>
          </Field>
          <ActionButton
            tone="primary"
            phase={run.isPending ? "working" : "idle"}
            workingLabel="Starting..."
            disabled={!ready || run.isPending}
            disabledReason={!ready ? "Write what to report on first." : null}
            onAct={() => run.mutate()}
          >
            Start reporting
          </ActionButton>
          {refused ? <Notice kind="warn">{refused}</Notice> : null}
          {notice === "failed" && latestRun ? (
            <Notice kind="err">
              <p>{reportingRunState(latestRun, timezone).label}</p>
              <p>{reportingRunState(latestRun, timezone).detail}</p>
            </Notice>
          ) : null}
          {started && run.data?.ok ? (
            <Notice kind="ok">
              Reporting started on {run.data.modelLabel}. Its progress shows under Running, and the
              package will appear beside this story when it is done.
            </Notice>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
