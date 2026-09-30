/**
 * Every reason Publish is off, in one place (unit CT, 0.6.81).
 *
 * The owner's story filed under Longmont Leader, with a claim of absence and
 * no section, and Publish was simply off. The only sentence anywhere on the
 * page was small text at the far right of the bottom bar, and it named one
 * reason out of five; `evidenceStale`, a running reconcile and a saving
 * evidence decision all turned the button grey with nothing said at all. The
 * "Override Longmont Leader" button that would have fixed it sat mid-form in
 * the same grey as every hint.
 *
 * So the reason lives here, once. This is a pure function of the page state
 * the publish button already reads -- no DOM, no hooks, no React -- and the
 * button's `disabled` is derived from its length, not from a second list that
 * can drift away from it (see `publishBlockers` in
 * `src/routes/desk.story.$leadId.tsx`). If a rule is added to the button and
 * not to this file, the button stops disabling; there is nowhere else for the
 * rule to hide.
 *
 * The four gates this must not lose, because the server refuses each of them
 * on its own: an unconfirmed claim of absence (`absence-gate.ts`), a named
 * outlet with no source (`namedOutlets`), an empty dek (release 0.6.80,
 * `performPublish`) and an unchosen section.
 */

/**
 * Where a blocker's button goes. The page turns each of these into a real
 * press -- a focus, a scroll, or an existing mutation -- in
 * `src/routes/desk.story.$leadId.tsx`. Nothing here knows how.
 */
export type PublishBlockerTarget =
  | { kind: "headline" }
  | { kind: "dek" }
  | { kind: "body" }
  | { kind: "section" }
  /** The mid-form named-outlet block, where the override buttons live. */
  | { kind: "outlets" }
  /** The same mutation the mid-form "Override <outlet>" button calls. */
  | { kind: "override-outlet"; outlet: string }
  /** The Sources tab, where a document is added. */
  | { kind: "add-source" }
  /** The reporting notes, where the gate checkboxes are. */
  | { kind: "claims" }
  /** The same mutation the evidence review's "keep" press calls. */
  | { kind: "keep-evidence" }
  | { kind: "running-check" }
  | { kind: "evidence-review" }
  /**
   * Unit U24: the recorded override that says the editor has read the claims
   * the evidence check raised and is printing anyway. It writes the same kind
   * of confirmation `topicConfirmation` is (`leads.notes_json`, against this
   * exact draft version) and one `audit_events` row, so an unreviewed claim
   * that reached paper can always be traced to the person who accepted it.
   */
  | { kind: "accept-unreviewed" }
  | { kind: "publish-bar" };

export type PublishBlockerAction = {
  label: string;
  target: PublishBlockerTarget;
};

export type PublishBlocker = {
  /** Stable across renders, so a re-render does not lose the row's place. */
  key: string;
  sentence: string;
  action: PublishBlockerAction;
  /**
   * A blocker with two honest answers gets a second press -- a named outlet
   * can be overridden for this draft, or its source can be added for real.
   */
  altAction?: PublishBlockerAction;
};

/**
 * The page state the publish button reads. Every field is already computed on
 * the page for some other reason; this adds no new ones. `publishing`,
 * `reviewingEvidence` and `reconcileActive` are the three transient gates --
 * they clear themselves, so their rows say so rather than asking for a press
 * that does nothing.
 */
export type PublishBlockerState = {
  headline: string;
  dek: string;
  body: string;
  /** A person has chosen, or confirmed, the section this files under. */
  sectionReady: boolean;
  /** Claims of absence not yet ticked by a person (`uncheckedGateTodos`). */
  openClaims: number;
  /**
   * Claims the evidence check raised that no person has judged yet, with a
   * readable record to judge them against (unit U24). This is
   * `claimsNeedingReview` over the resolved review -- the same number the
   * Checks pane counts off its `! Needs review` chips and the same one the
   * evidence chip on the publish bar prints.
   */
  unreviewedClaims: number;
  /**
   * How many of `unreviewedClaims` the captured record CONTRADICTS (M5).
   *
   * A subset of the count above, from the same review
   * (`contradictedClaims`, evidence-check-state.ts), so the blocker can say
   * which part of the number is the part the record disagrees with. Defaults to
   * none for a caller that has not read the review.
   */
  contradictedClaims?: number;
  /**
   * The editor has already accepted those claims for THIS exact draft version.
   *
   * Read off `leads.notes_json` (`unreviewedClaimsConfirmation`), the same way
   * the section confirmation is: a press on the blocker records who accepted
   * and for which version, and an edit that changes the text moves the version
   * and brings the block back.
   */
  unreviewedAccepted: boolean;
  /** Outlets the body names that the draft's sources do not show. */
  namedOutlets: readonly string[];
  /** The story changed after its evidence was checked. */
  evidenceStale: boolean;
  /** An evidence decision of the editor's is still saving. */
  reviewingEvidence: boolean;
  /** An evidence check is queued or running. */
  reconcileActive: boolean;
  /** The publish request is in flight. */
  publishing: boolean;
};

function empty(text: string): boolean {
  return text.trim() === "";
}

/**
 * Does the story page draw the "Before you can publish" list at all? (Unit U24.)
 *
 * A KILLED LEAD IS NOT ON ITS WAY ANYWHERE. `performPublish` refuses one
 * outright ("Killed leads cannot print."), and the page already drops the
 * editors, "Draft with AI" and the whole publish bar for it. What was left was
 * this list, advertising "4 things block Publish" with four enabled buttons --
 * "Write the headline", "Write the story", "Write a dek", "Pick a section" --
 * three of which point at fields the page no longer draws. On the stand-in
 * editorial day that is what a killed lead's Checks tab showed.
 *
 * The action on a killed lead is Reopen, and that panel is already on the page.
 * A second list of controls that cannot be reached, counting down to a publish
 * that cannot happen, is the desk contradicting itself in the one place an
 * editor goes to find out what is left to do.
 */
export function showsPublishPrep(status: string): boolean {
  return status !== "killed";
}

/**
 * Every reason Publish is off, in the order the editor meets them: the story's
 * own text first, then the section it files under, then the names in it, then
 * the gates the desk keeps, then the three that clear themselves.
 *
 * Empty list means the button is on -- with one exception the caller owns:
 * `publish.isPending` is in `publishing`, so it is here too, and a press in
 * flight is not a reason that can be cleared by working.
 */
export function publishBlockers(state: PublishBlockerState): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  if (empty(state.headline)) {
    blockers.push({
      key: "headline",
      sentence: "The headline is empty, so there is nothing to print.",
      action: { label: "Write the headline", target: { kind: "headline" } },
    });
  }

  if (empty(state.body)) {
    blockers.push({
      key: "body",
      sentence: "The story body is empty.",
      action: { label: "Write the story", target: { kind: "body" } },
    });
  }

  if (empty(state.dek)) {
    /*
      Release 0.6.80 (unit CK): `performPublish` refuses a lead-bound draft
      with an empty dek. The sentence is the server's own instruction, so the
      page says it before the press instead of after it.
    */
    blockers.push({
      key: "dek",
      sentence:
        'The dek is empty. The desk refuses a story with no dek: "Add a dek, the one-line summary under the headline, before you publish."',
      action: { label: "Write a dek", target: { kind: "dek" } },
    });
  }

  if (!state.sectionReady) {
    blockers.push({
      key: "section",
      sentence: "No section has been chosen for this story.",
      action: { label: "Pick a section", target: { kind: "section" } },
    });
  }

  /*
    One row per named outlet, not one row listing them: each has its own
    override, and a single row with two buttons would make the editor work out
    which button clears which name. `namedOutlets` is the server's own answer,
    so the desk cannot disagree with the refusal.
  */
  for (const outlet of state.namedOutlets) {
    if (empty(outlet)) continue;
    const name = outlet.trim();
    blockers.push({
      key: `outlet:${name}`,
      sentence: `The body names ${name} and this draft's Sources do not show it.`,
      action: {
        label: `Override ${name}`,
        target: { kind: "override-outlet", outlet: name },
      },
      altAction: { label: "Add a source", target: { kind: "add-source" } },
    });
  }

  if (state.openClaims > 0) {
    const one = state.openClaims === 1;
    blockers.push({
      key: "claims",
      sentence: one
        ? "A claim of absence has not been confirmed."
        : `${state.openClaims} claims of absence have not been confirmed.`,
      action: {
        label: one ? "Confirm the claim" : "Confirm the claims",
        target: { kind: "claims" },
      },
    });
  }

  /*
    UNIT U24 -- THE CLAIMS THE CHECK RAISED AND NOBODY READ.

    On the stand-in editorial day a draft went to the paper with seven claims
    from its own evidence check still chipped `! Needs review`, and neither the
    chips, the bar, the list above nor the publish confirmation mentioned them:
    the desk had the list and did not act on it. Every other machine-made
    decision on this page passes a person before it prints; so does this one.

    Two honest answers, so the row has two presses: go and judge them (the
    Checks tab's own list, where each row opens into its judgment controls), or
    say in so many words that they are going out unreviewed. The second press
    is recorded against this exact draft version and written to the audit log,
    which is the difference between an override and a silent one.
  */
  if (state.unreviewedClaims > 0 && !state.unreviewedAccepted) {
    const n = state.unreviewedClaims;
    /*
      M5 of the batch-6 pre-merge audit. A count that folds a claim the record
      CONTRADICTS in with a claim nobody has got to yet is honest about the
      total and silent about the part that matters: the record says the story is
      wrong. The head count now carries the contradicted number, both presses
      say it, and the override names what the editor is accepting -- so nobody
      can press "Publish anyway" without having been told there are claims the
      record contradicts among them.
    */
    const m = Math.max(0, Math.min(state.contradictedClaims ?? 0, n));
    const them = n === 1 ? "it" : "them";
    const contradicted = m > 0 ? ` (${m} contradicted by the record)` : "";
    const tail =
      m === 0
        ? `The evidence check raised ${them} and no one has judged ${them} against the record.`
        : m === n
          ? `The evidence check raised ${them}, and the record contradicts ${
              n === 1 ? "it" : "every one"
            }.`
          : `The evidence check raised ${them}, and the record contradicts ${m} of them.`;
    blockers.push({
      key: "claims-unreviewed",
      sentence: `${n} claim${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} review${contradicted}. ${tail}`,
      action: {
        label: n === 1 ? "Review the claim" : "Review the claims",
        target: { kind: "evidence-review" },
      },
      altAction: {
        label:
          m > 0
            ? `Publish anyway — I accept these claims, including ${m} the record contradicts`
            : "Publish anyway — I accept these claims are unreviewed",
        target: { kind: "accept-unreviewed" },
      },
    });
  }

  if (state.evidenceStale) {
    blockers.push({
      key: "evidence-stale",
      sentence: "The story changed after its evidence was checked, so the check no longer covers this text.",
      action: {
        label: "I checked: keep this evidence",
        target: { kind: "keep-evidence" },
      },
      altAction: { label: "See the evidence review", target: { kind: "evidence-review" } },
    });
  }

  if (state.reconcileActive) {
    blockers.push({
      key: "reconcile-running",
      sentence: "An evidence check is running on this draft. Its answer is not in yet.",
      action: { label: "See the running check", target: { kind: "running-check" } },
    });
  }

  if (state.reviewingEvidence) {
    blockers.push({
      key: "evidence-review-saving",
      sentence: "Your evidence decision is still saving.",
      action: { label: "See the evidence review", target: { kind: "evidence-review" } },
    });
  }

  if (state.publishing) {
    blockers.push({
      key: "publishing",
      sentence: "This publish is already running.",
      action: { label: "See the publish bar", target: { kind: "publish-bar" } },
    });
  }

  return blockers;
}

/**
 * The bottom bar's line: "3 things block Publish", or "" when nothing does.
 *
 * The old bar printed the first reason only, one at a time, at the far right
 * of a row -- the owner read it as stray text and never found the button it
 * was pointing at. This counts instead of naming, so the fix is always the
 * same press: the list at the top of the Checks tab.
 */
export function publishBlockedSummary(blockers: readonly PublishBlocker[]): string {
  const n = blockers.length;
  if (n === 0) return "";
  return n === 1 ? "1 thing blocks Publish" : `${n} things block Publish`;
}

/**
 * The sticky bar's own line (unit CW), drawn as "Review 1 name to publish.":
 * the first reason, said as the press that clears it, then what it stands
 * between the editor and.
 *
 * The phrase is the blocker's own `action.label` -- the same words on the
 * row at the top of the Checks tab and on the button that clears it -- so the
 * bar cannot describe a fix in words the control does not use, and the first
 * reason on the bar is provably the first row of the list it points at.
 *
 * An empty list returns "", because "All checks done." is the page's sentence
 * about the button being live, not this function's answer about a reason.
 */
export function publishGateNote(blockers: readonly PublishBlocker[]): string {
  const first = blockers[0];
  return first ? `${first.action.label} to publish.` : "";
}
