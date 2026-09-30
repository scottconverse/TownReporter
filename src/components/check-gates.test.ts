import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckGates } from "./check-gates.ts";
import {
  evidenceChip,
  namesChip,
  pageGateChip,
  publishBarNote,
  type CheckFacts,
} from "../lib/news/check-gates.ts";

/**
 * What the editor actually reads on the publish bar (unit U9, UX-1).
 *
 * The unit test next to the rule proves the chips are decided correctly. This
 * one proves they are PRINTED -- the editor's own draft, the one the UX auditor
 * walked, reads "not run" and "not checked" rather than the two greens it used
 * to -- and that both workbenches are wired to that rule rather than printing
 * the old words themselves. There is no render test for the route components:
 * they are TanStack route bodies behind a live loader, and the repository's
 * check for "what a route says" is reading its source (see `desk-copy.test.ts`
 * and `meeting-*-wiring.test.ts`). The mutation that matters here -- putting
 * `"✓ Names reviewed"` back on the bar -- fails the last case below.
 */

/** The editor's one-line tip, filed and written by hand: nothing has been run. */
const NEVER_RUN: CheckFacts = {
  hasDraft: true,
  evidenceChecked: false,
  evidenceRequired: false,
  evidenceOutstanding: false,
  namesUnresolved: 0,
  namedOutlets: 0,
  nameCheckComplete: false,
  namesOutstanding: false,
};

const render = (facts: CheckFacts) =>
  renderToStaticMarkup(
    createElement(CheckGates, {
      label: "Publish gates",
      gates: [
        pageGateChip("✓ Saved", true),
        evidenceChip(facts),
        namesChip(facts),
        pageGateChip("! Preview viewed", false),
      ],
    }),
  );

describe("the publish bar's chips, as the editor sees them", () => {
  it("(a) says a check did not run instead of showing a pass, in the quiet chip", () => {
    const html = render(NEVER_RUN);
    assert.match(html, /○ Evidence check not run/);
    assert.match(html, /○ Names not checked/);
    assert.equal(
      (html.match(/class="astra-gate is-quiet"/g) ?? []).length,
      2,
      "both unrun checks are drawn in the dashed quiet chip, not the pass",
    );
    assert.doesNotMatch(html, /✓ Evidence checked/);
    assert.doesNotMatch(html, /✓ Names checked/);
    assert.doesNotMatch(html, /Names reviewed/, "the old green the auditor walked");
  });

  it("(b) shows both passes once the checks ran and were decided", () => {
    const html = render({ ...NEVER_RUN, evidenceChecked: true, nameCheckComplete: true });
    assert.match(html, /✓ Evidence checked/);
    assert.match(html, /✓ Names checked/);
    assert.doesNotMatch(html, /is-quiet/, "nothing is left saying a check did not run");
    /* Saved, the two checks and Preview viewed: every chip on the bar but
       Preview's is a pass, and Preview is the page's own gate. */
    assert.equal((html.match(/class="astra-gate"/g) ?? []).length, 3);
    assert.equal((html.match(/class="astra-gate is-todo"/g) ?? []).length, 1);
  });

  it("(c) keeps the warning chip for a name to review and a check still open", () => {
    const outlets = render({ ...NEVER_RUN, namedOutlets: 2 });
    assert.match(outlets, /! 2 names to review/);
    assert.equal((outlets.match(/class="astra-gate is-todo"/g) ?? []).length, 2, "the names and Preview chips");

    const open = render({ ...NEVER_RUN, evidenceRequired: true });
    assert.match(open, /! Evidence to check/);
    assert.match(open, /○ Names not checked/);
  });

  it("prints the bar's sentence from the same facts", () => {
    assert.equal(
      publishBarNote(NEVER_RUN),
      "Nothing blocks Publish. No evidence or name check ran on this draft.",
    );
    assert.equal(
      publishBarNote({ ...NEVER_RUN, evidenceChecked: true, nameCheckComplete: true }),
      "All checks done.",
    );
  });
});

describe("both workbenches read the rule instead of printing the old words", () => {
  const here = new URL(".", import.meta.url);
  const source = (path: string) =>
    readFileSync(new URL(path, here), "utf8")
      /* Comments above the code explain what was wrong; they are allowed to
         name the old wording. What must be gone is the wording in the code. */
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
  const lead = source("../routes/desk.story.$leadId.tsx");
  const editorial = source("../routes/desk.story.draft.$draftId.tsx");
  const home = source("../routes/desk.index.tsx");

  it("(a) the lead workbench builds its chips and stepper from check-gates, with no old wording left", () => {
    assert.match(lead, /evidenceChip\(checkFacts\)/);
    assert.match(lead, /namesChip\(checkFacts\)/);
    assert.match(lead, /storyStages\(checkFacts, onPaper\)/);
    assert.match(lead, /publishBarNote\(checkFacts\)/);
    assert.match(lead, /recordedChecks\(data\.draft\?\.research_json\)/);
    assert.doesNotMatch(lead, /Names reviewed/);
    assert.doesNotMatch(lead, /"All checks done\."/);
    assert.doesNotMatch(lead, /const checkClear/, "the 'nothing is outstanding' stand-in is gone");
  });

  it("(a) the editorial workbench does the same, chips and bar line", () => {
    assert.match(editorial, /namesChip\(checkFacts\)/);
    assert.match(editorial, /evidenceChip\(checkFacts\)/);
    assert.match(editorial, /publishBarNote\(checkFacts\)/);
    assert.match(editorial, /recordedChecks\(q\.data\?\.research_json\)/);
    assert.doesNotMatch(editorial, /Names reviewed/);
    assert.doesNotMatch(editorial, /"All checks done\."/);
  });

  it("both bars render the drawn chip row, not a second copy of it", () => {
    for (const source of [lead, editorial]) {
      assert.match(source, /<CheckGates gates=\{publishGates\} label="Publish gates" \/>/);
      assert.doesNotMatch(source, /className=\{`astra-gate\$\{/);
    }
  });

  it("the desk home's own chips come from the same rule, so the two screens cannot disagree", () => {
    assert.match(home, /evidenceChip\(facts\)/);
    assert.match(home, /namesChip\(facts\)/);
    /* And its sub line no longer promises a rule the desk does not have: a
       story may print with no check run, which is what the chips now say. */
    assert.doesNotMatch(home, /Each story needs every check before it can print\./);
    assert.match(home, /the chips show which checks ran/);
  });
});
