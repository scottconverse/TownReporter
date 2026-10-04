import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dedupeFactLines, factLineKey, factLinesDropped } from "./dark-fact-lines.ts";

/*
  FB7, item 5 (A2c X3): "its WHAT WE KNOW prints the same KCTV5 sentence five
  times".

  The five lines are five real `claims` rows -- `investigate.ts` inserts one per
  planned claim per round and nothing dedupes the body -- so the fix is on the
  way out, at both places the list is read: the panel and the brief pack. Both
  are pinned here.
*/

const KCTV =
  "KCTV5 reported that the Lee's Summit centre closed in the same week as the Longmont one.";

describe("WHAT WE KNOW says a fact once", () => {
  it("folds the same sentence recorded by five rounds into one line", () => {
    const rows = [{ body: KCTV }, { body: KCTV }, { body: KCTV }, { body: KCTV }, { body: KCTV }];
    const out = dedupeFactLines(rows);
    assert.equal(out.length, 1, "five identical lines become one");
    assert.equal(out[0]!.body, KCTV);
    assert.equal(factLinesDropped(rows), 4, "and the four echoes are counted, not just dropped");
  });

  it("keeps the first record of a fact and the order it came in", () => {
    const first = { body: KCTV, evidence: "kctv5.com" };
    const out = dedupeFactLines<{ body: string; evidence?: string }>([
      { body: "A" },
      first,
      { body: "B" },
      { body: KCTV, evidence: "a later round" },
    ]);
    assert.deepEqual(
      out.map((f) => f.body),
      ["A", KCTV, "B"],
      "first occurrence wins, and the list's own order is otherwise untouched",
    );
    assert.equal(out[1]!.evidence, "kctv5.com", "the earlier row is the one kept");
  });

  it("compares on case and whitespace only", () => {
    // The rows come from five different model rounds, so the same sentence
    // arrives with different wrapping and capitalisation.
    const out = dedupeFactLines([
      { body: "The  centre closed." },
      { body: "the centre   closed." },
      { body: "The centre closed.\n" },
    ]);
    assert.equal(out.length, 1);
    assert.equal(factLineKey("The  Centre\nClosed."), "the centre closed.");
  });

  it("does not merge two facts that differ by a word", () => {
    // The desk does not get to decide that two near-identical sentences mean
    // the same thing; that is deletion of an editor's record on a guess.
    const out = dedupeFactLines([
      { body: "The centre closed in June." },
      { body: "The centre closed in July." },
    ]);
    assert.equal(out.length, 2);
  });

  it("drops an empty body rather than printing a blank line", () => {
    assert.equal(dedupeFactLines([{ body: "   " }, { body: "" }]).length, 0);
  });
});
