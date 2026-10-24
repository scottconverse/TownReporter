/**
 * ── THE GREETING READS THE CLOCK (TXA-1, D280) ──────────────────────────────
 *
 * The front page used to say "Good morning" at every hour, including 7 at
 * night. The words are the same in each case -- the desk's own greeting, then
 * what this page is -- and only the first word follows the paper's clock:
 *
 *   5:00-11:59  Good morning
 *   12:00-16:59 Good afternoon
 *   17:00-23:59 and 0:00-4:59  Good evening
 *
 * The hour is the PAPER's, not the browser's, so a desk set up for another town
 * greets its editor by that town's day. An unusable zone name falls back to the
 * browser's, the same fallback `deskDateLine` uses -- a bad setting must not
 * blank the header.
 */
export function deskGreeting(nowMs: number, timezone: string): string {
  const hour = paperHour(nowMs, timezone);
  const part = hour >= 5 && hour <= 11 ? "Good morning" : hour >= 12 && hour <= 16 ? "Good afternoon" : "Good evening";
  return `${part}. Here’s today’s paper.`;
}

/** The hour (0-23) at `nowMs` in the paper's zone, or the browser's. */
function paperHour(nowMs: number, timezone: string): number {
  const date = new Date(nowMs);
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(date),
    );
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) return hour;
  } catch {
    /* A bad zone name falls through to the browser's own hour. */
  }
  return date.getHours();
}
