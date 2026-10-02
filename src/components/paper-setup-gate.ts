/*
  SG1 / Option A, the client half: THE button gate.

  The server refuses to start a scan, a Dark Desk run or a draft on an install
  nobody has set up (`requirePaperSetUp`, paper-settings.ts). A refusal after
  the press is too late for the editor -- the desk's rule is that a control
  which cannot work says so BEFORE it is pressed, with the reason in text
  beside it (a greyed button with no sentence is a dead end).

  ONE HOOK, ONE QUERY KEY. This reads the same `["first-run-setup"]` query the
  Server panel's Paper-setup section and the /desk/setup redirect read
  (`firstRunSetupState`), so pressing Save on setup clears this too and the
  three surfaces can never disagree about whether the paper is set up.

  THE SENTENCES ARE THE SERVER'S OWN (`PAPER_NOT_SET_UP_SENTENCE`,
  `PAPER_SETUP_UNCHECKABLE_SENTENCE`), not a second wording written here: what
  the button says before the press and what the server says after one are the
  same sentence.

  FAIL CLOSED, like the Server panel: an errored query is "could not check",
  never "set up". A pending query says it is checking rather than leaving a
  disabled button with nothing beside it.

  A `.ts` file, and the sentence's markup in `PaperSetupGateNote.tsx`, on
  purpose: eslint's react-refresh/only-export-components warns about a file
  that exports both, and splitting is this repo's convention for it
  (`job-card-state.ts` + `JobCard.tsx`).
*/
import { useQuery } from "@tanstack/react-query";

import {
  firstRunSetupState,
  PAPER_NOT_SET_UP_SENTENCE,
  PAPER_SETUP_UNCHECKABLE_SENTENCE,
} from "@/lib/news/paper-settings";

export type PaperSetupGateState = "checking" | "ready" | "needs-setup" | "unknown";

export type PaperSetupGate = {
  state: PaperSetupGateState;
  /** True whenever the gated control must not be pressable. */
  blocked: boolean;
  /** The one sentence to draw beside the disabled control ("" when ready). */
  reason: string;
};

/**
 * @param action how the sentence finishes: "start the scan", "draft this story".
 */
export function usePaperSetupGate(action: string): PaperSetupGate {
  const state = useQuery({
    queryKey: ["first-run-setup"],
    queryFn: () => firstRunSetupState(),
  });
  if (state.isPending) {
    return {
      state: "checking",
      blocked: true,
      reason: "Checking whether this paper has been set up yet…",
    };
  }
  if (state.isError || !state.data) {
    return { state: "unknown", blocked: true, reason: PAPER_SETUP_UNCHECKABLE_SENTENCE(action) };
  }
  if (state.data.needsSetup === true) {
    return { state: "needs-setup", blocked: true, reason: PAPER_NOT_SET_UP_SENTENCE(action) };
  }
  return { state: "ready", blocked: false, reason: "" };
}

