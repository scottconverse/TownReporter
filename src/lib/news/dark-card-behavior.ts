/**
 * Small, pure rules shared by the Dark Desk card and its tests.
 *
 * These live outside `desk.dark.tsx` so the copy and refresh decisions can be
 * exercised without a browser, server or database. They do not decide whether
 * a job ran: callers still supply the worker's step and the server's stall and
 * stop evidence.
 */

/** The worker's current Dark Desk step, in the card's plain language. */
export function darkJobStepLine(step: string): string {
  const value = step.trim();
  if (!value) return "Working on the case file";
  const pass = value.match(/^Researching hop (\d+)\/(\d+)$/i);
  if (pass) return `Reading public records · pass ${pass[1]} of up to ${pass[2]}`;
  const search = value.match(/^Searching (\d+)\/(\d+) on hop (\d+)$/i);
  if (search) return `Checking public pages · search ${search[1]} of ${search[2]}`;
  if (/^Researching the file$/i.test(value)) return "Starting to read public records";
  if (/^Synthesizing signals/i.test(value)) return "Putting the case file together";
  if (/^Testing explanations$/i.test(value)) return "Checking ordinary explanations";
  if (/^Writing editor brief$/i.test(value)) return "Finishing the case file";
  if (/^Switched to /i.test(value)) return "Changing models to keep the work moving";
  // New worker arrivals are still the truth. The old fallback hid them behind
  // "Working on the case file", so the Now: line could sit on one sentence for
  // a whole step. Keep the worker's words rather than inventing a stage.
  return value;
}

/**
 * A round whose investigation still says "investigating" needs the file rail
 * refreshed too. Three seconds is the slowest permitted running interval and
 * matches the card's own few-second freshness without adding a second fast
 * poll for every open file.
 */
export function darkInvestigationPollMs(
  rows: readonly { status: string }[] | undefined,
): number | false {
  return rows?.some((row) => row.status === "investigating") ? 3_000 : false;
}

/**
 * The restart note belongs only to silence with no recorded ending. A known
 * stop reason -- including the editor's cancellation -- is evidence, not a
 * missing heartbeat, and must never be relabelled as an app restart.
 */
export function darkRestartNoteVisible(
  stalled: boolean,
  stopReason: string | null | undefined,
  jobStatus?: string | null,
): boolean {
  const settled = jobStatus === "completed" || jobStatus === "failed" || jobStatus === "cancelled";
  return stalled && !settled && !String(stopReason ?? "").trim();
}
