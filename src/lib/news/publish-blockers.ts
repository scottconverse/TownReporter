import { draftLooksCutOff, CUT_OFF_WARNING } from "./draft-completeness.ts";
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

import { editorActionError } from "./desk-copy.ts";
import { refusedAnswer } from "./refused-answer.ts";
import type { StoryReadinessState } from "./story-readiness.ts";
import { UNCHECKED_STORY_REASON } from "./unchecked-story-gate.ts";

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
  /**
   * Unit ZC: the one-press "I checked this story myself" for a draft whose
   * evidence check recorded NO claims but which carries a checkable fact and
   * has no completed check for this version. It writes the same kind of
   * version-bound record (`leads.notes_json`, against
   * `evidenceReviewToken(draft)`) and one `audit_events` row, so a story that
   * printed unchecked can always be traced to the person who read it.
   */
  | { kind: "acknowledge-unchecked" }
  | { kind: "publish-bar" }
  /**
   * DHD2-2: the held and killed cards' "Publish anyway" press. It publishes in
   * the same press (the server un-holds or restores the lead inside the publish
   * transaction), so the page runs the publish rather than scrolling to the bar.
   */
  | { kind: "publish-now" };

export type PublishBlockerAction = {
  label: string;
  target: PublishBlockerTarget;
};

export type PublishBlocker = {
  /** Stable across renders, so a re-render does not lose the row's place. */
  key: string;
  /**
   * ── WHICH KIND OF REASON THIS IS (unit OH) ────────────────────────────────
   *
   * `"hard"` -- the desk itself refuses this, so there is nothing for a person
   * to weigh: an empty headline or body, a press already in flight, an evidence
   * decision still saving, or a lead this page cannot even find. These are
   * the ONLY reasons that turn the Publish button off.
   *
   * `"warning"` -- a judgement call the editor is paid to make: an unnamed
   * source for a named outlet, an unreviewed or contradicted claim, a live or
   * stale evidence check, an AI readiness verdict, a held or killed draft, a missing
   * dek or section. A warning is DRAWN in the confirm dialog and the editor
   * prints over it; it never disables the button by itself.
   *
   * The five hard keys are exactly: `headline`, `body`, `publishing`,
   * `evidence-review-saving`, `lead-not-found`. Everything
   * else is a warning.
   */
  kind: "warning" | "hard";
  sentence: string;
  /**
   * G23-UX-6 (D278): a warning that is really a LIST says so in two parts, so
   * the dialog and the Checks panel can draw the items as an `<ol>` instead of
   * one long sentence. `sentence` stays the same string (audit rows, the
   * server's refusal and the acknowledgement all still read it); `lead` is the
   * sentence before the items and `items` are the items themselves.
   */
  lead?: string;
  items?: readonly string[];
  action: PublishBlockerAction;
  /**
   * A blocker with two honest answers gets a second press -- a named outlet
   * can be overridden for this draft, or its source can be added for real.
   */
  altAction?: PublishBlockerAction;
};

/**
 * The page state the publish button reads. Every field is already computed on
 * the page for some other reason; this adds no new ones. `publishing` and
 * `reviewingEvidence` are the two transient gates -- they clear themselves, so
 * their rows say so rather than asking for a press that does nothing. A running
 * evidence check (`reconcileActive`) is a warning: its row offers Publish anyway.
 */
export type PublishBlockerState = {
  evidenceLoading?: boolean;
  headline: string;
  dek: string;
  body: string;
  /** A person has chosen, or confirmed, the section this files under. */
  sectionReady: boolean;
  /**
   * DHI-8: the section this story files under, so the warning block's own
   * "Publish anyway" button can name it exactly as the confirm does. Optional:
   * a caller that has not resolved a section passes nothing and the button
   * names no section, the same as a story with no section.
   */
  sectionName?: string;
  /** The AI's last saved readiness result for a civic-reporting draft. */
  readiness?: StoryReadinessState;
  readinessReason?: string;
  /** Claims of absence not yet ticked by a person (`uncheckedGateTodos`). */
  openClaims: number;
  /** Claims needing a person: both `! Needs review` and `Could not check` rows. */
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
  /**
   * Unit ZC: the draft's evidence check recorded no claims at all, no completed
   * check covers this version, and the body carries a fact worth checking
   * (`uncheckedStoryNeedsCheck`). A zero-claim story nobody has checked is not a
   * clear story -- it is an unchecked one, and this is the flag that says so.
   */
  uncheckedStory?: boolean;
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
  /**
   * The lead's own status, when the page knows it (unit OH). `"held"` and
   * `"killed"` are WARNINGS now: a held or killed draft keeps its publish bar,
   * and the way back is one press -- un-hold (or restore) and publish in the
   * same press. Anything else, or absent, adds neither row.
   */
  leadStatus?: string;
  /**
   * The desk's own sentence about a meeting citation that no longer matches the
   * record (unit OH). A warning: the editor may print, having read it. Absent
   * or blank adds no row.
   */
  meetingCitationNotice?: string;
  /**
   * MS-WIRE W3: the meeting writer's pre-publication check list
   * (`drafts.editor_checks`). Empty or absent adds no row; one or more adds the
   * `meeting-editor-checks` warning, which the editor may publish over.
   */
  meetingEditorChecks?: readonly string[];
  /**
   * D235: the check list on this draft came from the news skill
   * (`run_stats->>'writer'` is `report-local-news`), so the warning's lead says
   * "The writer", not "The meeting writer". Absent keeps the meeting wording.
   */
  meetingEditorChecksFromNewsWriter?: boolean;
  /**
   * TPW-2: when the saved draft was last written (its `updated_at`, ISO). A draft
   * older than OLD_DRAFT_DAYS adds one warning; absent adds none.
   */
  draftWrittenAt?: string | null;
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
 *
 * FB6 item 8a, from the stand-in walkthrough (A2c-REPORT.md §6 C4): a story
 * with NO DRAFT showed "4 things block Publish" -- "Write the headline", "Write
 * the story", "Write a dek", "Pick a section" -- directly above the page's own
 * "No draft yet". Four prep tasks is a checklist for a draft that does not
 * exist, and it is the wrong list in the wrong order: with nothing written,
 * every one of those rows is downstream of a single press. So the list is drawn
 * only once there is a draft to prepare, and the pane says the one next step
 * instead (see the route's no-draft pane).
 *
 * ── WHAT CHANGED (unit OH) ────────────────────────────────────────────────────
 *
 * A KILLED OR HELD DRAFT NOW KEEPS ITS PUBLISH BAR. The owner changed the rule
 * on purpose: the way back from a killed or held lead is one press -- un-hold
 * (or restore) and publish in the same press -- and a page that hides the bar
 * leaves the editor nowhere to make it. The list of reasons over a bar that
 * exists is the work, not a dead end. (The old rule hid the list on a killed
 * lead because the bar was gone; with the bar back, hiding the list too would
 * be the same contradiction reversed.)
 *
 * What still hides the list is having NO DRAFT: four prep tasks are a checklist
 * for a story that does not exist, and the page says the one next step instead.
 *
 * `hasDraft` is required rather than defaulted: a caller that forgets it would
 * get the old behaviour back silently, which is exactly the bug.
 */
export function showsPublishPrep(status: string, hasDraft: boolean): boolean {
  /* Walk E2, DHE2-1: a published story is already in print. Its Story page
     must not count down to a press that cannot happen again. */
  return hasDraft && status !== "published";
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
/** DHI-8: the ONE words for "Publish anyway", used by the warning block's own
 * button and by the confirm, so one act never reads two ways. A piece with no
 * section has no "in <section>" to say (THU-10); the accepted-claims part is
 * passed in, because the block and the confirm know it differently. */
export function publishAnywayLabel(sectionName: string | undefined, acceptWords: string): string {
  const where = sectionName?.trim() ? ` in ${sectionName.trim()}` : "";
  return `Publish anyway${where}${acceptWords}`;
}

/** TPU-2: the confirm press after an accepted claim says what it does now. */
export function publishNowLabel(sectionName: string | undefined): string {
  const where = sectionName?.trim() ? ` in ${sectionName.trim()}` : "";
  return `Publish now${where}`;
}

/**
 * TPU-4: the editor's acceptance of the unreviewed claims is recorded for this
 * draft version and covers every claim still open. The server keeps the count
 * on `leads.notes_json` and returns it on every page load, so a reload knows the
 * acceptance too. Same rule `acceptedClaimsPublishState` uses to drop the warning.
 * With nothing still open there is no acceptance to show: performPublish ignores
 * one too (it only checks the acceptance while claims are outstanding).
 */
export function acceptanceRecordedFor(acceptedCount: number, openCount: number): boolean {
  return openCount > 0 && acceptedCount >= openCount;
}

/**
 * TPW-2: a draft last written more than this many days before the publish prints
 * its own time words ("Saturday", "two days out") under today's date. The desk
 * warns about that and never blocks: the editor may print after reading it.
 */
export const OLD_DRAFT_DAYS = 14;

/**
 * The old-draft warning's sentence, or null when the draft is recent enough or
 * its date is missing. The server (desk.ts collectWarnings) and the page
 * (publishBlockers) both call this, so the two lists say the same words.
 */
export function oldDraftSentence(writtenAt: string | null | undefined, now: Date): string | null {
  if (!writtenAt) return null;
  const written = new Date(writtenAt);
  if (Number.isNaN(written.getTime())) return null;
  const days = Math.floor((now.getTime() - written.getTime()) / 86_400_000);
  if (days <= OLD_DRAFT_DAYS) return null;
  const when = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Denver",
  }).format(written);
  return `This draft was last written ${when} (${days} days ago). Check any words about dates and times, such as "Saturday" or "two days out", before you publish.`;
}

export function publishBlockers(state: PublishBlockerState): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (draftLooksCutOff(state.body ?? "")) blockers.push({key:"draft-cut-off",kind:"warning",sentence:CUT_OFF_WARNING,action:{label:"Read the draft",target:{kind:"body"}}});

  if (empty(state.headline)) {
    blockers.push({
      key: "headline",
      kind: "hard",
      sentence: "The headline is empty, so there is nothing to print.",
      action: { label: "Write the headline", target: { kind: "headline" } },
    });
  }

  if (empty(state.body)) {
    blockers.push({
      key: "body",
      kind: "hard",
      sentence: "The story body is empty.",
      action: { label: "Write the story", target: { kind: "body" } },
    });
  }

  if (empty(state.dek)) {
    /*
      A missing dek is a WARNING (unit OH). The desk once refused a lead-bound
      draft with no dek (`performPublish`, release 0.6.80), and the row borrowed
      the server's refusal verbatim -- "The desk refuses a story with no dek."
      That is a lie now that the editor may print over the warning: the row says
      what is missing in plain words, and the confirm dialog names the section
      the press files under. The server's own gate, if it still stands, refuses
      the press and says so at the bar, which is where a refusal belongs.
    */
    blockers.push({
      key: "dek",
      kind: "warning",
      sentence: "The dek is empty. It is the one-line summary under the headline.",
      action: { label: "Write a dek", target: { kind: "dek" } },
    });
  }

  if (
    state.readiness === "checking" ||
    state.readiness === "not-ready" ||
    state.readiness === "to-check"
  ) {
    blockers.push({
      key: "readiness",
      kind: "warning",
      sentence: state.readinessReason || (state.readiness === "checking"
        ? "The AI is still checking this story against the meeting record."
        : "This story is not ready to publish."),
      action: { label: "Review remaining checks", target: { kind: "evidence-review" } },
    });
  }

  const oldDraft = oldDraftSentence(state.draftWrittenAt, new Date());
  if (oldDraft) {
    blockers.push({
      key: "draft-old",
      kind: "warning",
      sentence: oldDraft,
      action: { label: "Read the draft", target: { kind: "body" } },
    });
  }
  if (state.evidenceLoading) blockers.push({ key: "evidence-loading",
      kind: "warning",
      sentence: "Loading evidence judgments.",
    action: { label: "Review the checks", target: { kind: "evidence-review" } },
    });
  if (!state.sectionReady) {
    blockers.push({
      key: "section",
      kind: "warning",
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
      kind: "warning",
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
      kind: "warning",
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
      kind: "warning",
      sentence: `${n} claim${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} review${contradicted}. ${tail}`,
      action: {
        label: n === 1 ? "Review the claim" : "Review the claims",
        target: { kind: "evidence-review" },
      },
      altAction: {
        label: publishAnywayLabel(
          state.sectionName,
          m > 0
            ? ` — I accept these claims, including ${m} the record contradicts`
            : " — I accept these claims are unreviewed",
        ),
        target: { kind: "accept-unreviewed" },
      },
    });
  }

  /*
    UNIT ZC -- THE CLAIMS NOBODY RECORDED, SO NOBODY CHECKED.

    The row above fires only when the evidence check RAISED claims. A check that
    raised none leaves `unreviewedClaims` at 0, so a story nothing has ever been
    run against -- with a dollar figure, a date or a vote in it -- printed with
    no gate at all: `○ Evidence check not run` beside an enabled Publish. The
    flag is decided once (`uncheckedStoryNeedsCheck`) from the review's own
    output, whether a completed check covers this version, and the body's facts,
    so the desk's row, the readiness chip and the server's refusal all read one
    answer.

    Two honest answers again, and the same shape as the row above: run the check
    (where the evidence pane's own control lives), or say in so many words that
    the editor read it against their sources. The second press is recorded for
    this exact draft version and audited.
  */
  if (state.uncheckedStory) {
    blockers.push({
      key: "unchecked",
      kind: "warning",
      sentence: UNCHECKED_STORY_REASON,
      action: { label: "Run the evidence check", target: { kind: "evidence-review" } },
      altAction: { label: "I checked this story myself", target: { kind: "acknowledge-unchecked" } },
    });
  }

  if (state.evidenceStale) {
    /*
      TNB-6: with no claims recorded the unchecked warning above says nothing
      has been checked, so this one must not say a check went stale. The text
      did change, so the warning stays, worded to agree with it.
    */
    blockers.push({
      key: "evidence-stale",
      kind: "warning",
      sentence: state.uncheckedStory
        ? "The story changed after its evidence was gathered, so that evidence does not cover this text."
        : "The story changed after its evidence was checked, so the check no longer covers this text.",
      action: {
        label: "I checked: keep this evidence",
        target: { kind: "keep-evidence" },
      },
      altAction: { label: "See the evidence review", target: { kind: "evidence-review" } },
    });
  }

  /*
    ── A RUNNING EVIDENCE CHECK (ENG-2, warning) ─────────────────────────────
    The desk does not refuse a press over a check that is still running. The
    press prints over it and the server records that override like any other
    warning; the sentence is the server's own (desk.ts performPublish). The page
    cannot see a check's cancel request or heartbeat, so it warns for any queued
    or running check and the server is the judge of which ones count.
  */
  if (state.reconcileActive) {
    blockers.push({
      key: "reconcile-running",
      kind: "warning",
      sentence:
        "An evidence check is running on this draft. Its answer is not in yet. Publish anyway prints it before that answer comes in.",
      action: { label: publishAnywayLabel(state.sectionName, ""), target: { kind: "publish-now" } },
      altAction: { label: "See the running check", target: { kind: "running-check" } },
    });
  }

  if (state.reviewingEvidence) {
    blockers.push({
      key: "evidence-review-saving",
      kind: "hard",
      sentence: "Your evidence decision is still saving.",
      action: { label: "See the evidence review", target: { kind: "evidence-review" } },
    });
  }

  if (state.publishing) {
    blockers.push({
      key: "publishing",
      kind: "hard",
      sentence: "This publish is already running.",
      action: { label: "See the publish bar", target: { kind: "publish-bar" } },
    });
  }

  /*
    ── THE LEAD THIS PAGE CANNOT FIND (unit OH, hard) ────────────────────────
    A lead-row that is gone -- deleted, killed out from under an open tab, or
    never filed on this desk -- cannot be printed by any press, because the
    server has nothing to print. `leadStatus: "missing"` is the page's own word
    for it (see `publishLead`, which refuses "There is no such story."). It is
    the sixth hard key, and the one that is not about the draft's own text.
  */
  if (state.leadStatus === "missing") {
    blockers.push({
      key: "lead-not-found",
      kind: "hard",
      sentence: "This lead is no longer on the desk, so there is nothing to print.",
      action: { label: "Back to the queue", target: { kind: "publish-bar" } },
    });
  }

  /*
    ── A HELD OR KILLED DRAFT KEEPS ITS BAR (unit OH, warnings) ──────────────
    The owner changed the rule: a held or killed draft keeps its publish bar,
    and the way back is ONE press -- un-hold (or restore) and publish in the
    same press. So each says exactly that, in words naming the single press,
    rather than sending the editor to a second control. Both are warnings: the
    press is real, and the server does the restore inside the publish
    transaction, so nothing here refuses on the editor's behalf.
  */
  if (state.leadStatus === "held") {
    blockers.push({
      key: "lead-held",
      kind: "warning",
      sentence: "This draft is on hold. This press un-holds it and publishes it in the same press.",
      action: { label: "Publish anyway", target: { kind: "publish-now" } },
    });
  }

  if (state.leadStatus === "killed") {
    blockers.push({
      key: "lead-killed",
      kind: "warning",
      sentence: "This draft is killed. \"Publish anyway\" restores the lead and publishes this draft.",
      action: { label: "Publish anyway", target: { kind: "publish-now" } },
    });
  }

  /*
    ── A MEETING CITATION THAT NO LONGER MATCHES (unit OH, warning) ──────────
    `data.lead.meetingCitationNotice` (see the route) is the desk's own sentence
    for a citation that has drifted from the record. It is a warning: the story
    may still go out, and the editor sees in the confirm dialog exactly what
    they are printing over.
  */
  if (state.meetingCitationNotice?.trim()) {
    blockers.push({
      key: "meeting-citation-stale",
      kind: "warning",
      sentence: state.meetingCitationNotice.trim(),
      action: { label: "Review the citation", target: { kind: "evidence-review" } },
    });
  }

  /*
    ── WHAT THE WRITER ASKS A PERSON TO CHECK (MS-WIRE W3, D235) ──────────────
    One writer, the report-local-news skill, runs on meeting leads and on news
    leads, and ends its work with the items that rest only on captions, a number
    read off a screen, a disputed figure, or a sentence with legal risk. The
    lead kind (`isMeetingStoryLead`, meeting-lead-kind.ts) decides whether the
    warning says "The meeting writer" or "The writer". They are a
    WARNING, not a wall (Scott's editor-control rule): the list is printed in
    the confirm dialog, and "Publish anyway" prints over it.
  */
  if (state.meetingEditorChecks?.length) {
    const lines = meetingEditorChecksLines(state.meetingEditorChecks, {
      fromNewsWriter: state.meetingEditorChecksFromNewsWriter,
    });
    blockers.push({
      key: "meeting-editor-checks",
      kind: "warning",
      sentence: meetingEditorChecksNotice(state.meetingEditorChecks, {
        fromNewsWriter: state.meetingEditorChecksFromNewsWriter,
      }),
      lead: lines.lead,
      items: lines.items,
      action: { label: "Review the checks", target: { kind: "evidence-review" } },
    });
  }

  return blockers;
}

/**
 * The one sentence a check list is published over:
 * "The meeting writer asks you to check 2 things before publishing: 1. … 2. …"
 * for a meeting draft, or the same with just "The writer" when the draft's lead
 * is not a meeting story (isMeetingStoryLead, meeting-lead-kind.ts) and the
 * report-local-news skill wrote it (D235).
 *
 * The same builder feeds the server's refusal (desk.ts `collectWarnings`), so
 * the dialog and a refused press cannot say different things about the same
 * draft.
 */
export function meetingEditorChecksNotice(
  checks: readonly string[],
  options: { fromNewsWriter?: boolean } = {},
): string {
  const { lead, items } = meetingEditorChecksLines(checks, options);
  return items.length
    ? `${lead} ${items.map((item, index) => `${index + 1}. ${item}`).join(" ")}`
    : lead;
}

/**
 * G23-UX-6 (D278): the same check list in two parts -- the lead sentence and
 * the items -- so a screen can draw the items as a real `<ol>` instead of one
 * run-on sentence with "1." and "2." typed into it.
 *
 * `meetingEditorChecksNotice` builds its string from THIS, so the sentence the
 * audit rows, the server's refusal and the acknowledgement key still carry is
 * unchanged byte for byte.
 */
export function meetingEditorChecksLines(
  checks: readonly string[],
  options: { fromNewsWriter?: boolean } = {},
): { lead: string; items: string[] } {
  const items = checks.map((check) => String(check ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const count = items.length;
  const who = options.fromNewsWriter ? "The writer" : "The meeting writer";
  return {
    lead: `${who} asks you to check ${count} thing${count === 1 ? "" : "s"} before publishing:`,
    items,
  };
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
  const hard = blockers.filter((blocker) => blocker.kind === "hard").length;
  const warnings = blockers.length - hard;
  const parts: string[] = [];
  if (hard) parts.push(hard === 1 ? "1 thing blocks Publish" : `${hard} things block Publish`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"} before Publish`);
  return parts.join("; ");
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
  return first?.key === "readiness" ? first.sentence : first ? `${first.action.label} to publish.` : "";
}

/**
 * ── THE CONFIRM PRESS, DECIDED (unit OH) ──────────────────────────────────────
 *
 * The pure half of the override: given every reason Publish is off and the
 * section the press files under, what does the confirm dialog show?
 *
 *   - `enabled` -- the button is off exactly when a HARD reason is present. A
 *     list of warnings keeps it on; that is the whole unit.
 *   - `warnings` -- the warning-kind reasons only, in list order, so a hard
 *     reason is never drawn as a sentence to accept.
 *   - `acknowledgedWarningKeys` -- the keys of the warnings THIS decision draws.
 *     The page snapshots exactly these at the moment of the confirm press, so a
 *     warning that arrives while the dialog is open is not silently accepted.
 *   - `confirmLabel` -- "Publish anyway in <section>" when there is anything to
 *     overrule (with the unreviewed-claims words after it when that is the
 *     warning, matching the button above the press), the desk's own unchanged "Yes, print it in <section>" when
 *     there is not.
 *
 * A blocker with NO `kind` (an older caller, or a hand-built list) is treated as
 * HARD, so an unknown reason can never silently unlock the button -- the same
 * compatibility rule `acceptedClaimsPublishState` keeps.
 */
export type PublishConfirmation = {
  enabled: boolean;
  warnings: PublishBlocker[];
  acknowledgedWarningKeys: string[];
  confirmLabel: string;
};

export function publishConfirmation(
  blockers: readonly PublishBlocker[],
  sectionName: string,
  options: {
    /*
      DJ-3: the editor has recorded "I accept these claims are unreviewed" on
      this page. The warning that carried those words is gone from `blockers`
      once the record exists, so the confirm keeps the words itself: an act that
      accepted unreviewed claims must read as that act on its button.
    */
    claimsAccepted?: boolean;
  } = {},
): PublishConfirmation {
  const hasHard = blockers.some((blocker) => blocker.kind !== "warning");
  const warnings = blockers.filter((blocker) => blocker.kind === "warning");
  /*
    DHI-8: the warning block above the press offers its own "Publish anyway"
    button, and this confirm is the same act -- so the confirm takes that
    button's own words. `publishBlockers` already built them with the section
    name, so the two buttons read the one sentence. When the acceptance is
    already recorded the warning is gone from `blockers`, and `claimsAccepted`
    (DJ-3) rebuilds the same sentence with this confirm's section name.
  */
  const accepted = warnings.find((warning) => warning.key === "claims-unreviewed")?.altAction?.label;
  /*
    The block built its label with the section it was given; this confirm names
    the same section. Strip any section the block already inserted and rebuild
    the one sentence here, so both buttons carry the SAME words even when the
    two callers passed the section in different places.
  */
  const acceptWords = accepted
    ? accepted.slice(accepted.indexOf("—") > 0 ? accepted.indexOf("—") - 1 : "Publish anyway".length)
    : options.claimsAccepted
      ? " — I accept these claims are unreviewed"
      : "";
  /* A piece with no section has no "in <section>" to say (THU-10). */
  const overrideLabel = publishAnywayLabel(sectionName, acceptWords);
  return {
    enabled: !hasHard,
    warnings,
    acknowledgedWarningKeys: warnings.map((warning) => warning.key),
    confirmLabel: options.claimsAccepted
      ? publishNowLabel(sectionName)
      : warnings.length > 0 || acceptWords !== ""
        ? overrideLabel
        : `Yes, print it${sectionName.trim() ? ` in ${sectionName.trim()}` : ""}`,
  };
}

/**
 * What the publish bar says about the press, in one value (unit PUB1).
 *
 * THE OWNER'S PRESS. He pressed "Publish in Elections" and the same button
 * came back with no message; the refusal -- if it was drawn at all -- was a
 * Notice in the page body, far from the sticky bar he was looking at. A press
 * that answers nowhere is indistinguishable from a broken button, and it is
 * the one thing the bar must not do: it is where the press was made, so it is
 * where the answer belongs.
 *
 * This is the page's whole answer, derived rather than latched, so the bar
 * cannot show two of them at once:
 *
 *   - `publishing`: the press is in flight. Nothing else is known yet, so
 *     nothing else is said.
 *   - `refused`: the server refused (or the request threw, or the desk did not
 *     answer at all). The words are the server's own, which already name what
 *     to do next for every gate it keeps.
 *   - `published`: it printed. `slug` is the article, so the bar can offer the
 *     way to read it.
 *
 * A refusal outranks a printed banner on purpose: if both were somehow set,
 * the honest thing to show is the one that says nothing went to the paper.
 * `idle` is the ordinary state -- the gate list and the button speak for
 * themselves.
 */
export type PublishPressState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "refused"; message: string }
  | { kind: "published"; slug: string | null };

export function publishPressState(input: {
  /** The publish request is in flight. */
  publishing: boolean;
  /** The server's own words for the last refusal, or "" when there was none. */
  refusal: string;
  /** The article this session just printed, or null. */
  publishedSlug: string | null;
}): PublishPressState {
  if (input.publishing) return { kind: "publishing" };
  if (input.refusal.trim()) return { kind: "refused", message: input.refusal.trim() };
  if (input.publishedSlug) return { kind: "published", slug: input.publishedSlug };
  return { kind: "idle" };
}

/**
 * Unit UI1a3, finding 1: a REFUSAL is a failed press, not a finished one.
 *
 * The derivation below is the whole of the fix, and it is a pure function of
 * what the three mutations report -- which is what makes the bug testable,
 * because the page itself is a `.tsx` route no test can mount. `refusedAnswer`
 * is re-exported so a test can read the rule from the same door the page's
 * neighbours do.
 */
export { refusedAnswer };

/** One blocker-row press, exactly as its mutation reports itself. */
export type BlockerPressFacts = {
  /** The request is in flight. */
  isPending: boolean;
  /** The request THREW (the rarer failure; a refusal resolves instead). */
  isError: boolean;
  /** The thrown error, when `isError`. */
  error?: unknown;
  /** The resolved answer, which may itself refuse (`{ ok: false, error }`). */
  answer?: unknown;
};

export type BlockerPressState = {
  busyTarget: PublishBlockerTarget["kind"] | null;
  failedTarget: PublishBlockerTarget["kind"] | null;
  /** The sentence printed beside the row that failed. */
  failureReason: string | null;
};

/** An idle press fact, for a caller that has not wired a row (unit ZC). */
const IDLE_PRESS: BlockerPressFacts = { isPending: false, isError: false };

/*
  The words placed before a thrown error's reason, per row. The refusals carry
  their own complete sentence and take no lead-in, which is why the map is read
  only on the `isError` branch.
*/
const BLOCKER_FAILED_LEAD: Record<string, string> = {
  "accept-unreviewed": "record that acceptance",
  "acknowledge-unchecked": "record that check",
  "override-outlet": "record the override",
  "keep-evidence": "save the evidence review",
};
const BLOCKER_FAILED_FALLBACK: Record<string, string> = {
  "accept-unreviewed": "Could not record that acceptance.",
  "acknowledge-unchecked": "Could not record that check.",
  "override-outlet": "Could not record the override.",
  "keep-evidence": "Evidence review could not be saved.",
};

/**
 * Which blocker row is running, which last failed, and why.
 *
 * One derivation for the whole list, so the three presses cannot disagree about
 * what a settled refusal means -- which is the bug finding 1 named.
 */
export function blockerPressState(input: {
  accept: BlockerPressFacts;
  override: BlockerPressFacts;
  keepEvidence: BlockerPressFacts;
  /** Unit ZC: the zero-claims acknowledgement press. Optional for older callers. */
  acknowledge?: BlockerPressFacts;
}): BlockerPressState {
  const rows = [
    ["accept-unreviewed", input.accept],
    ["acknowledge-unchecked", input.acknowledge ?? IDLE_PRESS],
    ["override-outlet", input.override],
    ["keep-evidence", input.keepEvidence],
  ] as const;

  const busy = rows.find(([, facts]) => facts.isPending);
  /*
    A refusal outranks "in flight" only once its press has SETTLED. React Query
    keeps the previous answer on `data` while a new press runs, so an ungated
    read would paint the LAST refusal over THIS press's spinner.
  */
  const failed =
    rows.find(([, facts]) => facts.isError) ??
    rows.find(([, facts]) => !facts.isPending && refusedAnswer(facts.answer) !== null);

  let failureReason: string | null = null;
  if (failed) {
    const [kind, facts] = failed;
    failureReason = facts.isError
      ? (editorActionError(
          facts.error instanceof Error ? facts.error.message : "",
          BLOCKER_FAILED_LEAD[kind],
        ) ?? BLOCKER_FAILED_FALLBACK[kind])
      : refusedAnswer(facts.answer);
  }

  return {
    busyTarget: busy ? busy[0] : null,
    failedTarget: failed ? failed[0] : null,
    failureReason,
  };
}
