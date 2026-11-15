/**
 * What one row on the desk's Drafts screen says about itself.
 *
 * The screen is a list of the drafts not yet printed (redesign phase 2a,
 * README "4. Drafts"), and every row carries a state in words: "Writing · 2:18",
 * "! 1 name to review", "Draft failed", "Your draft". The handoff draws that
 * state, so it is a design decision with a failure mode, not a lookup -- the
 * order the facts are read in decides which of two true things a row claims,
 * and a wrong word here tells an editor a story is further along than it is.
 *
 * WHY HERE AND NOT IN THE ROUTE. `src/lib/news/desk.ts` opens a database at
 * import time and cannot be loaded by `node --experimental-strip-types`, so a
 * rule living beside its server function is only ever tested through a running
 * server. These are pure decisions over plain values -- the same split
 * `headline-control.ts` and `draft-evidence.ts` already use.
 */
import { editorOwnsHeadline } from "./headline-control.ts";
import { readinessWithAcceptedClaims, savedStoryReadiness, storyReadinessChip, type StoryReadiness } from "./story-readiness.ts";

/** The facts about one draft that decide its state, as the query returns them. */
export type DeskDraftFacts = {
  story_readiness?: unknown;
  unreviewed_claims?: number;
  unreviewed_claims_accepted_count?: number;
  /** The newest `desk_jobs` row for this lead, if there is one. */
  job_status: string | null;
  job_stage: string | null;
  job_started_at: string | null;
  job_updated_at: string | null;
  /** `drafts.research_json.evidenceReview` -- see `draft-evidence.ts`. */
  evidence_required: boolean;
  evidence_decision: string | null;
  /** `drafts.research_json.importedText` -- an editor's paste, not model prose. */
  imported_text: boolean;
  /** Rows in `drafts.research_json.nameCheck.rows` whose status is "unresolved". */
  names_unresolved: number;
  /**
   * Does this draft row hold any prose at all?
   *
   * Every lead filed by hand gets a draft row with an empty body (`fileLead` ->
   * `insertLeadWithDraft`), so "the lead exists" and "the story is written" are
   * different facts and this is the one that tells them apart.
   */
  has_body: boolean;
  /** `headline_source` / `model_headline`, read by `editorOwnsHeadline`. */
  headline: string | null;
  model_headline: string | null;
  headline_source: string | null;
};

export type DeskDraftStateKey =
  | "running"
  | "failed"
  | "names"
  | "evidence"
  | "imported"
  | "empty"
  | "not-ready"
  | "yours"
  | "ready";

export type DeskDraftState = {
  readiness?: StoryReadiness;
  key: DeskDraftStateKey;
  /** The state, in words, exactly as the row prints it. */
  label: string;
  /** Is this draft one the editor has to do something about? */
  needsYou: boolean;
  /** Is a job working on it right now? */
  running: boolean;
  /** Did a job fail on it? */
  failed: boolean;
  /** Did the editor write the headline on this row, rather than the model? */
  yours: boolean;
};

/**
 * A duration as the desk prints it: `2:18`, `0:52`, `1:04:09`.
 *
 * The clock is passed in rather than read here so a test can pin it and every
 * row on one render measures its elapsed time against the same `now`.
 */
export function deskDraftElapsed(fromIso: string | null | undefined, nowMs: number): string {
  if (!fromIso) return "";
  const at = Date.parse(fromIso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - at) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  if (mins < 60) return `${mins}:${secs}`;
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}:${secs}`;
}

/**
 * The state of one draft, in the order the facts are read.
 *
 * THE ORDER IS THE RULE, and it runs newest fact first:
 *
 *   1. A job that failed says so. Nothing else about the row is worth reading
 *      until the editor knows the writing stopped.
 *   2. A job still working says so, with its own stage text -- the desk's
 *      stages are already editor-facing prose ("Researching the editorial"),
 *      so this row quotes the job rather than inventing a second vocabulary
 *      for the same thing -- and how long it has been at it. A queued job has
 *      no `started_at` yet; its clock runs from the queue write.
 *   3. A name the check could not resolve, then evidence that has not been
 *      reviewed, are the two gates that stop this draft being printable, and
 *      they are what "Needs you" means on the filter row.
 *   4. Failing all that: is there any prose at all, and if there is, whose
 *      draft it is.
 *
 * `elapsed` is preformatted by `deskDraftElapsed` so every row measures against
 * one clock; pass "" to print the state without a time.
 */
export function deskDraftState(facts: DeskDraftFacts, elapsed = ""): DeskDraftState {
  const job = String(facts.job_status ?? "");
  const running = job === "running" || job === "queued";
  const failed = job === "failed" || job === "cancelled";
  const yours = editorOwnsHeadline(facts);
  const unresolved = Math.max(0, Number(facts.names_unresolved) || 0);
  const base = { needsYou: false, running, failed, yours };
  if (running) {
    const label = job === "queued" ? "Queued" : "Writing";
    return { ...base, key: "running", label: elapsed ? `${label} · ${elapsed}` : label,
      readiness: !facts.has_body || facts.story_readiness === undefined ? undefined : savedStoryReadiness(facts.story_readiness, true) };
  }

  // A filed empty row is still waiting for its first draft, regardless of its memo.
  if (!facts.has_body) {
    if (failed) return { ...base, key: "failed", label: "Draft failed" };
    if (running) {
      const stage = String(facts.job_stage ?? "").trim() || "Working…";
      return { ...base, key: "running", label: elapsed ? `${stage} · ${elapsed}` : stage };
    }
    return { ...base, key: "empty", label: "No draft yet" };
  }

  if (facts.story_readiness !== undefined) {
    const readiness = readinessWithAcceptedClaims(savedStoryReadiness(facts.story_readiness, running), facts.unreviewed_claims ?? 0, facts.unreviewed_claims_accepted_count ?? 0);
    const key = running ? "running" : failed ? "failed" : (readiness.state === "ready" || readiness.state === "verified") ? "ready" : readiness.state === "to-check" ? "evidence" : facts.has_body ? "not-ready" : "empty";
    /*
      FC24 (Oct 11 walk): Today's CHECK said 0 while the edition held a story
      with nine unreviewed claims and one marked Not checked yet. Both wait on
      the editor, so both count.
    */
    const outstanding = Math.max(0, Number(facts.unreviewed_claims) || 0);
    const accepted = Math.max(0, Number(facts.unreviewed_claims_accepted_count) || 0);
    const needsYou = readiness.state === "to-check" || readiness.state === "not-checked" || (outstanding > 0 && accepted < outstanding);
    return { ...base, key, readiness, label: storyReadinessChip(readiness).text, needsYou };
  }

  if (failed) return { ...base, key: "failed", label: "Draft failed" };
  if (running) {
    const stage = String(facts.job_stage ?? "").trim() || "Working…";
    return { ...base, key: "running", label: elapsed ? `${stage} · ${elapsed}` : stage };
  }
  if (unresolved > 0) {
    return {
      ...base,
      key: "names",
      label: `! ${unresolved} name${unresolved === 1 ? "" : "s"} to review`,
      needsYou: true,
    };
  }
  if (facts.evidence_required && !facts.evidence_decision) {
    return { ...base, key: "evidence", label: "! Evidence to check", needsYou: true };
  }
  if (facts.imported_text) return { ...base, key: "imported", label: "Imported" };
  /*
    "Ready to check", NOT the handoff's "Ready to publish".

    The design's word for a finished draft is "Ready to publish", and this row
    cannot honestly carry it: whether a draft may print is decided by the
    publish gate on the story page -- the section for the version being
    printed, the named-outlet credit check, the disclosure line, the citation
    lock -- and none of that is recorded on the draft row this query reads. A
    row labelled "Ready to publish" that the story page then refuses is the
    desk telling an editor something it did not know. "Ready to check" is what
    this row can prove: the writing finished and nothing recorded against it is
    outstanding. Reported to the owner as a wording change against the drawing.
  */
  if (yours) return { ...base, key: "yours", label: "Your draft" };
  return { ...base, key: "ready", label: "Ready to check" };
}

/**
 * The filter row's five pills, in the order the screen draws them.
 *
 * Named here rather than only in the route because the Drafts screen's list is
 * now windowed on the server (Unit CZ-long-lists) and the server has to know
 * which filters exist before it will answer one: a caller asking for a filter
 * this list does not have gets "all" back rather than an empty page. The route
 * and the server function both read this, so they cannot drift.
 */
export const DESK_DRAFT_FILTERS = ["all", "running", "needs-you", "yours", "failed"] as const;

export type DeskDraftFilter = (typeof DESK_DRAFT_FILTERS)[number];

/**
 * The filter row's counts, off the states already computed for the list.
 *
 * A draft can be both an editor's own work and needing them (a job they started
 * on their own headline), so the categories overlap on purpose: each count is
 * the number of rows that filter would SHOW, not a partition of the list.
 */
export function deskDraftFilterCounts(states: DeskDraftState[]): Record<DeskDraftFilter, number> {
  return {
    all: states.length,
    running: states.filter((s) => s.running).length,
    "needs-you": states.filter((s) => s.needsYou).length,
    yours: states.filter((s) => s.yours).length,
    failed: states.filter((s) => s.failed).length,
  };
}

/** Does this draft belong in the filter the editor picked? */
export function deskDraftMatchesFilter(state: DeskDraftState, filter: DeskDraftFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return state.running;
    case "needs-you":
      return state.needsYou;
    case "yours":
      return state.yours;
    case "failed":
      return state.failed;
  }
}

/**
 * Which action the row offers, in the same order the state was read.
 *
 * The words are the desk's existing ones -- "Watch", "Review", "Publish…",
 * "Continue", "Check", "Retry" -- so this is a pointer at a screen, not a new
 * vocabulary.
 */
export function deskDraftAction(state: DeskDraftState): string {
  switch (state.key) {
    case "running":
      return "Watch";
    case "failed":
      return "Retry";
    case "names":
    case "evidence":
      return "Check";
    case "imported":
    case "yours":
      return "Continue";
    case "empty":
      // The Queue's own word for opening a filed lead and starting its story.
      return "Start story";
    case "ready":
    case "not-ready":
      return "Review";
  }
}

/*
  ── PUBLISHING EVERY DRAFT AT ONCE (feat-publish-all) ────────────────────────

  The owner's ask (Nov 15 2026): "I should be able to push one button for
  'publish all drafts'" -- a batch of finished stories used to mean opening
  each story page in turn. The two rules that decide that button live here, in
  the pure module, rather than in the route or beside the server function, so
  both are tested without a database:

    1. WHICH ROWS QUALIFY. Only a draft whose state is "Your draft" or "Ready
       to check" is part of the batch. A running draft is not finished, a failed
       one has nothing to print, an empty one has no prose, and the three
       "Needs you" states (names, evidence, imported) are exactly the rows with
       an outstanding decision -- publishing them would be the desk deciding on
       the editor's behalf. `performPublish` still has the final say per story;
       this only decides what the button offers.
    2. WHAT A REQUEST MAY CARRY. Positive integers, at most 25, no duplicates.
       A duplicate would print one story twice in the same batch, so it is
       dropped (the first copy is kept), not refused; anything that is not a
       positive integer, or an empty list, refuses the whole request, because a
       request built wrong is a client bug and not a list of stories to guess.
*/

/** The most stories one publish-all request may carry (the client batches). */
export const PUBLISH_ALL_MAX = 25;

export type PublishAllItem = { leadId: number; topic?: string };

export type PublishAllInput =
  | { ok: true; items: PublishAllItem[] }
  | { ok: false; error: string };

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : null;
}

/** The input a publish-all request may carry, cleaned. See the note above. */
export function cleanPublishAllInput(raw: unknown): PublishAllInput {
  const list = (typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as { items?: unknown }).items
    : undefined);
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, error: "Choose at least one story to publish." };
  }
  if (list.length > PUBLISH_ALL_MAX) {
    return {
      ok: false,
      error: `Publish at most ${PUBLISH_ALL_MAX} stories at a time.`,
    };
  }
  const seen = new Set<number>();
  const items: PublishAllItem[] = [];
  for (const entry of list) {
    const o = (typeof entry === "object" && entry !== null ? entry : {}) as {
      leadId?: unknown;
      topic?: unknown;
    };
    const leadId = positiveInt(o.leadId);
    if (leadId === null) {
      return { ok: false, error: "There is no such story." };
    }
    // A duplicate prints one story twice; the first copy is the one kept.
    if (seen.has(leadId)) continue;
    seen.add(leadId);
    // 40 is `LIMITS.topic` in request-input.ts, the same ceiling the single
    // publish request uses for the section key.
    const topic = typeof o.topic === "string" ? o.topic.trim().slice(0, 40) : "";
    items.push({ leadId, ...(topic ? { topic } : {}) });
  }
  return { ok: true, items };
}

/** Is this row part of "Publish all drafts"? */
export function publishAllQualifies(state: Pick<DeskDraftState, "key">): boolean {
  return state.key === "yours" || state.key === "ready";
}

/**
 * The stories the button would print, in the order the list holds them.
 *
 * `stateOf` is passed in rather than computed here for the same reason the
 * elapsed clock is: the caller already builds each row's state to draw it, and
 * a second reading of the same facts could disagree with the row on screen.
 */
export function publishAllCandidates<R extends { lead_id: number; headline: string; topic: string | null }>(
  rows: readonly R[],
  stateOf: (row: R) => Pick<DeskDraftState, "key">,
): { leadId: number; headline: string; topic: string | null }[] {
  return rows
    .filter((row) => publishAllQualifies(stateOf(row)))
    .map((row) => ({ leadId: row.lead_id, headline: row.headline, topic: row.topic }));
}

/** The edition and its step counts are derived before any display window. */
export function tonightDrafts<T>(rows: readonly T[], states: readonly DeskDraftState[]) {
  const edition = rows
    .map((row, index) => ({ row, state: states[index]! }))
    .filter(({ state }) => state.readiness || state.key === "ready" || state.needsYou)
    .sort((a, b) => Number(b.state.key === "ready") - Number(a.state.key === "ready"));
  return {
    rows: edition,
    readyToPrint: edition.filter(({ state }) => state.key === "ready").length,
    readyToCheck: edition.filter(({ state }) => state.needsYou).length,
  };
}
