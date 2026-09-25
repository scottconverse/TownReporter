import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNSAVED_SECTION_BAR_MESSAGE,
  sourceAddHint,
  sourceAddNotice,
  sourcesSummaryLabel,
} from "./sections-setup-copy.ts";

/**
 * The two sentences an owner reads while adding a source to a section.
 *
 * They are not decoration. Adding a source from inside the sections panel
 * writes to the watch list *immediately* (it is the same server call the
 * Sources page makes, so the SSRF guard and the duplicate detection are the
 * same code), while the assignment to the section only lands when the owner
 * confirms. A message that blurred those two facts would send an editor away
 * believing a section scans a page it does not.
 */
describe("sourcesSummaryLabel", () => {
  it("opens with an instruction when the section reads nothing", () => {
    assert.equal(
      sourcesSummaryLabel(0, []),
      "Sources this section reads (0) — choose or add below",
    );
  });

  it("names the sources a section reads when there are few", () => {
    assert.equal(
      sourcesSummaryLabel(2, ["City Council packets", "Times-Call"]),
      "Sources this section reads (2) — City Council packets, Times-Call",
    );
  });

  it("keeps the count honest when the list is longer than the label", () => {
    const label = sourcesSummaryLabel(5, ["A", "B", "C", "D", "E"]);
    assert.equal(label, "Sources this section reads (5) — A, B, C, +2 more");
  });

  it("still states the count when no name could be resolved", () => {
    // Every assigned id must be an accepted source, so this should not happen;
    // if it ever does, the count is the fact and stays.
    assert.equal(sourcesSummaryLabel(2, []), "Sources this section reads (2)");
    assert.equal(sourcesSummaryLabel(2, ["", ""]), "Sources this section reads (2)");
  });
});

describe("sourceAddNotice", () => {
  it("says the source is on watch, that it is ticked, and when the tick is saved", () => {
    const text = sourceAddNotice({
      sectionName: "Business",
      title: "Times-Call",
      url: "https://www.timescall.com/",
      alreadyOnWatch: false,
    });
    assert.equal(
      text,
      "Added to Sources and ticked for Business: Times-Call (https://www.timescall.com/). " +
        "Its assignment is saved when you confirm.",
    );
  });

  it("says it was already on watch rather than claiming a new source", () => {
    const text = sourceAddNotice({
      sectionName: "Business",
      title: "Times-Call",
      url: "https://www.timescall.com/",
      alreadyOnWatch: true,
    });
    assert.equal(
      text,
      "Already on watch — ticked for Business: Times-Call (https://www.timescall.com/). " +
        "Its assignment is saved when you confirm.",
    );
  });
});

describe("sourceAddHint", () => {
  it("tells the owner up front which half is immediate and which waits", () => {
    assert.equal(
      sourceAddHint("Business"),
      "Adding a source here puts it on watch immediately. Its assignment to Business is saved " +
        "when you confirm.",
    );
  });
});

describe("UNSAVED_SECTION_BAR_MESSAGE", () => {
  it("is the sentence the fixed bar shows", () => {
    assert.equal(UNSAVED_SECTION_BAR_MESSAGE, "You have unsaved section changes");
  });
});
