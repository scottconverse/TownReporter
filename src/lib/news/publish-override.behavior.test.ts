import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publishBlockers,
  publishConfirmation,
  showsPublishPrep,
  type PublishBlocker,
  type PublishBlockerState,
} from "./publish-blockers.ts";
import { acceptedClaimsPublishState } from "./story-readiness.ts";
import { cleanPublishRequest } from "./request-input.ts";

/**
 * ── THE EDITOR OVERRIDE, BY BEHAVIOUR (unit OH) ──────────────────────────────
 *
 * One place that states the whole contract the change is built on, in the terms a
 * press meets it, without reading a single source file:
 *
 *   - EVERY warning key leaves the confirm press ENABLED, listed, and labelled
 *     "Publish anyway in <section>"; the six hard keys turn it off.
 *   - with no warnings the label is the desk's own unchanged words.
 *   - a held or killed draft KEEPS its bar (the prep list and a live press).
 *   - a warning the SERVER returned on a refusal is shown on the stale tab, its
 *     sentence and key are the current ones, and it is what the retry will
 *     acknowledge -- the `acknowledgedWarningKeys` the route sends.
 *
 * `publishConfirmation` IS the route's decision (the route calls it with the
 * same merged list), so proving it here is proving what the button does; the
 * rendered-dialog proof sits next to the component, in
 * `src/components/publish-confirmation.test.ts`.
 */

const CLEAN: PublishBlockerState = {
  headline: "Council approves the budget",
  dek: "The 5-2 vote funds the pilot program.",
  body: "The council approved the budget on Tuesday night after a short debate.",
  sectionReady: true,
  openClaims: 0,
  namedOutlets: [],
  unreviewedClaims: 0,
  unreviewedAccepted: false,
  evidenceStale: false,
  reviewingEvidence: false,
  reconcileActive: false,
  publishing: false,
};

const withState = (patch: Partial<PublishBlockerState>) => publishBlockers({ ...CLEAN, ...patch });

const HARD_KEYS = [
  "headline",
  "body",
  "publishing",
  "reconcile-running",
  "evidence-review-saving",
  "lead-not-found",
] as const;

const WARNING_STATES: { key: string; patch: Partial<PublishBlockerState> }[] = [
  { key: "dek", patch: { dek: "" } },
  { key: "section", patch: { sectionReady: false } },
  { key: "outlet:Longmont Leader", patch: { namedOutlets: ["Longmont Leader"] } },
  { key: "claims", patch: { openClaims: 1 } },
  { key: "claims-unreviewed", patch: { unreviewedClaims: 3 } },
  { key: "evidence-stale", patch: { evidenceStale: true } },
  { key: "readiness", patch: { readiness: "not-ready", readinessReason: "Not ready." } },
  { key: "evidence-loading", patch: { evidenceLoading: true } },
  { key: "meeting-citation-stale", patch: { meetingCitationNotice: "The citation drifted." } },
  { key: "lead-held", patch: { leadStatus: "held" } },
  { key: "lead-killed", patch: { leadStatus: "killed" } },
];

const HARD_STATES: { key: string; patch: Partial<PublishBlockerState> }[] = [
  { key: "headline", patch: { headline: "" } },
  { key: "body", patch: { body: "" } },
  { key: "publishing", patch: { publishing: true } },
  { key: "reconcile-running", patch: { reconcileActive: true } },
  { key: "evidence-review-saving", patch: { reviewingEvidence: true } },
  { key: "lead-not-found", patch: { leadStatus: "missing" } },
];

describe("OH: the hard keys are exactly the six, and every other key is a warning", () => {
  it("classifies each hard key as hard and each warning key as warning", () => {
    for (const { key, patch } of HARD_STATES) {
      const row = withState(patch).find((blocker) => blocker.key === key);
      assert.ok(row, `${key} must be produced by its state`);
      assert.equal(row!.kind, "hard", `${key} is one of the six hard keys`);
    }
    for (const { key, patch } of WARNING_STATES) {
      const row = withState(patch).find((blocker) => blocker.key === key);
      assert.ok(row, `${key} must be produced by its state`);
      assert.equal(row!.kind, "warning", `${key} is a judgement, not a wall`);
      assert.ok(
        !(HARD_KEYS as readonly string[]).includes(key),
        `${key} must not be one of the six hard keys`,
      );
    }
  });

  it("keeps every warning key's name exactly as the contract spells it", () => {
    /* The keys the change must not rename: the five that predate it plus the
       three it adds, and the outlet key with its `outlet:<name>` shape. */
    assert.deepEqual(
      WARNING_STATES.map((state) => state.key),
      [
        "dek",
        "section",
        "outlet:Longmont Leader",
        "claims",
        "claims-unreviewed",
        "evidence-stale",
        "readiness",
        "evidence-loading",
        "meeting-citation-stale",
        "lead-held",
        "lead-killed",
      ],
    );
  });
});

describe("OH: EVERY warning key leaves the press on, listed and labelled", () => {
  for (const { key, patch } of WARNING_STATES) {
    it(`"${key}": enabled, listed, "Publish anyway in Council"`, () => {
      const decision = publishConfirmation(withState(patch), "Council");
      assert.equal(decision.enabled, true, `${key} must not disable the press`);
      assert.ok(
        decision.warnings.some((warning) => warning.key === key),
        `${key} must be listed among the warnings drawn`,
      );
      assert.equal(decision.confirmLabel, "Publish anyway in Council");
      assert.ok(
        decision.acknowledgedWarningKeys.includes(key),
        `${key} must be among the keys the retry acknowledges`,
      );
    });
  }
});

describe("OH: EVERY hard key turns the press off", () => {
  for (const { key, patch } of HARD_STATES) {
    it(`"${key}" disables the press`, () => {
      const decision = publishConfirmation(withState(patch), "Council");
      assert.equal(decision.enabled, false, `${key} is a hard stop`);
      assert.ok(
        !decision.warnings.some((warning) => warning.key === key),
        `${key} is not drawn as a sentence to accept`,
      );
      assert.ok(
        !decision.acknowledgedWarningKeys.includes(key),
        `${key} is never acknowledged -- it is not a warning`,
      );
    });
  }
});

describe("OH: a story with no warnings keeps the desk's own words", () => {
  it("labels the press exactly as before and enables it", () => {
    const decision = publishConfirmation(withState({}), "Council");
    assert.equal(decision.enabled, true);
    assert.deepEqual(decision.warnings, []);
    assert.deepEqual(decision.acknowledgedWarningKeys, []);
    assert.equal(decision.confirmLabel, "Yes, print it in Council");
  });
});

describe("OH: a held or killed draft keeps its bar and its press", () => {
  it("shows the prep list and a live press for both statuses", () => {
    assert.equal(
      showsPublishPrep("killed", true),
      true,
      "a killed draft with a draft still has work",
    );
    assert.equal(showsPublishPrep("held", true), true, "a held draft with a draft still has work");
    assert.equal(showsPublishPrep("killed", false), false, "no draft, no prep list");
    for (const status of ["held", "killed"]) {
      const decision = publishConfirmation(withState({ leadStatus: status }), "Council");
      assert.equal(decision.enabled, true, `${status} keeps the press live`);
      assert.equal(decision.confirmLabel, "Publish anyway in Council");
    }
  });
});

describe("OH: a stale tab sees the SERVER's warnings and acknowledges them on retry", () => {
  /*
    The route merges its own blockers with the warnings the server returned on a
    refusal, by key (the server wins for its own key), then runs
    `publishConfirmation` on the merged list. This models that merge and proves
    the two consequences: a warning this page never had is LISTED, and the retry
    sends exactly the keys shown -- a warning that arrives is not silently
    acknowledged, it is drawn and then acknowledged.
  */
  function merged(
    own: readonly PublishBlocker[],
    serverWarnings: readonly { key: string; sentence: string }[],
  ): PublishBlocker[] {
    const byKey = new Map(own.map((blocker) => [blocker.key, blocker] as const));
    for (const warning of serverWarnings) {
      byKey.set(warning.key, {
        key: warning.key,
        kind: "warning",
        sentence: warning.sentence,
        action: { label: "Review", target: { kind: "evidence-review" } },
      });
    }
    return [...byKey.values()];
  }

  it("lists a server warning the page did not know about and enables the press", () => {
    const own = withState({ sectionReady: false });
    const decision = publishConfirmation(
      merged(own, [{ key: "meeting-citation-stale", sentence: "The citation drifted." }]),
      "Council",
    );
    assert.equal(decision.enabled, true);
    assert.ok(decision.warnings.some((warning) => warning.key === "meeting-citation-stale"));
    assert.ok(decision.acknowledgedWarningKeys.includes("meeting-citation-stale"));
    assert.equal(decision.confirmLabel, "Publish anyway in Council");
  });

  it("takes the server's sentence for a key the page already lists, once", () => {
    const own = withState({ unreviewedClaims: 7 });
    const mergedBlockers = merged(own, [
      { key: "claims-unreviewed", sentence: "9 claims need review." },
    ]);
    const decision = publishConfirmation(mergedBlockers, "Council");
    const rows = decision.warnings.filter((warning) => warning.key === "claims-unreviewed");
    assert.equal(rows.length, 1, "the same reason said twice is one row");
    assert.equal(rows[0]!.sentence, "9 claims need review.", "the server's current count wins");
  });

  it("acknowledges only the warnings drawn -- a new one is not silently accepted", () => {
    /*
      The snapshot the route sends is `acknowledgedWarningKeys`. Here the editor
      saw the section warning and pressed; the server returned a SECOND warning.
      The next decision draws both, and the keys grow to BOTH -- the new warning
      was shown before it was acknowledged, never accepted unseen.
    */
    const first = publishConfirmation(merged(withState({ sectionReady: false }), []), "Council");
    assert.deepEqual(first.acknowledgedWarningKeys, ["section"], "only what was on screen");

    const second = publishConfirmation(
      merged(withState({ sectionReady: false }), [
        { key: "meeting-citation-stale", sentence: "The citation drifted." },
      ]),
      "Council",
    );
    assert.deepEqual(second.acknowledgedWarningKeys, ["section", "meeting-citation-stale"]);
  });
});

describe("OH: the readiness helper and the confirm decision agree about a warning", () => {
  it("reports not-ready but leaves the press on for a warning, off for a hard", () => {
    const warning: PublishBlocker = {
      key: "readiness",
      kind: "warning",
      sentence: "Not ready.",
      action: { label: "Review", target: { kind: "evidence-review" } },
    };
    const readiness = acceptedClaimsPublishState({
      blockers: [warning],
      openCount: 0,
      acceptedCount: 0,
      hasAiJudgments: true,
    });
    assert.equal(readiness.publishEnabled, true);
    assert.equal(readiness.readiness.state, "not-ready");
    assert.equal(publishConfirmation([warning], "Council").enabled, true);

    const hard: PublishBlocker = {
      key: "headline",
      kind: "hard",
      sentence: "The headline is empty.",
      action: { label: "Add a headline", target: { kind: "headline" } },
    };
    assert.equal(
      acceptedClaimsPublishState({
        blockers: [hard],
        openCount: 0,
        acceptedCount: 0,
        hasAiJudgments: false,
      }).publishEnabled,
      false,
    );
    assert.equal(publishConfirmation([hard], "Council").enabled, false);
  });
});

it("preserves exact acknowledged keys, including long named outlets, at the RPC boundary", () => {
  const key = `outlet:${'A "quoted" outlet '.repeat(50)}`;
  assert.deepEqual(
    cleanPublishRequest({ leadId: 42, acknowledgedWarningKeys: [key, key, "dek", null, ""] }),
    { leadId: 42, acknowledgedWarningKeys: [key, "dek"] },
  );
});
