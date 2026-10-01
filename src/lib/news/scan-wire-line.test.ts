import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { wireScanLine } from "./scan-wire-line.ts";
import type { JobProgressView } from "./job-progress.ts";

/*
  FB7, item 3: "Today → The wire says 'No scans yet' while a scan job card
  below it shows a scan running."

  The regression has two halves and both are pinned here: the sentence the
  heading builds, and the fact that the heading is built from the job the card
  below it draws (one reader, one number).
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

/** The smallest thing `wireScanLine` reads. The card's other 20 fields are
    not this function's business, and filling them in would hide a change to
    the field it does read. */
const job = (step: string) => ({ step }) as JobProgressView;

describe("the wire's heading agrees with a running scan", () => {
  it("counts sources while the scan is reading them", () => {
    // Exactly what `countedStep("Reading sources", 83, 201)` writes onto the
    // job row (jobs.ts) -- the worker's own sentence, not a number invented
    // at the read.
    assert.equal(wireScanLine(job("Reading sources — 83 of 201")), "Scanning now — 83 of 201 sources");
  });

  it("MUTATION: a worker that stops reporting its source phase loses the count", () => {
    /*
      The mutation this unit names: stop the scan worker reporting its source
      phase. `countedStep` is what puts "— 83 of 201" on the row; without it
      the step is the bare label. The heading must then NOT print a count --
      it falls back to the worker's words. A test that passed either way would
      be asserting the presence of the word "Scanning", not the agreement the
      regression is about.
    */
    const bare = wireScanLine(job("Reading sources"));
    assert.equal(bare, "Scanning now — reading sources");
    assert.doesNotMatch(bare!, /\d+ of \d+/, "no count may be printed when the worker reports none");
    assert.notEqual(bare, wireScanLine(job("Reading sources — 83 of 201")));
  });

  it("MUTATION, the real one: the worker still counts its sources", () => {
    /*
      The sentence above is only as good as the step it is handed, so the
      mutation this unit names -- "stop the scan worker reporting its source
      phase" -- is pinned at its source. `performScanWork` reports the fetch
      loop's progress with `countedStep("Reading sources", done, total)`, which
      is the only thing that puts "— 83 of 201" on the row. Delete or replace
      that call and this fails, which is exactly the edit the mutation
      describes.
    */
    const worker = read("desk.ts");
    assert.match(
      worker,
      /countedStep\("Reading sources",\s*attemptedCount,\s*watchSlice\.length\)/,
      "the scan worker reports which source it is on, and how many there are",
    );
  });

  it("does not give the model phase a source count it never reported", () => {
    // `countedStep("Reading the sources with a model", 3, 7)` counts BATCHES.
    // The heading keeps the worker's noun rather than calling seven batches
    // "seven sources".
    const line = wireScanLine(job("Reading the sources with a model — 3 of 7"))!;
    assert.equal(line, "Scanning now — 3 of 7");
    assert.doesNotMatch(line, /sources/);
  });

  it("says something true for a queued scan and for no scan at all", () => {
    assert.equal(wireScanLine(job("Waiting to start…")), "Scanning now — waiting to start…");
    assert.equal(wireScanLine(job("")), "Scanning now");
    assert.equal(wireScanLine(null), null);
    assert.equal(wireScanLine(undefined), null);
  });
});

describe("the heading and the card below it read the same job", () => {
  const source = read("../../routes/desk.index.tsx");

  it("builds the wire's sub line from the scan job, not from the last finished run", () => {
    // The defect was the heading's precedence: `last` (the newest FINISHED
    // scan) decided the line, so an open scan could not own it.
    assert.match(source, /wireScanLine\(scanJob\)/, "the heading is built from the open scan job");
    assert.match(source, /const scanJob =[\s\S]{0,240}?kind === "scan"/, "scanJob is the open scan");
  });

  it("draws the card the heading describes from that same variable", () => {
    assert.match(source, /<DeskJobCard[\s\S]{0,200}?job=\{scanJob\}/, "the card draws the same job");
    // There is exactly one scan job selection on the screen: two of them could
    // drift, and a heading counting one while the card counted the other is
    // the defect this item is about.
    assert.equal(source.split(/kind === "scan"/).length - 1, 1);
  });
});
