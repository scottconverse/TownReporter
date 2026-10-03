import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

  Two things were wrong and both are pinned here. The card was hidden by a
  fuzzy title match against ANOTHER file (so the editor's counter, which counts
  parked FILES, stayed 0 and explained nothing), and the hidden card left no
  trace at all -- the brief's rule for this item is that nothing vanishes
  silently, it is "visible somewhere with a reason".
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

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

describe("the Dark Desk draws the reason instead of a shorter list", () => {
  const dark = read("../../routes/desk.dark.tsx");

  it("keeps the covered cards and renders them", () => {
    assert.match(dark, /const covered = worthRows\.filter\(\(row\) => row\.off\);/, "they are kept");
    // capped at 5 with "Show all N" (Group 3), so the map runs over covered or its first five
    assert.match(dark, /\(expandedPiles\.covered \? covered : covered\.slice\(0, 5\)\)\.map\(\(\{ item, off \}\)/, "and drawn");
    assert.match(dark, /worthItemOnDeskLine\(off!\)/, "with the reason");
  });

  it("does not delete them with a bare filter", () => {
    assert.doesNotMatch(
      dark,
      /const inbox = \(worth\.data \?\? \[\]\)\.filter\(\(item\) => !worthItemOnDesk\(/,
      "the silent-hide line this item is about",
    );
  });

  it("links to the file that covers the card, the way the desk opens files", () => {
    // The route carries no search params: the id travels in OPEN_KEY, which is
    // what every other "open that file" link on this desk does.
    assert.match(dark, /sessionStorage\.setItem\(OPEN_KEY, String\(covering\.id\)\)/);
  });
});
