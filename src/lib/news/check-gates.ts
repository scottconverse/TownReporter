/**
 * What a check chip may say about a draft (unit U9, UX-1).
 *
 * The story workbench told an editor a one-line tip had passed its checks when
 * none had run. A lead filed and written by hand has no claims, so the old
 * `checkClear` -- "nothing is outstanding" -- was true of a draft nothing had
 * ever been run against, and it printed `✓ Evidence checked`; the names chip
 * printed `✓ Names reviewed` whenever the body named no outlet the sources did
 * not show, which is also true of a draft no name check has seen. The stepper's
 * Check stage and the bar's "All checks done." read the same two facts, so one
 * empty draft carried four green claims, next to a Checks tab saying "This
 * draft has no recorded name check."
 *
 * The rule is the desk home's (`desk.index.tsx`, `tonightChips`) in spirit: a
 * gate that was never run says so -- `○`, the quiet dashed chip -- and a pass
 * has to be recorded before it can be claimed. This file is that rule once, for
 * the three readers that were each deciding it for themselves: the gate chips,
 * the stage stepper and the line beside the Publish button, on both the lead
 * workbench (`desk.story.$leadId.tsx`) and the editorial workbench
 * (`desk.story.draft.$draftId.tsx`).
 *
 * IT IS NOT A BYTE-FOR-BYTE COPY OF THE DESK HOME'S OLD INLINE CHIP, and no
 * comment here should say it is. The old chip read `required` as the whole
 * question; this reads `required` and the recorded decision, so two rows the
 * desk can really hold print differently -- and more honestly. They are named
 * one by one on `deskRowChecks` below, with the test that pins each.
 *
 * NONE OF THIS DECIDES ANYTHING. What Publish allows is still exactly the
 * `disabled` list on the button, computed by `publishBlockers` -- these chips,
 * the stepper and the sentence are what the page SAYS about that, and the only
 * thing a chip does when a check has not run is stop borrowing the look of a
 * pass (see the claims-of-absence test, which pins the button independently).
 *
 * Pure decisions over plain values, like `desk-drafts.ts` and
 * `publish-blockers.ts`: the route files open a database at import time in
 * places and cannot be loaded by `node --experimental-strip-types`, so a rule
 * living inside one is only ever tested through a running server.
 */
import { claimCount } from "./evidence-check-list.ts";
import { readNameCheck } from "./name-check.ts";

/**
 * How a chip is drawn. `ok` is the pass, `warn` is something the editor has to
 * deal with, `quiet` is "this never ran" -- the dashed outline the desk home
 * already uses, so a chip that says a check did not run cannot be mistaken for
 * one that says it did.
 */
export type CheckTone = "ok" | "warn" | "quiet";

export type CheckChip = {
  /** The chip exactly as it prints, mark included: "✓ Evidence checked". */
  text: string;
  tone: CheckTone;
  /** Did the check this chip is about run, against this text, and pass? */
  done: boolean;
};

/**
 * The facts a chip is allowed to be built from. Every one of them is already
 * on the page for another reason: the two recorded ones come off the draft's
 * own `research_json` (see `recordedChecks`), and the outstanding ones are the
 * page's existing warning state -- the same values it hands `publishBlockers`.
 */
export type CheckFacts = {
  /** Is there a draft row at all? */
  hasDraft: boolean;
  /**
   * Did the evidence check RUN on this draft?
   *
   * Three records answer yes, and any one is enough:
   *
   *   1. a person's decision on the review (`evidenceReview.decision`),
   *   2. the stamp a completed "Check draft against evidence" run leaves
   *      behind (`evidenceReconciledAt`, see `recordedChecks`),
   *   3. the run's own output -- the findings and claims the evidence pass
   *      wrote, whose presence `evidenceToReview` is computed from, and which
   *      is the record that reconciled the bar with the Checks pane in U24.
   *
   * It says nothing about whether the answer still covers the text --
   * `evidenceOutstanding` and `evidenceRequired` are read first and win over
   * it.
   */
  evidenceChecked: boolean;
  /**
   * Claims from the evidence check that no person has judged yet (unit U24).
   *
   * The count is `claimsNeedingReview` over the resolved review
   * (`evidence-check-state.ts`) -- the same rows the Checks pane chips
   * `! Needs review`. It is here so this bar and that pane cannot say
   * different things about the same draft, which is exactly what happened on
   * the stand-in editorial day: `○ Evidence check not run` on the bar, seven
   * `! Needs review` rows in the pane, three inches apart.
   *
   * A page that has not resolved the review (the desk home's list row, which
   * projects the memo and nothing else) passes 0 and keeps the record-only
   * reading it has always had.
   */
  evidenceToReview: number;
  /** An evidence check ran and is still waiting on a person's decision. */
  evidenceRequired: boolean;
  /**
   * Something has put the evidence check back in the outstanding pile: the
   * story changed after it was checked, a claim of absence is unticked, a check
   * is queued or running, or a decision of the editor's is still saving.
   */
  evidenceOutstanding: boolean;
  /** Names the name check could not resolve (`nameCheck.rows`, `unresolved`). */
  namesUnresolved: number;
  /** Outlets the body names that this draft's Sources do not show. */
  namedOutlets: number;
  /** The name check ran to completion (`nameCheck.complete`). */
  nameCheckComplete: boolean;
  /**
   * Is there a name check RECORD on this draft at all -- complete or not? A
   * check that ran and did not finish (`complete: false`, "Name check did not
   * complete") is not a pass, but it is also not "no check ran", and the bar's
   * sentence has to be able to tell those two apart (U9b).
   */
  nameCheckRecorded: boolean;
  /** The story changed after the name check, so it no longer covers this text. */
  namesOutstanding: boolean;
};

/** The two gates as the draft row records them, off `drafts.research_json`. */
export function recordedChecks(research: string | null | undefined): {
  evidenceChecked: boolean;
  evidenceRequired: boolean;
  nameCheckComplete: boolean;
  nameCheckRecorded: boolean;
  namesUnresolved: number;
} {
  let review: { required?: unknown; decision?: unknown } | undefined;
  let reconciledAt: unknown;
  let nameCheckKey: unknown;
  try {
    const parsed: unknown = JSON.parse(research ?? "{}");
    if (parsed && typeof parsed === "object") {
      const value = (parsed as { evidenceReview?: unknown }).evidenceReview;
      if (value && typeof value === "object") review = value as { required?: unknown; decision?: unknown };
      reconciledAt = (parsed as { evidenceReconciledAt?: unknown }).evidenceReconciledAt;
      nameCheckKey = (parsed as { nameCheck?: unknown }).nameCheck;
    }
  } catch {
    /* A malformed legacy memo reads as "nothing recorded", not as a crash. */
  }
  const check = readNameCheck(research);
  const decided = typeof review?.decision === "string" && review.decision.trim() !== "";
  return {
    /*
      TWO RECORDS SAY AN EVIDENCE CHECK RAN, and either is enough (U9c, from the
      PR #154 review).

        1. A person's decision on the review: the pass `reconcileDraftEvidence`
           writes is `{ required: false, decision }`.
        2. The stamp a completed "Check draft against evidence" run leaves:
           `evidenceReconciledAt`, written by `draft-reconcile.server.ts:217`
           into the checked draft's `research_json` -- and by nothing else. The
           incomplete path writes `writerCheckpoint.evidenceCheckIncomplete`
           with no stamp, so the stamp really does mean "the run finished".

      THE STAMP IS NOT REDUNDANT WITH (1). That run copies the draft's research
      forward untouched -- it sets no decision and no `required` -- so a checked
      draft can carry the stamp with no `evidenceReview` key at all, or with
      `required: true` still on it from before the check. Reading only the
      decision made the workbench show "○ Evidence check not run" and leave the
      Check stage open for a draft the Checks tab was describing as checked.

      A draft with NEITHER record is the one nothing has ever been run against,
      which is the empty hand-filed tip this unit exists for.
    */
    evidenceChecked: decided || (typeof reconciledAt === "string" && reconciledAt.trim() !== ""),
    evidenceRequired: review?.required === true,
    nameCheckComplete: check?.complete === true,
    /* The key is written only by a check pass (`draft-reconcile.server.ts`,
       `editorial.server.ts`), so its presence is the record -- read raw rather
       than through `readNameCheck`, which answers null for a record it cannot
       parse and would turn a malformed one into "no check ever ran". */
    nameCheckRecorded: check !== null || (Boolean(nameCheckKey) && typeof nameCheckKey === "object"),
    namesUnresolved: (check?.rows ?? []).filter((row) => row.status === "unresolved").length,
  };
}

/**
 * The desk home row's facts (`tonightChips`).
 *
 * This row is a projection: the list query hands the desk the two recorded
 * checks and nothing else, so it carries no staleness, no claim and no running
 * check -- the story page is where those are read, and it says so there.
 *
 * THE ROWS THAT MOVED. The chip this replaced was written inline as
 * `required ? (decision ? ✓ : !) : ○`, which read `required` as the whole
 * question, and the row's third recorded field -- the reconciliation stamp the
 * query already projects as `evidence_checked_at` -- was not read at all. So
 * three recorded rows exist where the old chip and this rule disagree, and this
 * rule is the honest one:
 *
 *   - `required: false` with a decision -- the editor has just answered the
 *     review. The old chip said "○ Evidence check not run"; this says
 *     "✓ Evidence checked", which is what the record holds.
 *   - `required: true` with a kept decision -- the story moved on since that
 *     answer. The old chip said "✓ Evidence checked"; this says
 *     "! Evidence to check", because the review is open on this text.
 *   - a reconciliation stamp and no decision (U9c) -- a "Check draft against
 *     evidence" run finished and left its record. This says
 *     "✓ Evidence checked"; reading the decision alone said "not run".
 */
export function deskRowChecks(row: {
  evidence_required: boolean;
  evidence_decision: string | null;
  evidence_checked_at: string | null;
  names_checked_at: string | null;
  names_unresolved: number;
  name_check_complete: boolean;
}): CheckFacts {
  return {
    hasDraft: true,
    /* `evidence_checked_at` is the list query's own projection of the
       reconciliation stamp (`evidence_checked_at` at `desk.ts:2879` is
       `v.research->>'evidenceReconciledAt'`), so the desk home reads the same
       two records the workbench does -- U9c: it used to ignore this one and
       call a checked draft "not run". */
    evidenceChecked: Boolean(row.evidence_decision) || Boolean(row.evidence_checked_at),
    /*
      Unit U24: the desk home's list row is a projection of the draft's MEMO
      (`drafts.research_json`), and the review's rows are not in it -- findings
      live in `found_note`, which that query deliberately does not drag across
      the wire. So this screen keeps the record-only reading it has always had
      rather than guessing a count it cannot see; the story workbench, which
      resolves the review, is where the claims are counted.
    */
    evidenceToReview: 0,
    evidenceRequired: row.evidence_required,
    evidenceOutstanding: false,
    namesUnresolved: row.names_unresolved,
    namedOutlets: 0,
    nameCheckComplete: row.name_check_complete,
    /* `names_checked_at` is the query's own projection of `nameCheck.checkedAt`,
       written by every pass including one that did not complete. */
    nameCheckRecorded:
      row.name_check_complete || row.names_unresolved > 0 || Boolean(row.names_checked_at),
    namesOutstanding: false,
  };
}

/**
 * The names this chip is counting, in the desk home's words: a person the check
 * could not resolve, or an outlet the body names that the Sources do not show.
 * Both are "a name to review", both are reached from the Checks tab this chip
 * sits beside, and neither is a pass that can be claimed -- which is why they
 * are one count here and not two vocabularies on one bar.
 */
function namesToReview(facts: CheckFacts): number {
  return Math.max(0, facts.namesUnresolved) + Math.max(0, facts.namedOutlets);
}

const namesWord = (n: number) => `${n} name${n === 1 ? "" : "s"}`;

/**
 * The evidence chip.
 *
 * Warning first, in the order the editor meets it: something outstanding (the
 * text moved on, a claim is unticked, a check is running) then a check that ran
 * and has not been decided. Only a recorded decision is a pass.
 */
export function evidenceChip(facts: CheckFacts): CheckChip {
  if (facts.evidenceOutstanding || facts.evidenceRequired) {
    return { text: "! Evidence to check", tone: "warn", done: false };
  }
  /*
    Unit U24: a check that ran and left claims no person has judged is not "not
    run" and is not a pass. The desk said `○ Evidence check not run` here for
    exactly this state, while the Checks pane listed the seven claims it was
    talking about. The count is the pane's own `! Needs review` count, so the
    chip and the rows under it now name the same work.
  */
  if (facts.evidenceToReview > 0) {
    const n = facts.evidenceToReview;
    return {
      text: `! ${claimCount(n)} ${n === 1 ? "needs" : "need"} review`,
      tone: "warn",
      done: false,
    };
  }
  if (facts.evidenceChecked) return { text: "✓ Evidence checked", tone: "ok", done: true };
  return { text: "○ Evidence check not run", tone: "quiet", done: false };
}

/**
 * The names chip.
 *
 * The desk home's order: a name still to review is what the editor has to act
 * on, so it wins; then a check that no longer covers the text; and only a
 * completed check -- with nothing left to review -- is a pass. A draft whose
 * name check never ran says "not checked" rather than borrowing the green.
 */
export function namesChip(facts: CheckFacts): CheckChip {
  const n = namesToReview(facts);
  if (n > 0) return { text: `! ${namesWord(n)} to review`, tone: "warn", done: false };
  if (facts.namesOutstanding) {
    return { text: "! Name check is older than the text", tone: "warn", done: false };
  }
  if (facts.nameCheckComplete) return { text: "✓ Names checked", tone: "ok", done: true };
  return { text: "○ Names not checked", tone: "quiet", done: false };
}

/**
 * Is the Check stage of the stepper done?
 *
 * Only when the checks that apply actually ran and passed. A draft nothing has
 * been run against does not reach this stage -- that is the whole point of the
 * unit: `checkClear` used to answer "nothing is outstanding" and a blank draft
 * has nothing to be outstanding, so the workbench ticked Check on a story no
 * check had touched.
 */
export function checkStageDone(facts: CheckFacts): boolean {
  return facts.hasDraft && evidenceChip(facts).done && namesChip(facts).done;
}

/**
 * A chip for a gate that is the PAGE's own state rather than a recorded check:
 * "Saved" and "Preview viewed" on the publish bar. They never claim a check
 * ran, so they keep their two states and the page builds their words.
 */
export function pageGateChip(text: string, done: boolean): CheckChip {
  return { text, tone: done ? "ok" : "warn", done };
}

export type StoryStage = {
  /** "✓ Check" when it is done, otherwise the stage's own number. */
  label: string;
  state: "done" | "now" | "next";
};

/** The drawn Lead / Draft / Check / Publish stepper, from the same facts. */
export function storyStages(facts: CheckFacts, onPaper: boolean): StoryStage[] {
  const plan = [
    { label: "Lead", done: true },
    { label: "Draft", done: facts.hasDraft },
    { label: "Check", done: checkStageDone(facts) },
    { label: "Publish", done: onPaper },
  ];
  const firstOpen = plan.findIndex((stage) => !stage.done);
  return plan.map((stage, i) => ({
    label: `${stage.done ? "✓" : i + 1} ${stage.label}`,
    state: stage.done ? "done" : i === firstOpen ? "now" : "next",
  }));
}

/**
 * The publish bar's line when nothing blocks Publish.
 *
 * "All checks done." is a claim about the checks, not about the button: it is
 * only true when both chips are passes. When nothing stands in the way because
 * nothing was ever run -- a hand-filed story is allowed to print -- the bar has
 * to say that instead, and say which check is the one that did not run.
 */
export function publishBarNote(facts: CheckFacts): string {
  const evidence = evidenceChip(facts);
  const names = namesChip(facts);
  if (evidence.done && names.done) return "All checks done.";

  /* Unit U24: claims waiting on a person are a record that the check RAN, so
     they are counted on the ran side of every branch below -- otherwise this
     sentence would say "No evidence check ran on this draft" beside a chip
     counting seven claims it left. */
  const evidenceRan = facts.evidenceChecked || facts.evidenceRequired || facts.evidenceToReview > 0;
  const namesRan = nameCheckRan(facts);
  if (!evidenceRan && !namesRan) {
    return "Nothing blocks Publish. No evidence or name check ran on this draft.";
  }
  if (!evidenceRan && names.done) {
    return "Nothing blocks Publish. No evidence check ran on this draft.";
  }
  if (!namesRan && evidence.done) {
    return "Nothing blocks Publish. No name check ran on this draft.";
  }

  const said: string[] = [];
  if (!evidence.done) {
    const n = facts.evidenceToReview;
    if (n > 0) {
      said.push(`${claimCount(n)} from the evidence check ${n === 1 ? "is" : "are"} unreviewed`);
    } else {
      said.push(evidenceRan ? "the evidence check is not confirmed" : "no evidence check ran");
    }
  }
  if (!names.done) {
    const n = namesToReview(facts);
    if (n > 0) said.push(`${namesWord(n)} still need${n === 1 ? "s" : ""} review`);
    else if (facts.namesOutstanding) said.push("the name check is older than the story");
    else if (facts.nameCheckRecorded) said.push("the name check did not complete");
    else said.push("no name check ran");
  }
  const sentence = said.join(" and ");
  return `Nothing blocks Publish. ${sentence.slice(0, 1).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * Did a name check run on this draft at all?
 *
 * U9b: "no name check ran" is a sentence about the RECORD, not about the pass,
 * and the first version of this got it wrong -- it asked whether the check
 * completed or found something to review, so a check that ran and did not
 * finish, or one that finished before the last edit, had the bar saying "No
 * name check ran" beside a chip saying "! Name check is older than the text".
 * Any record at all means a check ran; what it found, and whether it still
 * covers this text, is the rest of the sentence's business.
 */
function nameCheckRan(facts: CheckFacts): boolean {
  return (
    facts.nameCheckRecorded ||
    facts.nameCheckComplete ||
    facts.namesOutstanding ||
    namesToReview(facts) > 0
  );
}
