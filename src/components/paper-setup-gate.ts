/*
  SG1 / Option A, the client half: THE button gate.

  The server refuses to start a scan, a Dark Desk run or a draft on an install
  nobody has set up (`requirePaperSetUp`, paper-settings.ts). A refusal after
  the press is too late for the editor -- the desk's rule is that a control
  which cannot work says so BEFORE it is pressed, with the reason in text
  beside it (a greyed button with no sentence is a dead end).

  TWO READS, and why. The blocking question is "has this newsroom finished
  setup?", and that answer must be the same for EVERY role -- so it is asked
  through `paperSetupCompleted`, which any signed-in desk user may call and
  which answers one boolean about the newsroom and nothing else. The OLD read
  here was `firstRunSetupState`, and SG1b finding 2 is what that cost: that
  function answers a routing question ("should this person be sent to the
  first-run form"), only the owner can be sent there, so it deliberately said
  `needsSetup: false` to an invited editor -- the hook reported `ready`,
  enabled every gated button, and the press was refused server-side with no
  reason on screen. Exactly the dead-end this file exists to prevent.

  `firstRunSetupState` is still read, for one narrow thing: which sentence to
  draw. On an un-onboarded paper, `needsSetup: true` means the person looking
  IS the owner (only the owner is ever routed), and they are told to finish
  Paper setup; anyone else is told to ask the owner to, because the setup form
  is owner-only and pointing an editor at a screen that will not open for them
  is the same dead-end in different words.

  ONE QUERY KEY PER QUESTION. The completion answer gets its own key
  (`["paper-setup-completed"]`); `["first-run-setup"]` keeps the shape the
  Server panel's Paper-setup section and the /desk/setup redirect expect
  (ops-panels.tsx, desk.setup.tsx), so neither can be read as the other and
  PUB2's stale-cache fix there is untouched. Both refetch on every mount for
  the reason PUB2 pinned: a cached answer is not an answer.

  THE SENTENCES ARE THE SERVER'S OWN (`PAPER_NOT_SET_UP_SENTENCE`,
  `PAPER_NOT_SET_UP_OWNER_SENTENCE`, `PAPER_SETUP_UNCHECKABLE_SENTENCE`), not a
  second wording written here: what the button says before the press and what
  the server says after one are the same sentence.

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
  paperSetupCompleted,
  PAPER_NOT_SET_UP_OWNER_SENTENCE,
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

const CHECKING_REASON = "Checking whether this paper has been set up yet…";

/**
 * @param action how the sentence finishes: "start the scan", "draft this story".
 */
export function usePaperSetupGate(action: string): PaperSetupGate {
  const state = useQuery({
    queryKey: ["paper-setup-completed"],
    queryFn: () => paperSetupCompleted(),
    refetchOnMount: "always",
  });
  /*
    Owner-only, and read ONLY to choose the wording once the paper is known to
    be un-set-up. `enabled` is not set: the answer is already being fetched by
    the screens that need it, and a shared cache key means one poll serves both.
  */
  const role = useQuery({
    queryKey: ["first-run-setup"],
    queryFn: () => firstRunSetupState(),
    refetchOnMount: "always",
  });
  if (state.isPending) {
    return { state: "checking", blocked: true, reason: CHECKING_REASON };
  }
  if (state.isError || !state.data) {
    return { state: "unknown", blocked: true, reason: PAPER_SETUP_UNCHECKABLE_SENTENCE(action) };
  }
  if (state.data.onboarded === true) {
    return { state: "ready", blocked: false, reason: "" };
  }
  /*
    Un-set-up. The routing read decides who is looking; until it answers, say
    nothing about who can fix it -- an un-onboarded paper is the only place
    this matters and there the wait is one round trip.
  */
  if (role.isPending) {
    return { state: "checking", blocked: true, reason: CHECKING_REASON };
  }
  if (role.data?.needsSetup === true) {
    return { state: "needs-setup", blocked: true, reason: PAPER_NOT_SET_UP_SENTENCE(action) };
  }
  return { state: "needs-setup", blocked: true, reason: PAPER_NOT_SET_UP_OWNER_SENTENCE(action) };
}
