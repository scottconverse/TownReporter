import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceRecordedFor,
  oldDraftSentence,
  publishBlockers,
  publishBlockedSummary,
  publishConfirmation,
  publishGateNote,
  showsPublishPrep,
  type PublishBlockerState,
} from "./publish-blockers.ts";

/**
 * One test per reason Publish is off (unit CT, 0.6.81).
 *
 * The point of these is not that the function returns a string. It is that
 * every rule the publish button disables on lives here, so a rule cannot be
 * added to the button and forgotten by the sentence -- which is exactly how
 * the owner's story ended up with `evidenceStale` and a running reconcile
 * turning the button grey with nothing said.
 */

/** A draft with nothing wrong: every gate satisfied, nothing in flight. */
const CLEAN: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  openClaims: 0,
  namedOutlets: [],
  /* Unit U24: the evidence check found nothing to judge, or everything it
     found has been judged, and nobody has had to accept anything. */
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

function withState(patch: Partial<PublishBlockerState>): PublishBlockerState {
  return { ...CLEAN, ...patch };
}

const keys = (patch: Partial<PublishBlockerState>) =>
  publishBlockers(withState(patch)).map((b) => b.key);

describe("publishBlockers", () => {
  it("returns nothing when nothing blocks Publish", () => {
    assert.deepEqual(publishBlockers(CLEAN), []);
    assert.equal(publishBlockedSummary(publishBlockers(CLEAN)), "");
  });

  it("names an empty headline and offers the headline field", () => {
    const [only] = publishBlockers(withState({ headline: "" }));
    assert.equal(only?.key, "headline");
    assert.match(only?.sentence ?? "", /headline is empty/i);
    assert.deepEqual(only?.action, {
      label: "Write the headline",
      target: { kind: "headline" },
    });
  });

  it("names an empty body and offers the story field", () => {
    const [only] = publishBlockers(withState({ body: "   \n " }));
    assert.equal(only?.key, "body");
    assert.match(only?.sentence ?? "", /body is empty/i);
    assert.deepEqual(only?.action, { label: "Write the story", target: { kind: "body" } });
  });

  // guards: an AI-marked not-ready story could reach the Publish button as if its facts were settled.
  it("blocks a story the AI marked not ready", () => {
    const [only] = publishBlockers(withState({ readiness: "not-ready", readinessReason: "Four facts remain open." }));
    assert.equal(only?.key, "readiness");
    assert.equal(only?.sentence, "Four facts remain open.");
    assert.deepEqual(only?.action.target, { kind: "evidence-review" });
  });

  /*
    Release 0.6.80 (unit CK) put a gate in `performPublish` that refuses a
    lead-bound draft with no dek. The server's own words are the sentence, so
    the editor reads the refusal before the press rather than after it -- and
    this test fails if the two drift apart.
  */
  it("says a missing dek in plain words, without claiming the desk refuses it", () => {
    const [only] = publishBlockers(withState({ dek: "" }));
    assert.equal(only?.key, "dek");
    assert.deepEqual(only?.action, { label: "Write a dek", target: { kind: "dek" } });
    /*
      Unit OH: a dek is now a WARNING, not a wall. The old sentence borrowed
      `performPublish`'s refusal verbatim -- "The desk refuses a story with no
      dek" -- which was true when every blocker disabled the button and is a lie
      now that the editor may print through without one. The row says what is
      missing, and the confirm dialog names the section the editor is printing
      under; nothing here claims a refusal the desk no longer makes.
    */
    assert.equal(only?.kind, "warning");
    assert.match(only?.sentence ?? "", /dek/i);
    assert.doesNotMatch(
      only?.sentence ?? "",
      /refuse/i,
      "a warning must not say the desk refuses it",
    );
  });

  it("names an unchosen section and offers the select", () => {
    const [only] = publishBlockers(withState({ sectionReady: false }));
    assert.equal(only?.key, "section");
    assert.match(only?.sentence ?? "", /No section has been chosen/);
    assert.deepEqual(only?.action, {
      label: "Pick a section",
      target: { kind: "section" },
    });
  });

  it("gives each named outlet its own row, its own override, and the way to add a source", () => {
    const blockers = publishBlockers(
      withState({ namedOutlets: ["Longmont Leader", "The Denver Post"] }),
    );
    assert.equal(blockers.length, 2, "one row per outlet, so each button clears one name");
    assert.deepEqual(
      blockers.map((b) => b.key),
      ["outlet:Longmont Leader", "outlet:The Denver Post"],
    );

    const [first] = blockers;
    assert.equal(
      first?.sentence,
      "The body names Longmont Leader and this draft's Sources do not show it.",
    );
    assert.deepEqual(first?.action, {
      label: "Override Longmont Leader",
      target: { kind: "override-outlet", outlet: "Longmont Leader" },
    });
    assert.deepEqual(first?.altAction, {
      label: "Add a source",
      target: { kind: "add-source" },
    });
  });

  it("skips a blank outlet rather than printing an empty name", () => {
    assert.deepEqual(publishBlockers(withState({ namedOutlets: ["  "] })), []);
  });

  it("counts unconfirmed claims of absence, in the singular and the plural", () => {
    const [one] = publishBlockers(withState({ openClaims: 1 }));
    assert.equal(one?.key, "claims");
    assert.equal(one?.sentence, "A claim of absence has not been confirmed.");
    assert.equal(one?.action.label, "Confirm the claim");
    assert.deepEqual(one?.action.target, { kind: "claims" });

    const [many] = publishBlockers(withState({ openClaims: 3 }));
    assert.equal(many?.sentence, "3 claims of absence have not been confirmed.");
    assert.equal(many?.action.label, "Confirm the claims");
  });

  it("names stale evidence and offers the keep press the review panel calls", () => {
    const [only] = publishBlockers(withState({ evidenceStale: true }));
    assert.equal(only?.key, "evidence-stale");
    assert.match(only?.sentence ?? "", /changed after its evidence was checked/);
    assert.deepEqual(only?.action, {
      label: "I checked: keep this evidence",
      target: { kind: "keep-evidence" },
    });
    assert.deepEqual(only?.altAction, {
      label: "See the evidence review",
      target: { kind: "evidence-review" },
    });
  });

  it("names each transient gate while it runs", () => {
    assert.deepEqual(keys({ reconcileActive: true }), ["reconcile-running"]);
    assert.deepEqual(keys({ reviewingEvidence: true }), ["evidence-review-saving"]);
    assert.deepEqual(keys({ publishing: true }), ["publishing"]);
  });

  /*
    ENG-2: a running evidence check is a warning, so its row offers the same
    "Publish anyway" press as every other warning, with "See the running check"
    as the second press. The confirm stays live and asks for the acknowledgement.
  */
  it("offers Publish anyway over a running evidence check, and the check as the second press", () => {
    const blockers = publishBlockers(withState({ reconcileActive: true, sectionName: "Council" }));
    assert.deepEqual(blockers.map((b) => b.key), ["reconcile-running"]);
    const [row] = blockers;
    assert.equal(row?.kind, "warning");
    assert.equal(
      row?.sentence,
      "An evidence check is running on this draft. Its answer is not in yet. Publish anyway prints it before that answer comes in.",
    );
    assert.deepEqual(row?.action, { label: "Publish anyway in Council", target: { kind: "publish-now" } });
    assert.deepEqual(row?.altAction, { label: "See the running check", target: { kind: "running-check" } });
    const decision = publishConfirmation(blockers, "Council");
    assert.equal(decision.enabled, true, "a running check does not turn the press off");
    assert.deepEqual(decision.acknowledgedWarningKeys, ["reconcile-running"]);
  });

  /*
    The order is the order the editor meets the work: the story's own text,
    then the section, then the names in it, then the desk's gates, then the
    three that clear themselves. The owner's story -- one named outlet, one
    claim, no section -- must read section, outlet, claim.
  */
  it("orders the owner's own story the way the work is done", () => {
    const blockers = publishBlockers(
      withState({
        sectionReady: false,
        namedOutlets: ["Longmont Leader"],
        openClaims: 1,
      }),
    );
    assert.deepEqual(
      blockers.map((b) => b.key),
      ["section", "outlet:Longmont Leader", "claims"],
    );
  });

  it("lists every reason at once, not the first one only", () => {
    const blockers = publishBlockers(
      withState({
        headline: "",
        dek: "",
        body: "",
        sectionReady: false,
        openClaims: 2,
        namedOutlets: ["Longmont Leader"],
        unreviewedClaims: 7,
        evidenceStale: true,
        reviewingEvidence: true,
        reconcileActive: true,
        publishing: true,
      }),
    );
    assert.deepEqual(
      blockers.map((b) => b.key),
      [
        "headline",
        "body",
        "dek",
        "section",
        "outlet:Longmont Leader",
        "claims",
        "claims-unreviewed",
        "evidence-stale",
        "reconcile-running",
        "evidence-review-saving",
        "publishing",
      ],
    );
  });

  it("gives every row a sentence and a press that goes somewhere", () => {
    const blockers = publishBlockers(
      withState({
        headline: "",
        dek: "",
        body: "",
        sectionReady: false,
        openClaims: 1,
        namedOutlets: ["Longmont Leader", "The Denver Post"],
        evidenceStale: true,
        reviewingEvidence: true,
        reconcileActive: true,
        publishing: true,
      }),
    );
    for (const b of blockers) {
      assert.ok(b.key.length > 0, "a row needs a key");
      assert.match(b.sentence, /[.!?]["']?$/, `"${b.sentence}" is not a sentence`);
      assert.ok(b.action.label.length > 0, `${b.key} is a dead end with no button`);
      assert.ok(
        "kind" in b.action.target,
        `${b.key}'s button does not say where it goes`,
      );
      if (b.altAction) assert.ok(b.altAction.label.length > 0, `${b.key}'s second press has no label`);
    }
  });

  it("counts blockers for the bottom bar, in words", () => {
    assert.equal(publishBlockedSummary([]), "");
    assert.equal(
      publishBlockedSummary(publishBlockers(withState({ sectionReady: false }))),
      "1 warning before Publish",
    );
    assert.equal(
      publishBlockedSummary(publishBlockers(withState({ sectionReady: false, dek: "" }))),
      "2 warnings before Publish",
    );
  });
});

describe("U24: a killed lead is not on its way anywhere", () => {
  /*
    The stand-in editorial day: a killed lead's Checks tab still carried
    "Before you can publish — 4 things block Publish" with four ENABLED buttons
    -- "Write the headline", "Write the story", "Write a dek", "Pick a section"
    -- while the editors, "Draft with AI" and the whole publish bar were all
    correctly gone.

    ── WHAT CHANGED, AND WHY (unit OH) ──────────────────────────────────────
    The old rule was "a killed lead shows no list", and it was right for a page
    where killing a lead removed the publish bar: a countdown to a press the
    editor cannot make is the desk contradicting itself. The owner changed the
    rule on purpose. A KILLED OR HELD DRAFT NOW KEEPS ITS PUBLISH BAR, and the
    way back is one press -- un-kill (or un-hold) and publish in the same press.
    A list of reasons over a bar that exists is the work, not a dead end; the
    list is hidden only when there is no draft to prepare, whatever the status.
  */
  it("keeps the list on a killed or held draft, and hides it only with no draft", () => {
    for (const status of ["new", "drafted", "held", "killed"]) {
      assert.equal(showsPublishPrep(status, true), true, `${status} with a draft shows the work`);
      assert.equal(
        showsPublishPrep(status, false),
        false,
        `${status} with no draft must not show publish-prep work`,
      );
    }
  });

  it("hides the list on a published story, which has nothing left to publish (DHE2-1)", () => {
    /*
      Walk E2, DHE2-1: a published lead's Story page still said "No section has
      been chosen for this story. Pick a section" and "Before you can publish 3
      warnings". The story is already in print, so a countdown to a press that
      cannot happen again is the desk contradicting itself.
    */
    assert.equal(showsPublishPrep("published", true), false, "a published story with a draft shows no prep list");
    assert.equal(showsPublishPrep("published", false), false, "a published story with no draft shows no prep list");
  });

  it("gives a killed or held draft a warning that names the one press, not a silent absence", () => {
    /*
      Unit OH: a killed or held draft keeps its bar, and the way back is ONE
      press -- un-kill (or un-hold) and publish in the same press -- which the
      server performs inside the publish transaction. The proof is behavioural:
      the page state produces a WARNING whose sentence names that single press,
      and a warning never disables the button (see `publishConfirmation`). What
      the server does with the status is the server's own test's business, not a
      string in a file read here.
    */
    for (const status of ["held", "killed"]) {
      const blockers = publishBlockers(withState({ leadStatus: status }));
      const row = blockers.find((blocker) => blocker.key === `lead-${status}`);
      assert.ok(row, `${status} produces its own lead-${status} warning`);
      assert.equal(
        row!.kind,
        "warning",
        `${status} is a judgement an editor overrules, not a hard stop`,
      );
      assert.match(
        row!.sentence,
        /(un-hold|restore)/,
        "the sentence names what the one press does",
      );
      assert.match(row!.sentence, /publish/i, "and that it publishes in the same press");
      assert.deepEqual(
        blockers.filter((blocker) => blocker.kind !== "warning"),
        [],
        `${status} adds no hard reason, so the press stays live`,
      );
    }
  });
});

describe("U24: claims the evidence check raised and nobody judged", () => {
  /*
    The stand-in editorial day: seven claims chipped `! Needs review` on the
    Checks pane, and a story that printed without one word about them. This is
    the row that stops that, and the two presses that are its honest answers.
  */
  it("blocks, in the pane's own count, and offers both answers", () => {
    const [only] = publishBlockers(withState({ unreviewedClaims: 7 }));
    assert.equal(only?.key, "claims-unreviewed");
    assert.match(only?.sentence ?? "", /^7 claims need review\./);
    assert.deepEqual(only?.action, {
      label: "Review the claims",
      target: { kind: "evidence-review" },
    });
    assert.deepEqual(only?.altAction, {
      label: "Publish anyway — I accept these claims are unreviewed",
      target: { kind: "accept-unreviewed" },
    });
  });

  it("says one claim, not one claims", () => {
    const [only] = publishBlockers(withState({ unreviewedClaims: 1 }));
    assert.match(only?.sentence ?? "", /^1 claim needs review\./);
  });

  it("is the first reason the sticky bar names, because it is the first row of the list", () => {
    assert.equal(publishGateNote(publishBlockers(withState({ unreviewedClaims: 3 }))), "Review the claims to publish.");
  });

  it("stands down once the editor has accepted them for this draft version", () => {
    assert.deepEqual(
      publishBlockers(withState({ unreviewedClaims: 7, unreviewedAccepted: true })),
      [],
      "an accepted draft has no reason left on this row",
    );
  });

  it("does not fire for a draft whose claims were all judged, or that raised none", () => {
    assert.deepEqual(publishBlockers(withState({ unreviewedClaims: 0 })), []);
  });

  /*
    M5 of the batch-6 pre-merge audit. `claimsNeedingReview` counts a claim the
    record CONTRADICTS with the claims nobody has got to, which is right for the
    head count and silent about the part that matters: the record says the story
    is wrong. The count now carries it, and so does the override -- nobody
    presses "Publish anyway" without being told what they are accepting.

    THE MUTATION THAT MATTERS. Passing `contradictedClaims` but not wiring it
    into the sentence or the alt action fails both cases below.
  */
  it("says how many of them the record contradicts", () => {
    const [only] = publishBlockers(
      withState({ unreviewedClaims: 7, contradictedClaims: 3 }),
    );
    assert.match(only?.sentence ?? "", /^7 claims need review \(3 contradicted by the record\)\./);
    assert.match(only?.sentence ?? "", /the record contradicts 3 of them/);
    assert.deepEqual(only?.altAction, {
      label: "Publish anyway — I accept these claims, including 3 the record contradicts",
      target: { kind: "accept-unreviewed" },
    });
  });

  it("says it for one claim too, without the plural", () => {
    const [only] = publishBlockers(withState({ unreviewedClaims: 1, contradictedClaims: 1 }));
    assert.match(only?.sentence ?? "", /^1 claim needs review \(1 contradicted by the record\)\./);
    assert.match(only?.sentence ?? "", /the record contradicts it/);
    assert.match(only?.altAction?.label ?? "", /including 1 the record contradicts/);
  });

  it("keeps the old wording when nothing is contradicted", () => {
    const [only] = publishBlockers(
      withState({ unreviewedClaims: 7, contradictedClaims: 0 }),
    );
    assert.equal(
      only?.sentence,
      "7 claims need review. The evidence check raised them and no one has judged them against the record.",
    );
    assert.equal(only?.altAction?.label, "Publish anyway — I accept these claims are unreviewed");
  });

  it("never lets the contradicted count outrun the head count", () => {
    const [only] = publishBlockers(
      withState({ unreviewedClaims: 2, contradictedClaims: 9 }),
    );
    assert.match(only?.sentence ?? "", /^2 claims need review \(2 contradicted by the record\)\./);
  });
});

// guards: DHC05 -- the killed-lead card names the button it presses, and says what that press does before the press.
it("a killed lead's warning names the Publish anyway button and says the press publishes the draft", () => {
  const row = publishBlockers(withState({ leadStatus: "killed" })).find((blocker) => blocker.key === "lead-killed");
  assert.ok(row, "a killed lead produces its warning");
  assert.equal(row!.action?.label, "Publish anyway");
  assert.match(row!.sentence, /Publish anyway/, "the sentence names the button the editor presses");
  assert.match(row!.sentence, /publishes this draft/, "the sentence says the press publishes");
});

// guards: DHD2-2 -- the held and killed cards' "Publish anyway" press publishes on its first press, so its target is the publish-now press, not a scroll to the bar.
it("the killed and held cards' Publish anyway press publishes now rather than scrolling to the bar", () => {
  for (const leadStatus of ["killed", "held"]) {
    const row = publishBlockers(withState({ leadStatus })).find((blocker) => blocker.action?.label === "Publish anyway");
    assert.ok(row, `a ${leadStatus} lead's card has a Publish anyway press`);
    assert.deepEqual(row!.action?.target, { kind: "publish-now" }, `${leadStatus}: the press must publish, not only point at the bar`);
  }
});

/*
  TNB-6 (Oct 16, walk N-2 lead 466): the publish bar said "No claims were
  recorded for this story, so nothing has been checked" AND "The story changed
  after its evidence was checked, so the check no longer covers this text" --
  two warnings that cannot both be true. Both stay (each is true on its own);
  the stale one is worded so it does not say a check existed for this text.
*/
describe("TNB-6: the publish bar's two warnings agree", () => {
  it("when nothing was checked, the changed-story warning does not say a check went stale", () => {
    const blockers = publishBlockers(withState({ uncheckedStory: true, evidenceStale: true }));
    const unchecked = blockers.find((b) => b.key === "unchecked");
    const stale = blockers.find((b) => b.key === "evidence-stale");
    assert.ok(unchecked, "the unchecked warning still shows");
    assert.ok(stale, "the changed-story warning still shows: the text did change");
    assert.match(unchecked!.sentence, /nothing has been checked/);
    assert.doesNotMatch(
      stale!.sentence,
      /the check no longer covers/,
      "'nothing has been checked' and 'the check no longer covers this text' cannot both be true",
    );
    assert.match(stale!.sentence, /changed after its evidence was gathered/);
    assert.deepEqual(stale!.action, { label: "I checked: keep this evidence", target: { kind: "keep-evidence" } });
  });

  it("a story with checked claims keeps the changed-story wording it always had", () => {
    const [stale] = publishBlockers(withState({ evidenceStale: true }));
    assert.match(stale!.sentence, /changed after its evidence was checked, so the check no longer covers this text/);
  });
});

/*
  TPW-2 (Oct 16, walk publish-truth-4): a draft last written weeks ago still prints
  its own time words ("Saturday", "two days out") under today's date. The desk warns
  once and never blocks: the editor may read the warning and print anyway.
*/
describe("TPW-2: an old draft draws one warning and never blocks Publish", () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it("says when the draft was written, how many days ago, and what to check", () => {
    const old = publishBlockers(withState({ draftWrittenAt: daysAgo(30) })).filter((b) => b.key === "draft-old");
    assert.equal(old.length, 1, "one warning, not one per check");
    assert.equal(old[0]!.kind, "warning");
    assert.match(
      old[0]!.sentence,
      /^This draft was last written [A-Z][a-z]{2} \d{1,2} \(30 days ago\)\. Check any words about dates and times, such as "Saturday" or "two days out", before you publish\.$/,
    );
  });

  it("stays quiet for a draft written within 14 days, and for a draft with no date", () => {
    assert.equal(keys({ draftWrittenAt: daysAgo(14) }).includes("draft-old"), false);
    assert.equal(keys({ draftWrittenAt: null }).includes("draft-old"), false);
    assert.equal(keys({}).includes("draft-old"), false);
  });

  it("leaves the press on and keeps Publish anyway, so an old draft can still be printed", () => {
    const decision = publishConfirmation(publishBlockers(withState({ draftWrittenAt: daysAgo(30) })), "Council");
    assert.equal(decision.enabled, true);
    assert.equal(decision.confirmLabel, "Publish anyway in Council");
    assert.ok(decision.acknowledgedWarningKeys.includes("draft-old"));
  });
});

describe("TPW-2: the server's warning uses the same day count and the same words", () => {
  const now = new Date("2026-10-16T12:00:00-06:00");
  const daysBefore = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("is silent through 14 days and speaks from 15 days", () => {
    assert.equal(oldDraftSentence(daysBefore(14), now), null);
    assert.match(oldDraftSentence(daysBefore(15), now)!, /\(15 days ago\)/);
  });

  it("is silent for a missing or unreadable date", () => {
    assert.equal(oldDraftSentence(null, now), null);
    assert.equal(oldDraftSentence("not a date", now), null);
  });
});

/*
  TPU-4 (Oct 16, walk publish-truth-2): the editor's "I accept these claims are
  unreviewed" was remembered only on the page, so a reload lost it. The server
  returns the recorded count on every load; this decides whether that count still
  covers the claims open now.
*/
describe("TPU-4: a recorded acceptance is known again after a reload", () => {
  it("counts the acceptance once it covers every claim still open", () => {
    assert.equal(acceptanceRecordedFor(3, 3), true);
  });

  it("does not count it once a claim is open that the acceptance did not cover", () => {
    assert.equal(acceptanceRecordedFor(3, 4), false);
  });

  it("does not count it when nothing is open, or nothing was accepted", () => {
    assert.equal(acceptanceRecordedFor(3, 0), false);
    assert.equal(acceptanceRecordedFor(0, 2), false);
  });
});

/*
  MS-WIRE W3: the meeting writer ends its work with the items a person must
  check before the story prints. They are a warning with a "Publish anyway"
  path, the same shape `meeting-citation-stale` has.
*/
describe("MS-WIRE: the meeting writer's check list", () => {
  it("warns once for two items and names both", () => {
    const rows = publishBlockers(
      withState({
        meetingEditorChecks: ["Check the 6-1 tally.", "The parking figure is read off a slide."],
      }),
    ).filter((blocker) => blocker.key === "meeting-editor-checks");
    assert.equal(rows.length, 1, "one warning, not one per item");
    assert.equal(rows[0]!.kind, "warning");
    assert.match(
      rows[0]!.sentence,
      /^The meeting writer asks you to check 2 things before publishing: 1\. Check the 6-1 tally\. 2\. The parking figure is read off a slide\.$/,
    );
  });

  it("says \"The writer\", not \"The meeting writer\", on a news-skill draft (D235)", () => {
    const rows = publishBlockers(
      withState({
        meetingEditorChecks: ["Check the 6-1 tally.", "The parking figure is read off a slide."],
        meetingEditorChecksFromNewsWriter: true,
      }),
    ).filter((blocker) => blocker.key === "meeting-editor-checks");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "warning");
    assert.match(
      rows[0]!.sentence,
      /^The writer asks you to check 2 things before publishing: 1\. Check the 6-1 tally\. 2\. The parking figure is read off a slide\.$/,
    );
  });

  it("says nothing for an empty list", () => {
    assert.deepEqual(keys({ meetingEditorChecks: [] }), []);
    assert.deepEqual(keys({ meetingEditorChecks: undefined }), []);
  });

  it("keeps Publish on with Publish anyway, and the acknowledgement carries the key", () => {
    const decision = publishConfirmation(
      publishBlockers(withState({ meetingEditorChecks: ["Check the 6-1 tally."] })),
      "Council",
    );
    assert.equal(decision.enabled, true);
    assert.equal(decision.confirmLabel, "Publish anyway in Council");
    assert.ok(decision.acknowledgedWarningKeys.includes("meeting-editor-checks"));
  });
});
