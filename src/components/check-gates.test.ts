import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  evidenceRan: false,
  evidenceToReview: 0,
  evidenceRequired: false,
  evidenceOutstanding: false,
  namesUnresolved: 0,
  namedOutlets: 0,
  nameCheckComplete: false,
  nameCheckRecorded: false,
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
