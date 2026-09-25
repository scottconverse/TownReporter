/**
 * Builds the DeskShell class list from the theme and text-size preferences.
 * Kept outside the React component module so render checks can test it
 * directly without exporting a non-component from that module.
 */
export function deskShellClassName({
  night,
  mode,
  size,
}: {
  night?: boolean;
  mode: "light" | "dark";
  size: "normal" | "large";
}) {
  const nightPage = Boolean(night) || mode === "dark";
  return "desk-ltr" + (nightPage ? " night" : "") + (size === "large" ? " large" : "");
}

export const inkSolid =
  "pressable inline-flex min-h-11 items-center justify-center bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50";
export const inkGhost =
  "pressable inline-flex min-h-11 items-center justify-center border border-ink px-4 text-sm font-medium hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50";

export const inputClass =
  "border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-2 focus:outline-offset-2 focus:outline-[var(--fg,var(--color-ink))] min-h-11";
export const areaClass = inputClass;

/** Speaks through the always-mounted desk live region for screen readers. */
export function announceToDesk(text: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("desk-announcer");
  if (el) el.textContent = text;
}

export function leadOrigin(lead: {
  investigation_id?: number | null;
  scan_run_id?: number | null;
  why?: string;
  newsworthiness?: number | null;
  /** Migration 0088: "import" = read out of a report the editor pasted. */
  origin?: string | null;
}) {
  /*
    First, because it is the one origin the desk recorded itself. A pasted
    report often carries a score in its own text, and an imported lead's
    newsworthiness is 0 -- without this line a story the editor just imported
    would be described on the Queue as "filed by you", which is true but tells
    them nothing about where it came from.
  */
  if (lead.origin === "import") return "imported";
  if (lead.investigation_id) return "from Dark Desk";
  if (/DARK DESK/i.test(lead.why ?? "")) return "from Dark Desk";
  if (lead.scan_run_id != null) return "from the scanner";
  if ((lead.newsworthiness ?? 0) > 0) return "from the scanner";
  return "filed by you";
}
