/**
 * The Decide panel's words and enabled states for a Dark Desk file.
 *
 * Kept pure so the closed-file branch is tested without rendering the route.
 * A closed file already has a real reopen path: Pull back in More file
 * actions. The panel says that plainly instead of leaving a grey button
 * unexplained, and the close control stops pretending it can close it again.
 */
export const DARK_PULL_BACK_LABEL = "Pull back";

export type DarkDecidePanelChoice = {
  closed: boolean;
  keepDisabled: boolean;
  keepNote: string | null;
  closeLabel: string;
  closeDisabled: boolean;
  pullBackLabel: string | null;
};

export function darkDecidePanelChoice(
  status: string | null | undefined,
): DarkDecidePanelChoice {
  if (status !== "closed") {
    return {
      closed: false,
      keepDisabled: false,
      keepNote: null,
      closeLabel: "Close: no finding",
      closeDisabled: false,
      pullBackLabel: null,
    };
  }

  return {
    closed: true,
    keepDisabled: true,
    keepNote:
      "This file is closed. To open it again, use Pull back under More file actions.",
    closeLabel: "Already closed",
    closeDisabled: true,
    pullBackLabel: DARK_PULL_BACK_LABEL,
  };
}
