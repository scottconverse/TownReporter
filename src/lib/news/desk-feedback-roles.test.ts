import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/*
  FB7, item 1, the parts that were still broken after batch 7.

  Three things, all of them "the desk answered a press with silence":

    1. The Dark Desk and Sources notice lines had NO `role` at all. Dark Desk
       was also the only screen in the product that never called
       `announceToDesk` -- every one of its presses reported through these two
       `<p className="note">` elements, so a screen reader was told nothing by
       any of them.
    2. Pause / Resume / Remove / Accept / Drop all run through ONE `setStatus`
       mutation, and no call site read its `isPending`: the button stayed
       enabled and worded exactly as it was while the write was in flight, so a
       second press re-sent the same change. Every other control on this desk
       disables itself in the same paint as the click.
    3. `File as tip` answered a refusal with a bare `return` -- the desk's own
       `catch {}`-free rule (FB0-REPORT.md Table B, and this unit's brief).

  Source pins, for the reason `scan-card-placement.test.ts` gives: these are
  route components that need a router, a session and a query client, and what
  broke is a property of the tree. The behavioural half of the same work is
  tested where it can be: `job-card-state.test.ts` for the card, and the pure
  modules this unit added beside this file.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

describe("the notice lines are live regions", () => {
  it("Sources announces its screen notice, alert on failure", () => {
    const source = read("../../routes/desk.sources.tsx");
    assert.match(
      source,
      /role=\{notice\.kind === "err" \? "alert" : "status"\}/,
      "the one line that carries every outcome on this screen has a role",
    );
  });

  it("Dark Desk announces both copies of its notice line", () => {
    const dark = read("../../routes/desk.dark.tsx");
    const notices = dark.match(/role=\{noticeOk \? "status" : "alert"\}/g) ?? [];
    assert.equal(notices.length, 2, "the file-pane copy and the workspace copy");
    // The PDF reader's two failures are announced too -- they are the presses
    // on this screen that spend the most and they were drawn without a role.
    assert.match(dark, /requestPageRead\.error \? \(\s*<p className="note err" role="alert">/, "requestPageRead failure announced");
    assert.match(dark, /pageRead\.data\?\.error \? \(\s*<p className="note err" role="alert">/, "pageRead failure announced");
    assert.match(dark, /<p className="note err" role="status">\s*\{stalledRunCopy\("dark"\)\}/);
  });
});

describe("the five single-row source controls have a pending state", () => {
  const source = read("../../routes/desk.sources.tsx");

  it("the row that pressed is disabled while its write is in flight", () => {
    assert.match(source, /const statusId = setStatus\.isPending \? \(setStatus\.variables\?\.id \?\? null\) : null;/);
    assert.match(source, /statusId=\{statusId\}/, "and it reaches the rows");
  });

  it("each of Pause, Resume, Remove, Accept and Drop says what it is doing", () => {
    /*
      Unit UI1a2 moved these five presses onto the shared `ActionButton`, so the
      word is the piece's `workingLabel` rather than a ternary drawn as the
      button's own child. The FACT is unchanged and is what this still reads:
      every one of the five has a word of its own while its write is out.
    */
    for (const label of ["Pausing…", "Resuming…", "Removing…", "Accepting…"]) {
      assert.ok(source.includes(label), `${label} must be drawn while that press is in flight`);
    }
    // Remove and Drop are the same destructive press on two lists, so they are
    // the same two-step control and share its word -- see `RemoveAction`.
    assert.match(source, /label="Remove"/);
    assert.match(source, /label="Drop"/);
    assert.match(source, /workingLabel="Removing…"/);
  });

  it("does not leave a second press possible on the pressed row", () => {
    /*
      The disabled half is now the shared piece's own rule rather than a
      hand-written attribute at each call site: `phase="working"` draws the
      button disabled, sets `aria-busy` on it and puts a spinner in it, all
      from one place (`action-button.ts`, asserted separately in
      `src/components/action-button.test.ts`). What this test still has to
      prove is that each press on this screen FEEDS that phase from its own
      row's in-flight state -- if a press passed `"idle"` while its write was
      out, the row would say nothing and stay pressable.
    */
    assert.match(source, /phase=\{rowActionPhase\(\{ isPending: statusBusy \}\)\}/, "Pause and Resume");
    assert.equal(
      (source.match(/rowActionPhase\(\{ isPending: statusBusy \}\)/g) ?? []).length,
      3,
      "Pause, Resume and the keeps-failing row's Delete are all bound to the row that pressed",
    );

    const table = source.match(/isPending: statusId === s\.id/g) ?? [];
    assert.equal(table.length, 1, "Accept, in the suggested/rejected table");

    // Remove goes through the one two-step control, which binds its own
    // pending state and its own disabled attribute together.
    assert.equal((source.match(/<RemoveAction/g) ?? []).length, 3, "three Remove buttons, one control");
    assert.match(source, /phase=\{rowActionPhase\(\{ isPending: busy \}\)\}/);
  });
});

describe("File as tip answers a press it will not act on", () => {
  it("no longer swallows the refusal with a bare return", () => {
    const dark = read("../../routes/desk.dark.tsx");
    assert.doesNotMatch(
      dark,
      /onSuccess: \(res, post\) => \{\s*if \(!res\?\.ok\) return;/,
      "the silent path this item names",
    );
    assert.match(
      dark,
      /if \(!res\.filed\) \{[\s\S]{0,160}?showNotice\(/,
      "a tip that is already on the desk says so instead of doing nothing",
    );
  });
});
