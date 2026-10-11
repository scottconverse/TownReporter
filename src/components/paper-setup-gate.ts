// Setup guidance stays visible; the server asks for explicit consent on press.
import { useQuery } from "@tanstack/react-query";

import {
  paperNotFullySetUpSentence,
  paperSetupCompleted,
} from "@/lib/news/paper-settings";

export type PaperSetupGateState = "checking" | "ready" | "needs-setup" | "unknown";

export type PaperSetupGate = {
  state: PaperSetupGateState;
  /**
   * ALWAYS false, and kept only for source compatibility with the call sites
   * that still read `paperGate.blocked`.
   *
   * Scott's rule (Oct 10 2026): the app may warn, never block. An un-set-up
   * paper used to grey every gated control, which left a non-owner editor with
   * a dead end they could not clear; the desk now lets the press through and
   * the SERVER answers with a structured warning ("This paper is not fully set
   * up: …") that the editor can override with a second, explicit press. The
   * sentence below is still drawn beside the control BEFORE the press, so the
   * editor is told the same thing either way.
   */
  blocked: boolean;
  /** The one sentence to draw beside the control ("" when ready). */
  reason: string;
};

const CHECKING_REASON = "Checking whether this paper has been set up yet…";

/**
 * @param action how the sentence finishes: "start the scan", "draft this story".
 */
export function usePaperSetupGate(_action: string): PaperSetupGate {
  const state = useQuery({ queryKey: ["paper-setup-completed"], queryFn: () => paperSetupCompleted(), refetchOnMount: "always" });
  if (state.isPending) return { state: "checking", blocked: false, reason: CHECKING_REASON };
  if (state.isError || !state.data) return { state: "unknown", blocked: false, reason: "This paper is not fully set up: its setup status could not be checked." };
  if (state.data.onboarded === true) return { state: "ready", blocked: false, reason: "" };
  return { state: "needs-setup", blocked: false, reason: paperNotFullySetUpSentence() };
}
