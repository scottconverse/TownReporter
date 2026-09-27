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

/** The facts about one draft that decide its state, as the query returns them. */
export type DeskDraftFacts = {
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
  | "yours"
  | "ready";

export type DeskDraftState = {
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
  const failed = job === "failed";
  const yours = editorOwnsHeadline(facts);
  const unresolved = Math.max(0, Number(facts.names_unresolved) || 0);
  const base = { needsYou: false, running, failed, yours };

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
    NOTHING WRITTEN YET, and this branch is why the last one can be trusted.

    A lead filed by hand gets a draft row with body = '' (see
    `insertLeadWithDraft` in desk.ts), so before this branch every such row fell
    through to "Ready to check". The Publish step on Today then counted leads
    nobody had written and Tonight's edition listed them, while the nav's Drafts
    count -- leads whose status is `drafted` -- said 0: the same page saying two
    things at once about the same two rows.

    The word is deliberate. Not "Draft failed" (nothing was attempted), not
    "Your draft" (nothing is), and not a state in the drawing at all, because
    the drawing has no row for this case: its list is drafts, and this is a lead.
    "Nothing written yet" is the one thing that is provably true here, and it is
    also what the row's action points at -- the story workbench, where the
    writing happens. Reported to the owner as a state added against the drawing.
  */
  if (!facts.has_body) return { ...base, key: "empty", label: "Nothing written yet" };
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

export type DeskDraftFilter = "all" | "running" | "needs-you" | "yours" | "failed";

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
      return "Review";
  }
}
