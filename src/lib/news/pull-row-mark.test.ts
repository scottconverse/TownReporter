import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
  PULL1 point 3, as source pins.

  Three of Scott's reporting lines were pulled and nothing changed on any of
  them: the run said "no relevant public document found", the line was not
  struck, and the row drew nothing at all. The reason was written into
  `notes.todo[i].q` and no screen read it.

  These pins are what makes the mutation real: put the old count back, strike
  the line on a nothing-found pull, or drop the reason from the row, and one of
  them fails. The neighbouring route tests (check-gates.test.ts) read the page
  the same way, for the same reason -- the page is the only place this is
  visible.
*/

const pull = readFileSync(new URL("./pull.server.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../routes/desk.story.$leadId.tsx", import.meta.url), "utf8");

describe("the mark a Pull leaves on its reporting line", () => {
  it("stores the reason in plain words, with no failure count", () => {
    assert.match(pull, /reason: pullTodoReason\(\{/);
    assert.doesNotMatch(pull, /provider or page failures/);
    assert.doesNotMatch(pull, /pull found nothing/);
    assert.match(
      pull,
      /i === index \? \{ \.\.\.r, done: false, q: outcome\.reason, triedAt: outcome\.at \} : r/,
    );
  });

  it("stamps the reason with the moment it was written, not with a later run", () => {
    // PULL1b finding 3: the time has to belong to the reason it is printed
    // beside. It is written with the reason and cleared with it.
    assert.match(
      pull,
      /at: receipt\.finishedAt \?\? new Date\(\)\.toISOString\(\)/,
      "the failure's own moment is persisted with the reason",
    );
    assert.match(pull, /if \(!row\.triedAt && !isPullTodoReason\(row\.q \?\? ""\)\) return row;/);
  });

  it("still strikes the line when a document was found", () => {
    // The rule now lives in `markPulledTodo`, which the new test file exercises
    // directly; this pins that the pipeline still hands it the document count
    // and that nothing but a document reaches `toggleTodo`.
    assert.match(
      pull,
      /receipt\.checkpoint\?\.documents\.length\s*\?\s*\{ documentFound: true \}/,
      "the pipeline tells the mark whether a document was really found",
    );
    assert.match(pull, /return next\.todo\[index\]!\.done \? next : toggleTodo\(next, index\);/);
  });

  it("draws the reason on the row, with the clock time it was tried", () => {
    // PULL1b finding 3: from the row's own stamp. `run.finishedAt` belongs to
    // whichever run is newest, which after a retry is not this failure.
    assert.match(page, /const triedAt = clockTime\(item\.triedAt \?\? null\);/);
    assert.doesNotMatch(page, /clockTime\(run\?\.finishedAt/);
    assert.match(page, /\{triedAt \? `Tried \$\{triedAt\}: \$\{item\.q\}` : item\.q\}/);
    assert.match(page, /\{!item\.done && item\.q \? \(/);
  });

  it("draws a reason with no stamp as the reason alone", () => {
    // A row written by an earlier build keeps its words and gets no invented
    // time; the ternary above is what does it, and this pins the fallback.
    assert.match(page, /\{triedAt \? `Tried \$\{triedAt\}: \$\{item\.q\}` : item\.q\}/);
  });

  it("never prints the raw failure count to the editor", () => {
    assert.doesNotMatch(page, /provider or page failures/);
    assert.match(page, /<summary>\{failureSummary\(run\.providerNotes \?\? \[\]\)\}<\/summary>/);
  });
});
