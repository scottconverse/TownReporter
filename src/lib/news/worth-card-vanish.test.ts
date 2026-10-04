import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  worthItemOnDesk,
  worthItemOnDeskLine,
  worthItemOnDeskReason,
} from "./desk-copy.ts";

/*
  FB7, item 5 (A2c C6).

  "An r/longmont tip card still disappears unopened: 'My Analysis of the
  Dariss Yearby Shooting Bodycam Footage' was a card after the sweep and gone
  later, with 'SET ASIDE 0' throughout."

  Two things were wrong. The card was hidden by a fuzzy title match against
  ANOTHER file (so the editor's counter, which counts parked FILES, stayed 0
  and explained nothing), and the hidden card left no trace at all -- the
  brief's rule for this item is that nothing vanishes silently, it is "visible
  somewhere with a reason".

  What survives here is the reason itself: the sentence the desk builds from
  the real function, so the editor is told WHY a card is not on the desk.
*/

const tip = {
  id: "reddit-tip:abc",
  title: "My Analysis of the Dariss Yearby Shooting Bodycam Footage",
  source_url: "https://reddit.com/r/longmont/comments/abc",
};

describe("a hidden card says WHY it is hidden", () => {
  it("names the file that already covers it", () => {
    const covering = { title: "My Analysis of the Dariss Yearby Shooting Bodycam Footage" };
    const reason = worthItemOnDeskReason(tip, [covering]);
    assert.deepEqual(reason, { kind: "covered", title: covering.title });
    assert.match(worthItemOnDeskLine(reason!), /Already on the desk as/);
    assert.match(worthItemOnDeskLine(reason!), /Dariss Yearby/, "and it names the file");
  });

  it("distinguishes a card the editor opened from one another file covers", () => {
    // The two causes need different sentences: one is the editor's own doing,
    // the other is the desk's matching, and A2c could not tell them apart.
    const opened = worthItemOnDeskReason(tip, [], [tip.id]);
    assert.equal(opened?.kind, "opened");
    assert.notEqual(worthItemOnDeskLine(opened!), worthItemOnDeskLine({ kind: "covered", title: "x" }));
  });

  it("says nothing when the card is simply not on the desk yet", () => {
    assert.equal(worthItemOnDeskReason(tip, [{ title: "Council approves the budget" }]), null);
    assert.equal(worthItemOnDeskReason(tip, [], []), null);
  });

  it("leaves the boolean every other caller reads exactly as it was", () => {
    const cases: { inv: { title: string }[]; claimed: string[] }[] = [
      { inv: [], claimed: [] },
      { inv: [{ title: tip.title }], claimed: [] },
      { inv: [], claimed: [tip.id] },
    ];
    for (const { inv, claimed } of cases) {
      assert.equal(
        worthItemOnDesk(tip, inv, claimed),
        worthItemOnDeskReason(tip, inv, claimed) != null,
        "the boolean is the reason asked as a yes/no",
      );
    }
  });
});
