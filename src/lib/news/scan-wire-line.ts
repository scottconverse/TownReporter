import type { JobProgressView } from "./job-progress.ts";

/*
  THE WIRE'S SUB LINE, WHILE A SCAN IS RUNNING (FB7, item 3).

  The wire panel's heading carried "No scans yet" for as long as no scan had
  FINISHED -- which is true about history and false about the screen. With a
  scan mid-flight the panel read:

      The wire
      No scans yet
      [ a job card below it: "Scanning the watch list · 0:41 · Now: Reading
        sources — 83 of 201" ]

  Two statements, one screen, and the one in the headline was the wrong one.
  The owner's brief for this unit names it exactly: "make the wire line agree
  with a running scan".

  The sentence is built from the JOB, not from a second read of the run row,
  and that is the point of the mutation this unit asks for: the count comes
  from the worker's own `step_text` (`countedStep("Reading sources", done,
  total)` in `desk.ts`). If the worker stops reporting its source phase the
  count is not there to print, and the sentence degrades to the worker's own
  words rather than to a number the desk invented.

  Deliberately NOT here: reading `scan_runs.sources_fetched`. The run row and
  the job row disagree by a few seconds -- the run row is written by the fetch
  loop, the job row by the progress boundary -- and a heading that counted one
  while the card under it counted the other is the "counters disagree" defect
  A2c C3, one panel up. One reader, one number.
*/

/** What the wire panel's heading says while a scan is open. */
export function wireScanLine(job: JobProgressView | null | undefined): string | null {
  if (!job) return null;
  const step = job.step.trim();
  /*
    `countedStep` writes "Reading sources — 83 of 201", and the run is over
    sources, so the count gets its noun back: "83 of 201 sources". The em dash
    and the two numbers are matched at the END of the sentence so a step that
    happens to contain "of" earlier cannot be mistaken for the count.
  */
  const counted = /^Reading sources\s+—\s+(\d+)\s+of\s+(\d+)$/.exec(step);
  if (counted) return `Scanning now — ${counted[1]} of ${counted[2]} sources`;
  /*
    The model phase counts BATCHES, not sources ("Reading the sources with a
    model — 3 of 7"), so it keeps the worker's own noun and gets no invented
    one. Same for anything else a future phase reports.
  */
  const other = /—\s*(\d+)\s+of\s+(\d+)$/.exec(step);
  if (other) return `Scanning now — ${other[1]} of ${other[2]}`;
  /*
    No count yet: the row is queued ("Waiting to start…") or the worker is
    between boundaries. The worker's sentence is still true, so it is carried --
    lower-cased at the front so the line reads as one clause ("Scanning now —
    waiting to start") rather than as two sentences run together.
  */
  if (!step) return "Scanning now";
  return `Scanning now — ${step[0].toLowerCase()}${step.slice(1)}`;
}
