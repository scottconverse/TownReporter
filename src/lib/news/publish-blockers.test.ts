import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishBlockers,
  publishBlockedSummary,
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
    assert.deepEqual(only?.action, { label: "Review open facts", target: { kind: "evidence-review" } });
  });

  /*
    Release 0.6.80 (unit CK) put a gate in `performPublish` that refuses a
    lead-bound draft with no dek. The server's own words are the sentence, so
    the editor reads the refusal before the press rather than after it -- and
    this test fails if the two drift apart.
  */
  it("says the server's own empty-dek refusal before the press, not after", () => {
    const [only] = publishBlockers(withState({ dek: "" }));
    assert.equal(only?.key, "dek");
    assert.deepEqual(only?.action, { label: "Write a dek", target: { kind: "dek" } });

    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const server = readFileSync(join(root, "lib", "news", "desk.ts"), "utf8");
    const gate = "Add a dek, the one-line summary under the headline, before you publish.";
    assert.ok(server.includes(gate), "the server gate this mirrors is gone; re-read desk.ts");
    assert.ok(
      (only?.sentence ?? "").includes(gate),
      "the row must say what the server will say when it refuses",
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

  it("names each transient gate that turns the button off while it runs", () => {
    assert.deepEqual(keys({ reconcileActive: true }), ["reconcile-running"]);
    assert.deepEqual(keys({ reviewingEvidence: true }), ["evidence-review-saving"]);
    assert.deepEqual(keys({ publishing: true }), ["publishing"]);
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
      "1 thing blocks Publish",
    );
    assert.equal(
      publishBlockedSummary(publishBlockers(withState({ sectionReady: false, dek: "" }))),
      "2 things block Publish",
    );
  });
});

describe("U24: a killed lead is not on its way anywhere", () => {
  /*
    The stand-in editorial day: a killed lead's Checks tab still carried
    "Before you can publish — 4 things block Publish" with four ENABLED buttons
    -- "Write the headline", "Write the story", "Write a dek", "Pick a section"
    -- while the editors, "Draft with AI" and the publish bar were all correctly
    gone. The action on a killed lead is Reopen, and that panel is on the page
    already; a countdown to a publish that cannot happen is the desk
    contradicting itself.
  */
  it("is the only status that hides the list", () => {
    assert.equal(showsPublishPrep("killed", true), false);
    for (const status of ["new", "drafted", "held", "published"]) {
      assert.equal(showsPublishPrep(status, true), true, `${status} leads still show their blockers`);
    }
  });

  /*
    FB6 item 8a (A2c-REPORT.md §6 C4). A story with no draft showed "4 things
    block Publish" with four enabled prep rows directly above the page's own
    "No draft yet". Nothing to prepare is not the same as nothing blocking a
    publish, and the countdown was for a press the editor cannot reach yet.
  */
  it("hides the list when there is no draft, whatever the status", () => {
    for (const status of ["new", "drafted", "held", "published"]) {
      assert.equal(
        showsPublishPrep(status, false),
        false,
        `${status} with no draft must not show publish-prep work`,
      );
    }
    assert.equal(showsPublishPrep("killed", false), false);
    assert.equal(showsPublishPrep("new", true), true, "the list returns with the first draft");
  });

  it("agrees with the server that a killed lead cannot print at all", () => {
    /* The list is work toward a press, so hiding it is right exactly when the
       press is refused. `performPublish` refuses this status by name. */
    const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
    assert.match(desk, /if \(lead\.status === "killed"\) \{[\s\S]{0,120}Killed leads cannot print\./);
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
