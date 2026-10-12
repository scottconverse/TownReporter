import { investigationPileFor } from "../news/desk-copy.ts";

/** The pile mixes every open lead, so the last scan's time is named apart from it, never as its source. */
export function todayLeadCaption(lastScanLabel?: string | null): string {
  return lastScanLabel
    ? `All open leads · best first · last scan ${lastScanLabel}`
    : "All open leads · best first";
}

export function todayScanStatus(scanning: boolean): string | null {
  return scanning
    ? "A scan is still reading sources; its new leads will appear when it finishes."
    : null;
}

type DarkDeskWaitingRow = {
  status: string;
  waiting_follow_up?: string | null;
  waiting_watch?: string | null;
};

/** Count the same investigation files that appear in Dark Desk's Waiting pile. */
export function todayDarkDeskWaitingCount(rows: readonly DarkDeskWaitingRow[]): number {
  return rows.filter((row) => investigationPileFor(row) === "waiting").length;
}

export function todayDarkDeskWaitingCopy() {
  return {
    label: "Dark Desk files waiting",
    note: "Files waiting on an AI follow-up or a watched page.",
  } as const;
}
