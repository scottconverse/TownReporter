import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMiscTopic } from "./section-types.ts";

/*
  Unit BX, item 4: readers never see the "misc" section tag.

  The reader's copy of one table is narrower than the desk's, and this predicate
  is where the catch-all leaves it. The values below are the shapes the rows
  actually take: "misc" is a STORED topic on live data, and a section row the
  owner renamed to "Misc." is the same bucket.
*/
describe("isMiscTopic", () => {
  it("recognizes the catch-all however the row spells it", () => {
    for (const stored of [
      "misc",
      "Misc",
      "MISC",
      " misc ",
      "Misc.",
      "miscellaneous",
      "Miscellaneous",
    ]) {
      assert.equal(isMiscTopic(stored), true, `${JSON.stringify(stored)} is the catch-all bucket`);
    }
  });

  it("leaves every real section alone", () => {
    for (const real of [
      "council",
      "schools",
      "opinion",
      "Miscellany",
      "miscellaneous notes",
      null,
      undefined,
      "",
    ]) {
      assert.equal(isMiscTopic(real), false, `${JSON.stringify(real)} is not the catch-all bucket`);
    }
  });

  /*
    The other half of the item: the desk keeps its labels. `use-sections.ts` is
    the one seam both audiences read, so the filter has to be in the reader's
    function and absent from the editor's -- asserted on the two function
    bodies, not on the file, because the import is at the top of the file and
    both functions are below it.
  */
  it("filters the reader's sections and leaves the desk's read whole", () => {
    const source = readFileSync(new URL("../use-sections.ts", import.meta.url), "utf8");
    const readerFn = source.slice(source.indexOf("export function usePublicSections"));
    const editorFn = source.slice(
      source.indexOf("export function useEditorSections"),
      source.indexOf("export function usePublicSections"),
    );
    assert.match(readerFn, /!isMiscTopic\(s\.key\)/, "the reader's list still carries a misc row");
    assert.doesNotMatch(editorFn, /isMiscTopic/, "the desk lost the bucket it files into");
  });
});
