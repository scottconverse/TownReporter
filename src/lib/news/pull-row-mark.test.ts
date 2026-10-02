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
    assert.match(pull, /const reason = pullTodoReason\(\{/);
    assert.doesNotMatch(pull, /provider or page failures/);
    assert.doesNotMatch(pull, /pull found nothing/);
    assert.match(pull, /rowIndex === index \? \{ \.\.\.row, done: false, q: reason \}/);
  });

  it("still strikes the line when a document was found", () => {
    assert.match(
      pull,
      /if \(receipt\.checkpoint\?\.documents\.length\) \{\s*if \(!notes\.todo\[index\]!\.done\) notes = toggleTodo\(notes, index\);/,
      "only a pull that returned a document may mark the line done",
    );
  });

  it("draws the reason on the row, with the clock time it was tried", () => {
    assert.match(page, /const triedAt = clockTime\(run\?\.finishedAt \?\? null\);/);
    assert.match(page, /\{triedAt \? `Tried \$\{triedAt\}: \$\{item\.q\}` : item\.q\}/);
    assert.match(page, /\{!item\.done && item\.q \? \(/);
  });

  it("never prints the raw failure count to the editor", () => {
    assert.doesNotMatch(page, /provider or page failures/);
    assert.match(page, /<summary>\{failureSummary\(run\.providerNotes \?\? \[\]\)\}<\/summary>/);
  });
});
