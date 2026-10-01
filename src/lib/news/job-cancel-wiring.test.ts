import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  EVERY KIND THAT WAITS ASKS ABOUT CANCEL, AND SPEAKS WHILE IT WAITS (B8B item 2).

  THE GAP THIS CLOSES. FB0-REPORT's unit 4 lists the kinds that had neither a
  heartbeat nor a cancel check. Batch 7 added none of them (the diff for
  `waitForModel|throwIfJobCancelled|reportProgress|beat_at` across
  `595400da..HEAD` is empty), so B8B filled them in per kind -- and the reason
  the desk cares is one sentence: a job that cannot be stopped, or that goes
  quiet long enough to be called stalled while it is working, is a lie on the
  card, and the card offers the editor a Retry that spends the budget twice.

  WHAT IS PROVED BY RUNNING, AND WHERE. Four of the kinds have a behavioural
  test with a mutation behind it, in the file that already owns their fixtures:

    - routine-notice -> `routine-notice-automation.test.ts`
      ("an editor's Cancel ends a routine edition at the source boundary",
       "every routine source read is wrapped in the ticker")
    - pull (claim branch) -> `pull-worker.test.ts`
      ("cancels a claim Pull at the boundary, before it opens the page")
    - draft -> `draft-batch-worker.test.ts`
      ("a Cancel already on the row stops the draft before the report spends
       anything", "a Cancel that lands during the report stops the repair and
       the write")
    - editorial -> `editorial-result-persistence.test.ts`
      ("stops before the rung probe and the document reading", "stops before
       the write when the Cancel lands while the uploads are being read")

  The remaining seams cannot be reached from a test without the worker's own
  dependencies -- a provider session, a built brief, a whole dig -- so this file
  pins them by reading the source, the same trade `job-progress-wiring.test.ts`
  makes and for the same reason. A pin is brittle by nature: it fails loudly on
  the edit that quietly removes a boundary, and costs a line of source text when
  the edit is deliberate.

  ALREADY COVERED, VERIFIED RATHER THAN RE-ADDED (B8B item 2 asks for the batch
  -7 list first):
    - `artifact-ocr` (`dark.ts`): `throwIfJobCancelled` at every batch boundary
      AND `waitForModel` around the read AND `setOwnedStage` -> `ocrReport` ->
      `progressReporterFor` -> `reportProgress`, so `step_text` and `beat_at`
      both move. Nothing was missing.
    - `transcribe` (`textflowkit-transcribe.server.ts`): the long call is already
      inside `waitForModel`, which polls `cancel_requested` on the same tick it
      beats on -- so a Cancel lands mid-hour without a second check.
    - `scan`, `follow-up`, `reconcile`: a ticker and/or a boundary check already
      in place before batch 7.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

/** Each boundary, the file it lives in, and the pin. */
const PINS: { kind: string; file: string; pattern: RegExp; what: string }[] = [
  {
    kind: "routine-notice",
    file: "routine-notice-worker.server.ts",
    pattern: /await throwIfJobCancelled\(job\.id\);/,
    what: "the source loop reads the editor's Cancel at the boundary",
  },
  {
    kind: "routine-notice",
    file: "routine-notice-worker.server.ts",
    pattern: /await waitForModel\(\{[\s\S]{0,400}?run: \(\) =>\s*\n\s*check\(/,
    what: "each source read runs under the ticker, so a slow read still beats",
  },
  {
    kind: "pull",
    file: "pull.server.ts",
    pattern: /if \(receipt\.sourceUrl\) \{[\s\S]{0,3000}?assertNotCancelled\?\.\(\);[\s\S]{0,60}?try \{/,
    what: "the claim branch reads Cancel before the fetch, outside the catch that would file it as a failure",
  },
  {
    kind: "draft",
    file: "desk.ts",
    pattern: /await throwIfJobCancelled\(job\.id\);[\s\S]{0,1200}?const reported = await waitForModel\(\{/,
    what: "the report's four model calls are not started for a draft the editor already stopped",
  },
  {
    kind: "draft",
    file: "desk.ts",
    pattern: /await throwIfJobCancelled\(job\.id\);[\s\S]{0,1400}?const style = await repairDraftStyle\(/,
    what: "the fifth model call (the style repair) is behind a boundary of its own",
  },
  {
    kind: "editorial",
    file: "editorial.server.ts",
    pattern: /await throwIfJobCancelled\(job\.id\);[\s\S]{0,80}?const resolvedRung =/,
    what: "the Opinion rung probe is not spent on a cancelled piece",
  },
  {
    kind: "editorial",
    file: "editorial.server.ts",
    pattern: /"Researching the editorial"[\s\S]{0,900}?await throwIfJobCancelled\(job\.id\);[\s\S]{0,200}?const result = await waitForModel\(\{/,
    what: "a Cancel that lands during the document reading stops the write",
  },
  {
    kind: "brief",
    file: "dark.ts",
    pattern: /await throwIfJobCancelled\(job\.id\);[\s\S]{0,160}?await report\("Writing editor brief"/,
    what: "a cancelled brief never assembles its pack or moves the bar",
  },
  {
    kind: "dark",
    file: "dark.ts",
    pattern: /const verifySummary = await waitForModel\(\{[\s\S]{0,500}?runVerificationStage\(/,
    what: "the round's longest single call runs under the ticker and answers Cancel on the same tick",
  },
];

describe("every kind that waits asks about Cancel, and beats while it waits", () => {
  for (const pin of PINS) {
    it(`${pin.kind}: ${pin.what}`, () => {
      assert.match(
        read(pin.file),
        pin.pattern,
        `${pin.file} no longer shows the ${pin.kind} boundary this pin names`,
      );
    });
  }
});
