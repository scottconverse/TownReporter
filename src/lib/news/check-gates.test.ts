import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkStageDone,
  deskRowChecks,
  evidenceChip,
  namesChip,
  pageGateChip,
  publishBarNote,
  recordedChecks,
  storyStages,
  type CheckFacts,
} from "./check-gates.ts";
import { reconcileDraftEvidence } from "./draft-evidence.ts";

/**
 * Unit U9 (UX-1): the workbench must not say a check passed when it never ran.
 *
 * The editor's one-line tip had no claims, so the old `checkClear` ("nothing is
 * outstanding") was true of it, and the story page printed `✓ Evidence
 * checked`, `✓ Names reviewed`, a ticked Check stage and "All checks done."
 * beside a panel that said "This draft has no recorded name check." These are
 * the facts that fix it: a pass is claimed only from the draft's own record.
 */

/** The editor's draft: written by hand, nothing ever run against it. */
const NEVER_RUN: CheckFacts = {
  hasDraft: true,
  evidenceChecked: false,
  evidenceToReview: 0,
  evidenceRequired: false,
  evidenceOutstanding: false,
  namesUnresolved: 0,
  namedOutlets: 0,
  nameCheckComplete: false,
  nameCheckRecorded: false,
  namesOutstanding: false,
};

/** A draft through both checks: evidence decided, name check complete. */
const PASSED: CheckFacts = {
  ...NEVER_RUN,
  evidenceChecked: true,
  nameCheckComplete: true,
  nameCheckRecorded: true,
};

describe("check-gates: a check that never ran says so", () => {
  it("(a) a written draft with no evidence decision and no name check claims no pass", () => {
    assert.deepEqual(evidenceChip(NEVER_RUN), {
      text: "○ Evidence check not run",
      tone: "quiet",
      done: false,
    });
    assert.deepEqual(namesChip(NEVER_RUN), {
      text: "○ Names not checked",
      tone: "quiet",
      done: false,
    });
  });

  it("(a) the Check stage of the stepper is not ticked, and the bar does not say the checks are done", () => {
    assert.equal(checkStageDone(NEVER_RUN), false);
    const stages = storyStages(NEVER_RUN, false);
    assert.deepEqual(stages.map((s) => s.label), ["✓ Lead", "✓ Draft", "3 Check", "4 Publish"]);
    assert.equal(stages[2]!.state, "now", "the Check stage is the open one, not a pass");
    assert.ok(
      stages.every((stage) => !/✓\s*Check/.test(stage.label)),
      "no stage may put a checkmark on Check when no check ran",
    );
    assert.equal(
      publishBarNote(NEVER_RUN),
      "Nothing blocks Publish. No evidence or name check ran on this draft.",
    );
    assert.doesNotMatch(publishBarNote(NEVER_RUN), /All checks done\./);
  });

  it("(b) a decided evidence check and a completed name check are a pass", () => {
    assert.deepEqual(evidenceChip(PASSED), {
      text: "✓ Evidence checked",
      tone: "ok",
      done: true,
    });
    assert.deepEqual(namesChip(PASSED), { text: "✓ Names checked", tone: "ok", done: true });
    assert.equal(checkStageDone(PASSED), true);
    assert.deepEqual(storyStages(PASSED, false).map((s) => s.label), [
      "✓ Lead",
      "✓ Draft",
      "✓ Check",
      "4 Publish",
    ]);
    assert.equal(publishBarNote(PASSED), "All checks done.");
  });

  it("(c) a check that ran and has not been decided is the warning it always was", () => {
    const open: CheckFacts = { ...NEVER_RUN, evidenceRequired: true };
    assert.deepEqual(evidenceChip(open), { text: "! Evidence to check", tone: "warn", done: false });
    assert.equal(checkStageDone(open), false);
    assert.equal(
      publishBarNote(open),
      "Nothing blocks Publish. The evidence check is not confirmed and no name check ran.",
    );
    /* The reconcile that ran the evidence check also ran the name check, so
       the common shape of this state is one open check and a name check that
       did complete. */
    assert.equal(
      publishBarNote({ ...open, nameCheckComplete: true }),
      "Nothing blocks Publish. The evidence check is not confirmed.",
    );
  });

  it("(c) a claim of absence still puts the evidence chip back on the desk", () => {
    const claimed: CheckFacts = { ...PASSED, evidenceOutstanding: true };
    assert.deepEqual(evidenceChip(claimed), {
      text: "! Evidence to check",
      tone: "warn",
      done: false,
    });
    assert.equal(checkStageDone(claimed), false);
    assert.equal(
      publishBarNote(claimed),
      "Nothing blocks Publish. The evidence check is not confirmed.",
    );
  });

  it("keeps the old chip's warning for a check that ran and was decided, once the text moves on", () => {
    /* `evidenceOutstanding` is the page's stale-evidence flag, its running
       reconcile, a saving decision and an unticked claim, all at once: any of
       them means the recorded pass no longer covers what is on screen. */
    const stale: CheckFacts = { ...PASSED, evidenceOutstanding: true };
    assert.equal(evidenceChip(stale).tone, "warn");
    assert.equal(evidenceChip(stale).done, false);
    /* And a decision that was recorded before the check was re-opened is not a
       pass either: `required` wins over the old decision, exactly as the desk
       home's chip has it. */
    const reopened: CheckFacts = { ...PASSED, evidenceRequired: true };
    assert.equal(evidenceChip(reopened).tone, "warn");
    assert.equal(evidenceChip(reopened).done, false);
    assert.equal(checkStageDone(reopened), false);
  });
});

describe("U24: a check that ran and left claims nobody judged is not 'not run'", () => {
  /*
    The stand-in editorial day: `○ Evidence check not run` and "Nothing blocks
    Publish. No evidence check ran on this draft." on the bar, over a Checks
    pane reading "checked against 2 captures" and seven `! Needs review` rows.
    The count is the pane's own, `claimNeedingReview` over the resolved review
    (`evidence-check-state.ts`), so the bar and the list under it name the same
    work.
  */
  const withUnreviewed = (n: number): CheckFacts => ({
    ...NEVER_RUN,
    evidenceChecked: true,
    evidenceToReview: n,
  });

  it("prints the count on the chip instead of claiming no check ran", () => {
    assert.deepEqual(evidenceChip(withUnreviewed(7)), {
      text: "! 7 claims need review",
      tone: "warn",
      done: false,
    });
    assert.deepEqual(evidenceChip(withUnreviewed(1)), {
      text: "! 1 claim needs review",
      tone: "warn",
      done: false,
    });
    /* And the state this replaced is still reachable -- for a draft nothing
       was ever run against, which is the only draft it is true of. */
    assert.deepEqual(evidenceChip(NEVER_RUN), {
      text: "○ Evidence check not run",
      tone: "quiet",
      done: false,
    });
  });

  it("is not a pass: the Check stage stays open", () => {
    assert.equal(checkStageDone(withUnreviewed(7)), false);
    assert.equal(evidenceChip(withUnreviewed(7)).done, false);
    assert.equal(checkStageDone({ ...withUnreviewed(0), nameCheckComplete: true, nameCheckRecorded: true }), true);
  });

  it("keeps the older warnings ahead of it, in the order the editor meets them", () => {
    /* A stale check is the bigger fact: the recorded answer no longer covers
       the text, so counting the claims it left would be counting the wrong
       thing. `required` and `outstanding` win, as they always have. */
    assert.equal(evidenceChip({ ...withUnreviewed(7), evidenceRequired: true }).text, "! Evidence to check");
    assert.equal(evidenceChip({ ...withUnreviewed(7), evidenceOutstanding: true }).text, "! Evidence to check");
  });

  it("says how many are unreviewed on the bar, and never that no check ran", () => {
    assert.equal(
      publishBarNote({ ...withUnreviewed(7), nameCheckComplete: true, nameCheckRecorded: true }),
      "Nothing blocks Publish. 7 claims from the evidence check are unreviewed.",
    );
    assert.equal(
      publishBarNote({ ...withUnreviewed(1), nameCheckComplete: true, nameCheckRecorded: true }),
      "Nothing blocks Publish. 1 claim from the evidence check is unreviewed.",
    );
    /* The sentence this unit exists to stop. */
    for (const facts of [
      { ...withUnreviewed(7), nameCheckComplete: true },
      { ...withUnreviewed(7), nameCheckRecorded: true },
      withUnreviewed(1),
    ]) {
      assert.doesNotMatch(publishBarNote(facts), /No evidence check ran/);
    }
  });

  it("counts claims waiting as a record that the check ran, on both sides of the sentence", () => {
    /* No name check at all: the bar names the name check it is missing and the
       claims it is waiting on -- and, the point of the unit, does NOT claim the
       evidence check never happened. */
    const both = publishBarNote(withUnreviewed(7));
    assert.equal(
      both,
      "Nothing blocks Publish. 7 claims from the evidence check are unreviewed and no name check ran.",
    );
    assert.doesNotMatch(both, /No evidence check ran/);
  });
});

describe("U9b: the desk home's chips, on the two rows its old inline chip read differently", () => {
  /*
    The desk home's chip was written inline as `required ? (decision ? ✓ : !) :
    ○`, which read `required` as the whole question. `reconcileDraftEvidence`
    writes `required: !decision` and keeps an old decision when the story is
    edited again, so these two rows exist and the inline chip got each of them
    backwards. The shared rule is the honest one; it is NOT the old chip's
    output reproduced byte for byte, and the comment on `deskRowChecks` says so.
  */
  const row = (patch: Partial<Parameters<typeof deskRowChecks>[0]> = {}) => ({
    evidence_required: false,
    evidence_decision: null as string | null,
    evidence_checked_at: null as string | null,
    names_checked_at: null as string | null,
    names_unresolved: 0,
    name_check_complete: false,
    ...patch,
  });

  it("prints ✓ Evidence checked for a just-decided review, where the old chip printed 'not run'", () => {
    const facts = deskRowChecks(row({ evidence_decision: "keep" }));
    assert.deepEqual(evidenceChip(facts), { text: "✓ Evidence checked", tone: "ok", done: true });
    assert.deepEqual(namesChip(deskRowChecks(row({ evidence_decision: "keep", name_check_complete: true }))), {
      text: "✓ Names checked",
      tone: "ok",
      done: true,
    });
  });

  it("prints ! Evidence to check for a decided review the story moved past, where the old chip printed ✓", () => {
    const facts = deskRowChecks(row({ evidence_required: true, evidence_decision: "keep" }));
    assert.deepEqual(evidenceChip(facts), { text: "! Evidence to check", tone: "warn", done: false });
  });

  it("keeps the rows the old chip already read right", () => {
    /* Required, no decision: an open review, a warning in both readings. */
    assert.equal(evidenceChip(deskRowChecks(row({ evidence_required: true }))).text, "! Evidence to check");
    /* Nothing recorded at all: "not run", in both readings. */
    assert.deepEqual(evidenceChip(deskRowChecks(row())), {
      text: "○ Evidence check not run",
      tone: "quiet",
      done: false,
    });
    /* The names side is unchanged: unresolved first, then completion. */
    assert.equal(namesChip(deskRowChecks(row({ names_unresolved: 2 }))).text, "! 2 names to review");
    assert.equal(namesChip(deskRowChecks(row())).text, "○ Names not checked");
  });

  it("reads the name check record off the row's own projection", () => {
    assert.equal(deskRowChecks(row({ names_checked_at: "2026-09-29T12:00:00.000Z" })).nameCheckRecorded, true);
    assert.equal(deskRowChecks(row({ name_check_complete: true })).nameCheckRecorded, true);
    assert.equal(deskRowChecks(row({ names_unresolved: 1 })).nameCheckRecorded, true);
    assert.equal(deskRowChecks(row()).nameCheckRecorded, false);
  });
});

describe("check-gates: the names chip", () => {
  it("counts a name with nothing to show it, in the bar's own words", () => {
    assert.deepEqual(namesChip({ ...NEVER_RUN, namesUnresolved: 1 }), {
      text: "! 1 name to review",
      tone: "warn",
      done: false,
    });
    assert.deepEqual(namesChip({ ...NEVER_RUN, namesUnresolved: 3 }), {
      text: "! 3 names to review",
      tone: "warn",
      done: false,
    });
    /* A body naming an outlet the sources do not show is the same work on this
       bar as a person the check could not resolve: a name to review. */
    assert.equal(namesChip({ ...NEVER_RUN, namedOutlets: 2 }).text, "! 2 names to review");
    assert.equal(namesChip({ ...NEVER_RUN, namedOutlets: 1, namesUnresolved: 1 }).text, "! 2 names to review");
  });

  it("does not call a name check a pass over text it never saw", () => {
    const stale: CheckFacts = { ...PASSED, namesOutstanding: true };
    assert.deepEqual(namesChip(stale), {
      text: "! Name check is older than the text",
      tone: "warn",
      done: false,
    });
    assert.equal(publishBarNote(stale), "Nothing blocks Publish. The name check is older than the story.");
  });

  it("a name check that did not complete is not a pass, even with no names to review", () => {
    const facts: CheckFacts = { ...NEVER_RUN, evidenceChecked: true };
    assert.equal(namesChip(facts).done, false);
    assert.equal(publishBarNote(facts), "Nothing blocks Publish. No name check ran on this draft.");
  });
});

describe("U9b: the bar's sentence and the chip say the same thing about the name check", () => {
  /*
    The first version asked `nameCheckComplete || namesToReview > 0` for "did a
    name check run", which is a question about the PASS. Two real records fell
    through it to "No name check ran" beside a chip that said otherwise: a check
    that ran and did not finish, and one that finished before the last edit.
  */
  it("does not say 'No name check ran' when the check ran and is older than the text", () => {
    const stale: CheckFacts = {
      ...PASSED,
      nameCheckComplete: false,
      nameCheckRecorded: true,
      namesOutstanding: true,
    };
    assert.equal(namesChip(stale).text, "! Name check is older than the text");
    assert.doesNotMatch(publishBarNote(stale), /No name check ran/);
    assert.equal(
      publishBarNote(stale),
      "Nothing blocks Publish. The name check is older than the story.",
    );
  });

  it("does not say 'No name check ran' when the check ran and did not complete", () => {
    const incomplete: CheckFacts = { ...NEVER_RUN, evidenceChecked: true, nameCheckRecorded: true };
    assert.equal(namesChip(incomplete).text, "○ Names not checked");
    assert.doesNotMatch(publishBarNote(incomplete), /No name check ran/);
    assert.equal(
      publishBarNote(incomplete),
      "Nothing blocks Publish. The name check did not complete.",
    );
  });

  it("keeps 'No name check ran' for the rows that really have no record", () => {
    assert.equal(NEVER_RUN.nameCheckRecorded, false);
    assert.equal(
      publishBarNote(NEVER_RUN),
      "Nothing blocks Publish. No evidence or name check ran on this draft.",
    );
    assert.equal(
      publishBarNote({ ...NEVER_RUN, evidenceChecked: true }),
      "Nothing blocks Publish. No name check ran on this draft.",
    );
  });
});

describe("check-gates: the line beside Publish names the check that did not run", () => {
  it("says which one is missing when one of the two ran", () => {
    assert.equal(
      publishBarNote({ ...NEVER_RUN, evidenceChecked: true }),
      "Nothing blocks Publish. No name check ran on this draft.",
    );
    assert.equal(
      publishBarNote({ ...NEVER_RUN, nameCheckComplete: true }),
      "Nothing blocks Publish. No evidence check ran on this draft.",
    );
  });

  it("says what is still outstanding when a check ran and did not pass", () => {
    assert.equal(
      publishBarNote({ ...PASSED, namesUnresolved: 2 }),
      "Nothing blocks Publish. 2 names still need review.",
    );
    assert.equal(
      publishBarNote({ ...PASSED, namesUnresolved: 1 }),
      "Nothing blocks Publish. 1 name still needs review.",
    );
  });

  it("keeps 'All checks done.' for the only state where it is true", () => {
    assert.equal(publishBarNote(PASSED), "All checks done.");
    for (const facts of [
      NEVER_RUN,
      { ...NEVER_RUN, evidenceRequired: true },
      { ...NEVER_RUN, namesUnresolved: 1 },
      { ...PASSED, evidenceOutstanding: true },
      { ...PASSED, namesOutstanding: true },
    ]) {
      assert.doesNotMatch(publishBarNote(facts), /All checks done\./);
    }
  });
});

describe("check-gates: the stepper reads the same facts", () => {
  it("never ticks Check without a draft", () => {
    assert.equal(checkStageDone({ ...PASSED, hasDraft: false }), false);
    assert.deepEqual(storyStages({ ...PASSED, hasDraft: false }, false).map((s) => s.label), [
      "✓ Lead",
      "2 Draft",
      "3 Check",
      "4 Publish",
    ]);
  });

  it("ticks Publish from the paper, not from the checks", () => {
    assert.equal(storyStages(PASSED, true).at(-1)!.label, "✓ Publish");
    assert.equal(storyStages(NEVER_RUN, false).at(-1)!.state, "next");
  });
});

describe("U9c: a completed evidence reconciliation counts as an evidence check", () => {
  /*
    PR #154 review (P2). A successful "Check draft against evidence" run writes
    the checked draft's `research_json` as `draft-reconcile.server.ts:217` does
    -- the draft's own research spread forward untouched, plus `nameCheck`,
    `reportedClaims` and `evidenceReconciledAt`. It sets no decision and no
    `required`, so a checked draft can hold the stamp with no `evidenceReview`
    key at all, and reading the decision alone called it "never run" while the
    Checks tab read "checked 8:02 a.m." off that same stamp.

    The fixture below is the writer's own object shape; the end-to-end case
    against a real run of that worker is in `check-gates-reconcile.test.ts`.
  */
  const CHECKED_AT = "2026-09-30T14:02:00.000Z";
  const reconciledResearch = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      nameCheck: {
        version: 1,
        checkedAt: CHECKED_AT,
        checkedText: "Headline\n\nDek\n\nBody",
        complete: true,
        note: "0 names need editor review.",
        rows: [],
      },
      reportedClaims: { version: 1, rows: [] },
      evidenceReconciledAt: CHECKED_AT,
      ...extra,
    });

  it("the key this rule reads is the key that worker writes", () => {
    /* A rename in the producer would silently turn every checked draft back
       into "not run"; this is the tripwire. */
    const writer = readFileSync(new URL("./draft-reconcile.server.ts", import.meta.url), "utf8");
    assert.match(writer, /evidenceReconciledAt:new Date\(\)\.toISOString\(\)/);
  });

  it("reads the stamp as a check that ran, on the workbench and on the desk home row", () => {
    const research = reconciledResearch();
    const recorded = recordedChecks(research);
    assert.equal(recorded.evidenceChecked, true);
    assert.equal(recorded.evidenceRequired, false);
    assert.equal(recorded.nameCheckComplete, true);

    const facts: CheckFacts = { ...NEVER_RUN, ...recorded };
    assert.deepEqual(evidenceChip(facts), { text: "✓ Evidence checked", tone: "ok", done: true });
    assert.equal(checkStageDone(facts), true);
    assert.equal(publishBarNote(facts), "All checks done.");

    /* The desk home row: `evidence_checked_at` is the list query's projection
       of the same stamp, and the row it hands over is real the moment the
       checked draft is the newest one. */
    const deskFact = deskRowChecks({
      evidence_required: false,
      evidence_decision: null,
      evidence_checked_at: JSON.parse(research).evidenceReconciledAt,
      names_checked_at: CHECKED_AT,
      names_unresolved: 0,
      name_check_complete: true,
    });
    assert.deepEqual(evidenceChip(deskFact), { text: "✓ Evidence checked", tone: "ok", done: true });
    assert.deepEqual(namesChip(deskFact), { text: "✓ Names checked", tone: "ok", done: true });
  });

  it("keeps required and outstanding ahead of the stamp", () => {
    /* The stamp says the check ran; it does not say the answer still covers
       what is on screen or that the editor has answered the review. */
    const required = recordedChecks(reconciledResearch({ evidenceReview: { required: true, decision: null } }));
    assert.equal(required.evidenceRequired, true);
    assert.deepEqual(evidenceChip({ ...NEVER_RUN, ...required }), {
      text: "! Evidence to check",
      tone: "warn",
      done: false,
    });

    const outstanding: CheckFacts = {
      ...NEVER_RUN,
      ...recordedChecks(reconciledResearch()),
      namesOutstanding: false,
      evidenceOutstanding: true,
    };
    assert.deepEqual(evidenceChip(outstanding), { text: "! Evidence to check", tone: "warn", done: false });
    assert.equal(checkStageDone(outstanding), false);
    assert.doesNotMatch(publishBarNote(outstanding), /All checks done\./);
  });

  it("still calls a draft with neither record not-run", () => {
    assert.equal(recordedChecks(JSON.stringify({ nameCheck: { version: 1, rows: [], checkedText: "", complete: true, checkedAt: CHECKED_AT, note: "" } })).evidenceChecked, false);
    assert.equal(recordedChecks(JSON.stringify({ evidenceReconciledAt: "   " })).evidenceChecked, false);
  });
});

describe("recordedChecks reads the draft's own memo", () => {
  it("reads nothing recorded off a draft with no research at all", () => {
    for (const raw of [null, undefined, "", "{}", "not json", '[1,2,3]']) {
      assert.deepEqual(recordedChecks(raw), {
        evidenceChecked: false,
        evidenceRequired: false,
        nameCheckComplete: false,
        nameCheckRecorded: false,
        namesUnresolved: 0,
      });
    }
  });

  it("tells a record it cannot parse from no record at all", () => {
    /* `nameCheck` present but not the version-1 shape `readNameCheck` accepts:
       it is still a record -- a check pass wrote it -- so the bar must not say
       no name check ran. */
    const malformed = JSON.stringify({ nameCheck: { version: 2, rows: [] } });
    assert.equal(recordedChecks(malformed).nameCheckComplete, false);
    assert.equal(recordedChecks(malformed).nameCheckRecorded, true);
  });

  it("reads the two shapes reconcileDraftEvidence actually writes", () => {
    const draft = {
      id: 7,
      headline: "Council meets",
      dek: "A short dek.",
      body: "The council met Tuesday.",
      source_urls: "[]",
      provenance_json: "[]",
      found_note: "",
      unanswered: "[]",
      research_json: "{}",
    };
    /* An open check: required, no decision, is not a pass. */
    const open = reconcileDraftEvidence({ ...draft, source_urls: '["https://example.test/x"]', research_json: JSON.stringify({ evidenceReview: { required: true, decision: null } }) }, "The council met Tuesday.");
    assert.equal(recordedChecks(open.research_json).evidenceRequired, true);
    assert.equal(recordedChecks(open.research_json).evidenceChecked, false);
    /* The editor's own decision is. */
    const decided = reconcileDraftEvidence({ ...draft, research_json: JSON.stringify({ evidenceReview: { required: true, decision: null } }) }, draft.body, "keep");
    assert.equal(recordedChecks(decided.research_json).evidenceRequired, false);
    assert.equal(recordedChecks(decided.research_json).evidenceChecked, true);
  });

  it("counts the name check's unresolved rows, the same rows the desk home counts", () => {
    const research = JSON.stringify({
      nameCheck: {
        version: 1,
        checkedAt: "2026-09-29T12:00:00.000Z",
        checkedText: "Headline\n\nDek\n\nBody",
        complete: true,
        note: "1 name needs editor review.",
        rows: [
          { name: "Casey Alvarez", status: "matched" },
          { name: "J. Ruiz", status: "unresolved" },
        ],
      },
    });
    assert.deepEqual(recordedChecks(research), {
      evidenceChecked: false,
      evidenceRequired: false,
      nameCheckComplete: true,
      nameCheckRecorded: true,
      namesUnresolved: 1,
    });
  });
});

describe("pageGateChip keeps the page's own two states", () => {
  it("is green when done and a warning when not, and never claims a check", () => {
    assert.deepEqual(pageGateChip("✓ Saved", true), { text: "✓ Saved", tone: "ok", done: true });
    assert.deepEqual(pageGateChip("! Preview viewed", false), {
      text: "! Preview viewed",
      tone: "warn",
      done: false,
    });
  });
});
