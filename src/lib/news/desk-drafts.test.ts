import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLISH_ALL_MAX,
  cleanPublishAllInput,
  publishAllRetryKeys,
  deskDraftAction,
  deskDraftElapsed,
  deskDraftFilterCounts,
  deskDraftMatchesFilter,
  deskDraftState,
  publishAllCandidates,
  publishAllNotice,
  publishAllQualifies,
  type DeskDraftFacts,
} from "./desk-drafts.ts";

const quiet: DeskDraftFacts = {
  job_status: null,
  job_stage: null,
  job_started_at: null,
  job_updated_at: null,
  evidence_required: false,
  evidence_decision: null,
  imported_text: false,
  names_unresolved: 0,
  has_body: true,
  headline: "Council delays the vote",
  model_headline: "Council delays the vote",
  headline_source: "model",
};

test("a plain draft with no memo is Ready in both its chip and its desk key", () => {
  const state = deskDraftState({ ...quiet, story_readiness: null });
  assert.equal(state.key, "ready");
  assert.equal(state.label, "✓ Ready");
});

test("a job still writing prints its own stage text and how long it has been at it", () => {
  const state = deskDraftState(
    { ...quiet, job_status: "running", job_stage: "Researching the editorial", job_started_at: "2026-09-26T10:00:00.000Z" },
    deskDraftElapsed("2026-09-26T10:00:00.000Z", Date.parse("2026-09-26T10:02:18.000Z")),
  );
  assert.equal(state.key, "running");
  assert.equal(state.label, "Writing · 2:18");
  assert.equal(state.running, true);
  assert.equal(deskDraftAction(state), "Watch");
});

test("a queued job with no stage yet still prints words, never an empty chip", () => {
  const state = deskDraftState({ ...quiet, job_status: "queued", job_stage: "" });
  assert.equal(state.key, "running");
  assert.equal(state.label, "Queued");
  assert.equal(deskDraftState({ ...quiet, job_status: "queued" }).label, "Queued");
});

test("a failed job outranks every other fact about the row", () => {
  // The row also has an unresolved name and unreviewed evidence; the editor
  // needs to know the writing stopped before either of those.
  const state = deskDraftState({
    ...quiet,
    job_status: "failed",
    names_unresolved: 2,
    evidence_required: true,
  });
  assert.equal(state.key, "failed");
  assert.equal(state.label, "Draft failed");
  assert.equal(state.needsYou, false, "a failure is its own state, not the Needs you filter");
  assert.equal(deskDraftAction(state), "Retry");
});

test("an unresolved name counts in words, singular and plural", () => {
  const one = deskDraftState({ ...quiet, names_unresolved: 1 });
  assert.equal(one.label, "! 1 name to review");
  assert.equal(one.needsYou, true);
  assert.equal(deskDraftState({ ...quiet, names_unresolved: 3 }).label, "! 3 names to review");
});

test("evidence to check is a state of its own, and a decision clears it", () => {
  const waiting = deskDraftState({ ...quiet, evidence_required: true });
  assert.equal(waiting.key, "evidence");
  assert.equal(waiting.label, "! Evidence to check");
  assert.equal(waiting.needsYou, true);
  const decided = deskDraftState({ ...quiet, evidence_required: true, evidence_decision: "keep" });
  assert.equal(decided.needsYou, false);
  assert.equal(decided.label, "Ready to check");
});

test("a name to review outranks evidence, because a person is named", () => {
  const state = deskDraftState({ ...quiet, names_unresolved: 1, evidence_required: true });
  assert.equal(state.key, "names");
});

test("an imported paste is its own draft, and never claims ready-to-check", () => {
  const state = deskDraftState({ ...quiet, imported_text: true });
  assert.equal(state.key, "imported");
  assert.equal(state.label, "Imported");
  assert.equal(deskDraftAction(state), "Continue");
});

test("a headline the editor wrote makes it their draft", () => {
  const renamed = deskDraftState({
    ...quiet,
    headline: "Council puts the vote off again",
    model_headline: "Council delays the vote",
    headline_source: "model",
  });
  assert.equal(renamed.key, "yours");
  assert.equal(renamed.label, "Your draft");
  assert.equal(renamed.yours, true);
  const flagged = deskDraftState({ ...quiet, headline_source: "editor" });
  assert.equal(flagged.yours, true);
  // A row from before 0.6.67 has no model headline and reads 'model', so the
  // desk must not claim the editor wrote it.
  assert.equal(
    deskDraftState({ ...quiet, model_headline: null, headline_source: "model" }).yours,
    false,
  );
});

test("a lead filed by hand has a draft row and no prose, so it never reads ready", () => {
  // `fileLead` writes the draft row with body = '' the moment the lead is
  // filed. Before this branch the row fell through to "Ready to check", so
  // Today counted it on the Publish step and in Tonight's edition while the
  // nav -- which counts leads whose status is `drafted` -- said zero.
  const filed = deskDraftState({ ...quiet, has_body: false });
  assert.equal(filed.key, "empty");
  assert.equal(filed.label, "No draft yet");
  assert.equal(filed.needsYou, false, "an unwritten lead is not the editor's to fix");
  assert.equal(filed.running, false);
  assert.equal(deskDraftAction(filed), "Start story");
  // A queued redraft still has the producer's empty placeholder body and no
  // readiness verdict until prose exists. The row chip must handle this shape.
  const queued = deskDraftState({
    ...quiet,
    has_body: false,
    story_readiness: {
      version: 1,
      state: "not-ready",
      openCount: 0,
      totalCount: 0,
      reason: "No draft has been written.",
    },
    job_status: "queued",
    job_stage: "Queued",
  });
  assert.equal(queued.key, "running");
  assert.equal(queued.label, "Queued");
  assert.equal(queued.readiness, undefined);
  assert.equal(
    deskDraftState({ ...quiet, has_body: false, job_status: "failed" }).key,
    "failed",
  );
});

test("the ready row does not promise publishability, which it cannot see", () => {
  const state = deskDraftState(quiet);
  assert.equal(state.key, "ready");
  assert.equal(state.label, "Ready to check");
  assert.equal(deskDraftAction(state), "Review");
});

test("elapsed time is printed the way the desk prints it", () => {
  const now = Date.parse("2026-09-26T10:00:52.000Z");
  assert.equal(deskDraftElapsed("2026-09-26T10:00:00.000Z", now), "0:52");
  assert.equal(deskDraftElapsed("2026-09-26T09:58:34.000Z", now), "2:18");
  assert.equal(deskDraftElapsed("2026-09-26T08:56:43.000Z", now), "1:04:09");
  // A clock that ran backwards, or a row with no start, prints no time rather
  // than a negative or a NaN on the screen.
  assert.equal(deskDraftElapsed("2026-09-26T10:05:00.000Z", now), "0:00");
  assert.equal(deskDraftElapsed(null, now), "");
  assert.equal(deskDraftElapsed("not a date", now), "");
});

test("filter counts overlap on purpose, and each one is what the filter shows", () => {
  const states = [
    deskDraftState({ ...quiet, job_status: "running" }),
    deskDraftState({ ...quiet, job_status: "failed" }),
    deskDraftState({ ...quiet, names_unresolved: 1 }),
    deskDraftState({ ...quiet, headline_source: "editor" }),
    deskDraftState(quiet),
    // An unwritten lead is on the list and in nothing else: it is work the
    // desk has not started, so it belongs to no filter that means "act now".
    deskDraftState({ ...quiet, has_body: false }),
  ];
  const counts = deskDraftFilterCounts(states);
  assert.deepEqual(counts, { all: 6, running: 1, "needs-you": 1, yours: 1, failed: 1 });
  for (const [filter, n] of Object.entries(counts)) {
    assert.equal(
      states.filter((s) => deskDraftMatchesFilter(s, filter as keyof typeof counts)).length,
      n,
      `the ${filter} count must equal what the ${filter} filter shows`,
    );
  }
});

test("accepted claims keep the drafts chip Ready with the explicit acceptance reason", () => {
  const story_readiness = { version: 1, state: "not-ready", openCount: 9, totalCount: 9, reason: "9 claims need review." };
  const state = deskDraftState({ ...quiet, story_readiness, unreviewed_claims: 9, unreviewed_claims_accepted_count: 9 });
  assert.equal(state.label, "✓ Ready");
  assert.equal(state.readiness?.reason, "You accepted 9 claims the AI could not confirm.");
  for (const count of [0, 8]) {
    const blocked = deskDraftState({ ...quiet, story_readiness, unreviewed_claims: 9, unreviewed_claims_accepted_count: count });
    assert.equal(blocked.readiness?.state, "not-ready");
  }
  const running = deskDraftState({ ...quiet, story_readiness, job_status: "running", unreviewed_claims: 9, unreviewed_claims_accepted_count: 9 });
  assert.equal(running.readiness?.state, "checking");
});

test("acceptance never promotes a held item's readiness, even with accepted claims", () => {
  const story_readiness = { version: 1, state: "not-ready", openCount: 9, totalCount: 9,
    reason: "Airport future charges: The future charge amount needs checking." };
  const state = deskDraftState({ ...quiet, story_readiness, unreviewed_claims: 9, unreviewed_claims_accepted_count: 9 });
  assert.equal(state.readiness?.state, "not-ready");
  assert.equal(state.readiness?.reason, story_readiness.reason);
});

// A legacy empty row cannot inherit Ready from an absent or stale memo.
test("empty drafts say No draft yet even with a Ready memo", () => {
  for (const memo of [
    null,
    { version: 1, state: "ready", openCount: 0, totalCount: 0, reason: "Ready to publish." },
  ]) {
    const state = deskDraftState({ ...quiet, has_body: false, story_readiness: memo });
    assert.equal(state.key, "empty");
    assert.equal(state.label, "No draft yet");
  }
  const running = deskDraftState({
    ...quiet,
    has_body: false,
    story_readiness: null,
    job_status: "running",
    job_stage: "Writing draft",
  });
  assert.equal(running.key, "running");
  assert.equal(running.label, "Writing");
});

/*
  FC24 (Oct 11 walk): Today's CHECK said 0 while the edition held a story with
  nine unreviewed claims and one marked Not checked yet.
*/
test("FC24: unreviewed claims and Not checked yet both wait on the editor", () => {
  const memo = { version: 1, state: "ready", openCount: 0, totalCount: 0, reason: "Ready to publish." };
  const claims = deskDraftState({ ...quiet, has_body: true, story_readiness: memo, unreviewed_claims: 9, unreviewed_claims_accepted_count: 0 } as never);
  assert.equal(claims.needsYou, true);
  const accepted = deskDraftState({ ...quiet, has_body: true, story_readiness: memo, unreviewed_claims: 9, unreviewed_claims_accepted_count: 9 } as never);
  assert.equal(accepted.needsYou, false);
  const notChecked = deskDraftState({ ...quiet, has_body: true, story_readiness: { ...memo, state: "not-checked", reason: "Not checked." } } as never);
  assert.equal(notChecked.needsYou, true);
});

/*
  feat-publish-all (Nov 15 2026): the two rules behind the Drafts screen's
  "Publish all drafts" button. Both are decisions, not lookups -- a state key
  wrongly included prints a story the editor had not finished, and a request
  cleaned wrongly prints the same story twice -- so both are pinned here,
  behaviour only, with no database and no source file read.
*/
test("publish all: ready, the editor's own, and finished needs-you drafts are in the batch", () => {
  const included = ["yours", "ready"] as const;
  const excluded = [
    "running",
    "failed",
    "imported",
    "empty",
  ] as const;
  for (const key of included) assert.equal(publishAllQualifies({ key }), true, key);
  for (const key of excluded) assert.equal(publishAllQualifies({ key }), false, key);

  // A "Needs you" draft with a finished body is in -- the owner's eight
  // "! Not checked yet" drafts were the ones the old rule hid the button for.
  for (const key of ["names", "evidence", "not-ready"] as const) {
    assert.equal(publishAllQualifies({ key, needsYou: true }), true, key);
    assert.equal(publishAllQualifies({ key, needsYou: false }), false, `${key} without a need`);
  }
  // A row the desk marks running or failed is never in, whatever its need.
  assert.equal(publishAllQualifies({ key: "not-ready", needsYou: true, running: true }), false);
  assert.equal(publishAllQualifies({ key: "not-ready", needsYou: true, failed: true }), false);
  assert.equal(publishAllQualifies({ key: "empty", needsYou: true }), false);
});

test("publish all: the candidate list keeps order and drops every other row", () => {
  const rows = [
    { lead_id: 1, headline: "Council vote", topic: "council" },
    { lead_id: 2, headline: "Still writing", topic: "schools" },
    { lead_id: 3, headline: "Empty row", topic: null },
    { lead_id: 4, headline: "Your draft", topic: "police" },
    { lead_id: 5, headline: "Name to review", topic: "council" },
    { lead_id: 6, headline: "Not checked yet", topic: "schools" },
  ];
  const states: Record<number, { key: string; needsYou: boolean; readiness?: { state: string; openCount: number; totalCount: number; reason: string } }> = {
    1: { key: "ready", needsYou: false },
    2: { key: "running", needsYou: false },
    3: { key: "empty", needsYou: false },
    4: { key: "yours", needsYou: false },
    5: { key: "names", needsYou: true },
    6: {
      key: "not-ready",
      needsYou: true,
      readiness: { state: "not-checked", openCount: 0, totalCount: 0, reason: "Nothing has checked this story." },
    },
  };
  const candidates = publishAllCandidates(rows, (row) => states[row.lead_id] as never);
  assert.deepEqual(
    candidates.map((c) => c.leadId),
    [1, 4, 5, 6],
  );
  assert.deepEqual(candidates[0], {
    leadId: 1,
    headline: "Council vote",
    topic: "council",
    warning: "",
    acknowledgedWarningKeys: [],
  });
  // The not-checked story is the one the dialog marks, and the one press
  // acknowledges the `unchecked` gate it stands for.
  assert.deepEqual(candidates[3], {
    leadId: 6,
    headline: "Not checked yet",
    topic: "schools",
    warning: "Not checked yet",
    acknowledgedWarningKeys: ["unchecked"],
  });
});

test("publish all: a notice names the warning and the key it acknowledges", () => {
  assert.deepEqual(publishAllNotice({ key: "not-ready", needsYou: true,
    readiness: { state: "not-checked", openCount: 0, totalCount: 0, reason: "" } }),
    { warning: "Not checked yet", acknowledgedWarningKeys: ["unchecked"] });
  assert.deepEqual(publishAllNotice({ key: "not-ready", needsYou: true,
    readiness: { state: "to-check", openCount: 3, totalCount: 5, reason: "3 facts need checking." } }),
    { warning: "! 3 to check", acknowledgedWarningKeys: ["readiness"] });
  assert.deepEqual(publishAllNotice({ key: "names", needsYou: true }),
    { warning: "Names to review", acknowledgedWarningKeys: [] });
  assert.deepEqual(publishAllNotice({ key: "evidence", needsYou: true }),
    { warning: "Evidence to check", acknowledgedWarningKeys: [] });
  // A ready story has nothing to warn about and nothing to acknowledge.
  assert.deepEqual(publishAllNotice({ key: "ready", needsYou: false }),
    { warning: "", acknowledgedWarningKeys: [] });
});

test("publish all: a request keeps the warning keys each item acknowledges", () => {
  assert.deepEqual(
    cleanPublishAllInput({
      items: [
        { leadId: 3, acknowledgedWarningKeys: ["unchecked", "unchecked", "", 7] },
        { leadId: 9 },
      ],
    }),
    {
      ok: true,
      items: [
        { leadId: 3, acknowledgedWarningKeys: ["unchecked"] },
        { leadId: 9 },
      ],
    },
  );
});

test("publish all: a request carries positive integers, at most 25, no duplicates", () => {
  assert.deepEqual(cleanPublishAllInput({ items: [{ leadId: 3 }, { leadId: 3 }, { leadId: 9, topic: " council " }] }), {
    ok: true,
    items: [{ leadId: 3 }, { leadId: 9, topic: "council" }],
  });

  // Exactly the ceiling is accepted; one more refuses.
  const atLimit = Array.from({ length: PUBLISH_ALL_MAX }, (_, i) => ({ leadId: i + 1 }));
  const accepted = cleanPublishAllInput({ items: atLimit });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.items.length, PUBLISH_ALL_MAX);
  assert.equal(
    cleanPublishAllInput({ items: [...atLimit, { leadId: PUBLISH_ALL_MAX + 1 }] }).ok,
    false,
  );

  // Everything that is not a positive integer refuses the whole request.
  for (const bad of [
    null,
    {},
    { items: [] },
    { items: "3" },
    { items: [{ leadId: 0 }] },
    { items: [{ leadId: -4 }] },
    { items: [{ leadId: 2.5 }] },
    { items: [{ leadId: "7" }] },
    { items: [{ leadId: 1 }, { leadId: null }] },
  ]) {
    assert.equal(cleanPublishAllInput(bad).ok, false, JSON.stringify(bad));
  }
});

test("acceptAllWarnings survives cleaning only as exactly true (Nov 17 2026)", () => {
  const on = cleanPublishAllInput({ acceptAllWarnings: true, items: [{ leadId: 4 }] });
  assert.equal(on.ok && on.acceptAllWarnings, true);
  for (const value of ["true", 1, false, null, undefined]) {
    const off = cleanPublishAllInput({ acceptAllWarnings: value, items: [{ leadId: 4 }] });
    assert.equal(off.ok && "acceptAllWarnings" in off, false, String(value));
  }
});

test("publishAllRetryKeys: retry adds the refused warning keys, never past a hard refusal", () => {
  assert.equal(publishAllRetryKeys([], { ok: true }), null);
  assert.equal(
    publishAllRetryKeys([], { ok: false, hard: "body", warnings: [{ key: "dek" }] }),
    null,
  );
  assert.deepEqual(
    publishAllRetryKeys(["unchecked"], {
      ok: false,
      warnings: [{ key: "unchecked" }, { key: "claims-unreviewed" }],
    }),
    ["unchecked", "claims-unreviewed"],
  );
  // Nothing new to add: a second try would only be refused again.
  assert.equal(publishAllRetryKeys(["dek"], { ok: false, warnings: [{ key: "dek" }] }), null);
  assert.equal(publishAllRetryKeys([], { ok: false }), null);
});
