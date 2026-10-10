import { createAiFollowUp } from "@/components/scoped-actions";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { InkButton } from "@/components/desk-chrome";
import { announceToDesk } from "@/components/desk-chrome-utils";
import { FollowUpDialog, type FollowUpDialogInput } from "@/components/follow-up-dialog";
import { listFollowUpStoryOptions } from "@/lib/news/desk";

/**
 * "Start an AI follow-up" -- the button, its dialog, and the write.
 *
 * Exported for the two surfaces that offer it and are NOT this lane's files: the
 * story page (lane 1, `desk.story.*`) and the lead row's More ▾ menu (lane 3,
 * `desk.queue.tsx`). Both mount it the same way:
 *
 *   <AddFollowUpButton leadId={lead.id} headline={lead.headline} small />
 *
 * It owns its own dialog and mutation so that mounting it is one line and so
 * the two callers cannot drift: the lead is prefilled, the question is not
 * (the editor still has to say what to find out), and the Story picker already
 * points at the story the button was pressed on.
 *
 * A follow-up made from the story page is created already linked, which is
 * what makes its finding land in that story's reporting notes the first time it
 * runs. The same button on the Follow-ups screen passes no lead and the dialog
 * starts on "No story yet".
 */
export function AddFollowUpButton({
  leadId,
  headline,
  label = "Start an AI follow-up",
  tone = "quiet",
  small = true,
  disabled = false,
}: {
  leadId?: number | null;
  /** Only used to label the picker's preselected option. */
  headline?: string | null;
  label?: string;
  tone?: "solid" | "ghost" | "quiet" | "quiet-danger" | "danger";
  small?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  // Loaded when the dialog opens, not when the button renders: the desk has
  // several of these buttons on a story page and the list is only ever needed
  // by the one the editor actually pressed.
  const leads = useQuery({
    queryKey: ["follow-up-story-options"],
    queryFn: () => listFollowUpStoryOptions(),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: (input: FollowUpDialogInput) =>
      createAiFollowUp({
        data: {
          what: input.what,
          agentKind: input.agentKind,
          schedule: input.schedule,
          targets: input.targets,
          leadId: input.leadId,
          modelChoice: input.modelChoice,
          modelEffort: input.modelEffort,
        },
      }),
    onSuccess: (result) => {
      if (result && result.ok === false) {
        announceToDesk(result.error, "err");
        return;
      }
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      announceToDesk("Follow-up started. It runs on its own and reports here.");
      setOpen(false);
    },
    onError: (err) => announceToDesk(err instanceof Error ? err.message : "Could not start that follow-up.", "err"),
  });

  return (
    <>
      <InkButton small={small} tone={tone} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </InkButton>
      {open ? (
        <FollowUpDialog
          leads={leads.data ?? []}
          initial={{ leadId: leadId ?? null, leadHeadline: headline ?? null }}
          onClose={() => setOpen(false)}
          pending={create.isPending}
          error={
            create.error instanceof Error
              ? create.error.message
              : create.data && create.data.ok === false
                ? create.data.error
                : null
          }
          onSubmit={(input) => create.mutate(input)}
        />
      ) : null}
    </>
  );
}
