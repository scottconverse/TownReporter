/**
 * ── THE LINE A SAVED DRAFT REFUSAL READS AS (G23-QA-5, D279) ────────────────
 *
 * When the last Draft press was refused and no live message is on screen, the
 * Story page shows this instead: what did not happen, when, and the desk's own
 * reason. It sits in the same place and style as a live refusal, so an editor
 * coming back to the page cannot mistake a refusal for a draft that never
 * loaded.
 *
 * The moment is printed in the paper's own time zone -- "Oct 24, 3:04 AM" --
 * and an unusable zone name falls back to the browser's, the same fallback
 * `deskDateLine` uses: a bad setting must not blank the reason.
 *
 * Null when there is nothing (or nothing usable) to say.
 */
export function savedDraftRefusalLine(
  refusal: { text: string; at: string } | null | undefined,
  timezone: string,
): string | null {
  if (!refusal) return null;
  const text = String(refusal.text ?? "").trim();
  const when = Date.parse(String(refusal.at ?? ""));
  if (!text || Number.isNaN(when)) return null;
  return `Draft did not start (${refusalTime(when, timezone)}). ${text}`;
}

/** "Oct 24, 3:04 AM" in the paper's time zone, or the browser's. */
function refusalTime(ms: number, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Date(ms).toLocaleString("en-US", { ...opts, timeZone: timezone });
  } catch {
    return new Date(ms).toLocaleString("en-US", opts);
  }
}
