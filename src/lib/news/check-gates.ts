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
 * The rule is the desk home's (`desk.index.tsx`, `tonightChips`): a gate that
 * was never run says so -- `○`, the quiet dashed chip -- and a pass has to be
 * recorded before it can be claimed. This file is that rule once, for the three
 * readers that were each deciding it for themselves: the gate chips, the stage
 * stepper and the line beside the Publish button, on both the lead workbench
 * (`desk.story.$leadId.tsx`) and the editorial workbench
 * (`desk.story.draft.$draftId.tsx`).
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
  /** An evidence check ran and a person recorded a decision on it. */
  evidenceChecked: boolean;
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
  /** The story changed after the name check, so it no longer covers this text. */
  namesOutstanding: boolean;
};

/** The two gates as the draft row records them, off `drafts.research_json`. */
export function recordedChecks(research: string | null | undefined): {
  evidenceChecked: boolean;
  evidenceRequired: boolean;
  nameCheckComplete: boolean;
  namesUnresolved: number;
} {
  let review: { required?: unknown; decision?: unknown } | undefined;
  try {
    const parsed: unknown = JSON.parse(research ?? "{}");
    if (parsed && typeof parsed === "object") {
      const value = (parsed as { evidenceReview?: unknown }).evidenceReview;
      if (value && typeof value === "object") review = value as { required?: unknown; decision?: unknown };
    }
  } catch {
    /* A malformed legacy memo reads as "nothing recorded", not as a crash. */
  }
  const check = readNameCheck(research);
  return {
    /*
      A decision is the only proof the evidence check ran and was READ: the
      pass `reconcileDraftEvidence` writes is `{ required: false, decision }`,
      and it writes `required: true` with no decision for as long as the answer
      is still the editor's to give. A draft with no `evidenceReview` key at all
      is one nothing has ever been run against.
    */
    evidenceChecked: typeof review?.decision === "string" && review.decision.trim() !== "",
    evidenceRequired: review?.required === true,
    nameCheckComplete: check?.complete === true,
    namesUnresolved: (check?.rows ?? []).filter((row) => row.status === "unresolved").length,
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

  const evidenceRan = facts.evidenceChecked || facts.evidenceRequired;
  const namesRan = facts.nameCheckComplete || namesToReview(facts) > 0;
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
    said.push(evidenceRan ? "the evidence check is not confirmed" : "no evidence check ran");
  }
  if (!names.done) {
    const n = namesToReview(facts);
    if (n > 0) said.push(`${namesWord(n)} still need${n === 1 ? "s" : ""} review`);
    else if (facts.namesOutstanding) said.push("the name check is older than the story");
    else said.push("no name check ran");
  }
  const sentence = said.join(" and ");
  return `Nothing blocks Publish. ${sentence.slice(0, 1).toUpperCase()}${sentence.slice(1)}.`;
}
