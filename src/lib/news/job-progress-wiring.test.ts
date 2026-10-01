import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  EVERY WORKER THAT CAN COUNT HANDS ITS COUNT TO THE PROGRESS MODEL (FB1, unit 1).

  THE GAP THIS CLOSES. `reportProgress` has always accepted `pct`; no worker in
  the product ever passed one. The only `pct:` outside jobs.ts and its own test
  was the test. So the card's determinate branch was unreachable and every bar
  on the desk was the 33% segment sliding back and forth -- the owner's "a line
  going back and forth is just lazy".

  WHY A SOURCE PIN AND NOT A RUN. The behavioural half of this claim is proved
  elsewhere and properly:
    - `job-progress-kinds.test.ts` drives a fake run per kind through the
      claim/seed/report/terminal machinery;
    - `scan-progress.postgres.test.ts` runs the REAL scan worker on real
      PostgreSQL and asserts its percentage climbs inside the fetch slice.
  What NEITHER of those can reach is the line where a worker builds its
  reporter, because that needs the worker's own dependencies -- a provider, a
  session, a stored PDF. So this file pins the seam by reading it: for each
  counting kind, the worker must be shown handing a number to the reporter.
  `scan-custom-selection.test.ts` uses the same mechanism for the same reason
  and calls it a coupling pin.

  A pin is brittle by nature. That is the trade: it fails loudly on the edit
  that silently turns a bar back into a sliding line, and it costs a line of
  source text when the edit is deliberate.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

/** Each kind that can count, the file that counts it, and the pin. */
const PINS: { kind: string; file: string; pattern: RegExp; what: string }[] = [
  {
    kind: "draft",
    file: "desk.ts",
    pattern: /progressReporterFor\(job, \{ stagePct: true \}\)/,
    what: "the draft's six arrivals give it a percentage from its position in the list",
  },
  {
    kind: "scan",
    file: "desk.ts",
    pattern: /spanPct\(attemptedCount, watchSlice\.length, 5, 55\)/,
    what: "the source fetch counts pages read, inside the slice of the bar it owns",
  },
  {
    kind: "scan",
    file: "desk.ts",
    pattern: /spanPct\(batchIndex \+ 1, batches\.length, 55, 92\)/,
    what: "the model batches count batch k of n",
  },
  {
    kind: "scan",
    file: "desk.ts",
    pattern: /reportStage\("Filing the leads", 95\)/,
    what: "the filing pass is the last arrival, and says where on the bar it is",
  },
  {
    kind: "dark",
    file: "dark.ts",
    pattern: /onStage: \(stage, pct\) => reportRound\(stage, pct\)/,
    what: "the round's research bridge carries the hop loop's percentage through",
  },
  {
    kind: "dark",
    file: "investigate.ts",
    pattern: /spanPct\(\s*hop \+ \(total > 0 \? Math\.min\(1, done \/ total\) : 0\),\s*hopsBudget,\s*0,\s*40,?\s*\)/,
    what: "the hop loop maps hops done, plus how far through this hop, into 0-40",
  },
  {
    kind: "artifact-ocr",
    file: "dark.ts",
    pattern: /totalPages > 0 \? pctFor\(retainedPages\.size, totalPages\) : pctFor\(batchIndex, batches\.length\)/,
    what: "the PDF read counts pages retained, falling back to batches",
  },
  {
    kind: "pull",
    file: "pull.server.ts",
    pattern: /pctFor\(phase \+ \(total > 0 \? Math\.min\(1, done \/ total\) : 0\), 3\)/,
    what: "pull maps its three phases into thirds of the bar",
  },
  {
    kind: "audio-transcribe",
    file: "textflowkit-transcribe.server.ts",
    pattern: /report\("Transcribing the audio with textflowkit", pctFor\(1, 3\)\)/,
    what: "the transcode reports its position even though the tool has no progress channel",
  },
  {
    kind: "routine-notice",
    file: "routine-notice-worker.server.ts",
    pattern: /spanPct\(sourceIndex \+ 1, sources\.length, 0, 60\)/,
    what: "the routine edition counts the sources it reads before it plans anything",
  },
  {
    kind: "follow-up",
    file: "follow-up-agents.ts",
    pattern: /pctFor\(targetIndex, input\.targets\.length\)/,
    what: "a run counts the units it was asked to check",
  },
  {
    kind: "reconcile",
    file: "draft-reconcile.server.ts",
    pattern: /progressReporterFor\(job, \{ stagePct: true \}\)/,
    what: "reconcile's two known stages are 0 and 50",
  },
  {
    kind: "brief",
    file: "dark.ts",
    pattern: /report\("Writing editor brief", pctFor\(1, 2\)\)/,
    what: "the brief reports 0 while it reads the file and 50 while the model writes",
  },
  {
    kind: "editorial",
    file: "editorial.server.ts",
    pattern: /"Checking names and spellings"/,
    what: "the editorial's third arrival still exists, so its chip row is complete",
  },
];

describe("every countable kind hands its count to the progress model", () => {
  for (const pin of PINS) {
    it(`${pin.kind}: ${pin.what}`, () => {
      assert.match(read(pin.file), pin.pattern, `${pin.file} must still ${pin.what}`);
    });
  }

  it("the editorial is the one kind that stays indeterminate, and says why", () => {
    /*
      Rule 5 of the brief: the indeterminate bar remains only where no count is
      knowable. The editorial's two long stretches are single model calls with
      no denominator -- nothing inside them can be counted -- so it is the one
      kind that keeps the sliding bar, and its chips are what tell the editor
      where it is. This asserts the DECISION is written down where the next
      reader will find it, rather than being an omission nobody noticed.
    */
    const source = read("editorial.server.ts");
    assert.doesNotMatch(
      source,
      /stagePct: true/,
      "if the editorial ever counts, delete this test and say so in JOB_STAGE_LISTS",
    );
  });
});
