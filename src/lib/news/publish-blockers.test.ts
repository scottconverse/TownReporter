import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishBlockers,
  publishBlockedSummary,
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
