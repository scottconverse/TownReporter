import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  THE CARD IS WHERE THE PRESS WAS (FB1b, item 3).

  FB1 put the running scan's card on the Scan screen, but below the panel that
  owns the Run scan button -- and on a laptop the editor who pressed it saw no
  change at all, because the one thing they had just asked for was under the
  fold. Sources had the same shape one panel further down: the card sat under
  "Previous scans" rather than beside "Run scan now".

  WHY THIS IS A SOURCE PIN. Placement is a property of the tree, and both
  screens are route components that need a router, a session and a query client
  to render at all -- there is no props-only seam to hand a render test. What IS
  checkable here is the thing that actually broke: which block the card is
  inside of. `scripts/fb1/fb1-scan-shots.mjs` then proves the same claim in a
  real browser, by asserting `.job-card` is a DOM descendant of the Run-scan
  panel after the press.

  A pin is brittle by nature, and that is the trade: this one fails on the edit
  that moves the card back out of view, and costs a line of source when the move
  is deliberate.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

describe("the running scan's card sits with the control that started it", () => {
  it("renders inside the Scan screen's Run-scan panel", () => {
    const source = read("../../routes/desk.scan.tsx");
    const panelStart = source.indexOf('className="astra-panel hot"');
    const panelEnd = source.indexOf("Scans file leads only");
    assert.ok(panelStart > 0 && panelEnd > panelStart, "the Run a scan panel is where it was");
    const panel = source.slice(panelStart, panelEnd);
    assert.match(panel, /Run scan/, "the panel is the one with the button in it");
    assert.match(panel, /scan-job-card/, "the card must be inside that panel, not below it");
    // ...and there is exactly one of it: a card left behind outside the panel
    // as well would be the same defect with a different offset.
    assert.equal(source.split("scan-job-card").length - 1, 1);
  });

  it("renders inside the Sources screen's Daily scan panel, beside Run scan now", () => {
    const source = read("../../routes/desk.sources.tsx");
    // `.astra-panel hot` is the yellow-bordered panel -- the Daily scan one on
    // this screen. Anchored on the class rather than on the words "Daily scan",
    // which also appear in the docblock above the query.
    const panelStart = source.indexOf('className="astra-panel hot"');
    // The HISTORY panel's own heading, not the words "Previous scans" -- those
    // also appear in the comment above the card.
    const panelEnd = source.indexOf('<h2 className="astra-panel-h">Previous scans</h2>');
    assert.ok(panelStart > 0 && panelEnd > panelStart, "the Daily scan panel is where it was");
    const panel = source.slice(panelStart, panelEnd);
    assert.match(panel, /Run scan now/, "the panel is the one with the button in it");
    assert.match(panel, /sources-scan-card/, "the card must be in that panel, not under the history");
    assert.equal(source.split("sources-scan-card").length - 1, 1);
  });

  it("draws the Sources card at full size, so the first check names its stages", () => {
    /*
      FB7, item 2. The card beside "Run scan now" is where a source's FIRST
      check is watched -- "Add & run first check" in the add dialog hands off
      to this panel. It was `compact`, and the compact card drops the stage
      chip row (JobCard.tsx: `!compact && job.stages`), so the same job named
      its stages on the Scan screen and none here. Opinion and Drafts were
      fixed the same way.
    */
    const source = read("../../routes/desk.sources.tsx");
    assert.match(
      source,
      /<div className="sources-scan-card">\s*<DeskJobCard job=\{scanJob\} \/>/,
      "the full card, so the chips are drawn",
    );
    assert.doesNotMatch(
      source,
      /<DeskJobCard job=\{scanJob\} compact \/>/,
      "the compact card hides the chips this item exists to show",
    );
  });

  it("draws both cards from the one desk-jobs reader", () => {
    // The card on a screen is the card everywhere: same reader, same row, same
    // Cancel -- not a second rendering that can drift from the nav's.
    for (const file of ["../../routes/desk.scan.tsx", "../../routes/desk.sources.tsx"]) {
      const source = read(file);
      assert.match(source, /useDeskJobs\(\)/, `${file} reads the one job query`);
      assert.match(source, /kind === "scan"/, `${file} picks the scan job`);
      assert.match(source, /<DeskJobCard job={scanJob}/, `${file} draws it with the drawn card`);
    }
  });
});
