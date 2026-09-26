/**
 * The Models screen's own state: ten jobs, three slots each, and the two
 * questions the screen asks of it -- "what would saving write" and "how many
 * jobs have changed".
 *
 * Kept out of the route and out of ./model-assignments.ts on purpose. The
 * route is JSX and cannot be unit tested here; `model-assignments.ts` is the
 * desk's answer to "which model runs this job" and is read by run paths that
 * have never heard of a `<select>`. This file is the third thing: the shape a
 * half-edited form holds, which nothing outside the screen should ever see.
 *
 * THREE SLOTS, NOT TWO FIELDS. Every rank carries its own effort, because the
 * table does and because the alternative is a save that silently drops a
 * fallback's effort: the design draws an effort select beside the first choice
 * only, so a stored fallback effort has no control to sit in -- but it does
 * have a slot to round-trip through, and this is it. Saving a form the editor
 * never touched on that field writes back exactly what was read.
 */

import {
  FALLBACK_RANKS,
  FIRST_CHOICE_RANK,
  MODEL_JOB_KEYS,
  type ModelAssignmentRow,
  type ModelJobKey,
} from "./model-assignments.ts";

/** One select's worth of state. An empty `providerId` is "nothing saved". */
export type JobAssignmentSlot = {
  providerId: string;
  /** "" means null: the provider's own default. */
  effort: string;
};

export type JobAssignmentDraft = {
  first: JobAssignmentSlot;
  fallback1: JobAssignmentSlot;
  fallback2: JobAssignmentSlot;
};

export type ModelAssignmentDraft = Record<ModelJobKey, JobAssignmentDraft>;

/** The slots in rank order, which is also the order the screen draws them. */
export const DRAFT_SLOTS = ["first", "fallback1", "fallback2"] as const;

export type DraftSlotName = (typeof DRAFT_SLOTS)[number];

const EMPTY_SLOT: JobAssignmentSlot = { providerId: "", effort: "" };

function emptyJobDraft(): JobAssignmentDraft {
  return { first: EMPTY_SLOT, fallback1: EMPTY_SLOT, fallback2: EMPTY_SLOT };
}

function slotForRank(rank: number): DraftSlotName | null {
  if (rank === FIRST_CHOICE_RANK) return "first";
  if (rank === FALLBACK_RANKS[0]) return "fallback1";
  if (rank === FALLBACK_RANKS[1]) return "fallback2";
  return null;
}

/**
 * What the table holds, as a form holds it.
 *
 * Every job gets a draft whether or not it has rows: the screen draws all ten
 * rows, and a missing key would mean a row that renders as a hole. An unknown
 * job key and an out-of-range rank cannot appear here -- `readModelAssignments`
 * drops both -- so there is nothing to defend against, only to place.
 */
export function draftFromRows(
  rows: readonly ModelAssignmentRow[],
): ModelAssignmentDraft {
  const draft = {} as ModelAssignmentDraft;
  for (const key of MODEL_JOB_KEYS) draft[key] = emptyJobDraft();
  for (const row of rows) {
    const slot = slotForRank(row.rank);
    if (!slot) continue;
    const job = draft[row.jobKey];
    if (!job) continue;
    job[slot] = { providerId: row.providerId, effort: row.effort ?? "" };
  }
  return draft;
}

/** A blank form: every job unassigned, which is the behavior before the table. */
export function emptyDraft(): ModelAssignmentDraft {
  return draftFromRows([]);
}

/**
 * What saving the form would write, in the table's own shape.
 *
 * A slot with no model writes nothing -- that is how "Automatic" and "not set"
 * are both expressed, and it is why the store's write is a full replace. The
 * effort travels only where a model does: an effort with no model behind it is
 * a level for a run that does not exist.
 */
export function rowsFromDraft(
  draft: ModelAssignmentDraft,
): ModelAssignmentRow[] {
  const out: ModelAssignmentRow[] = [];
  for (const jobKey of MODEL_JOB_KEYS) {
    const job = draft[jobKey];
    if (!job) continue;
    for (const [rank, slot] of [
      [FIRST_CHOICE_RANK, job.first],
      [FALLBACK_RANKS[0], job.fallback1],
      [FALLBACK_RANKS[1], job.fallback2],
    ] as const) {
      const providerId = slot?.providerId?.trim();
      if (!providerId) continue;
      out.push({
        jobKey,
        rank,
        providerId,
        effort: slot.effort ? slot.effort : null,
      });
    }
  }
  return out;
}

/**
 * The jobs whose form no longer matches what was read, keyed by job.
 *
 * Compared as the three slots rather than as rows, so reordering ranks by
 * hand -- or saving an assignment whose effort the model has since stopped
 * taking -- is not itself "unsaved". The footer counts jobs, not fields: the
 * copy is "3 unsaved changes. Nothing changes until you save.", and a job is
 * the thing the editor changed.
 */
export function dirtyJobKeys(
  draft: ModelAssignmentDraft,
  saved: ModelAssignmentDraft,
): ModelJobKey[] {
  const out: ModelJobKey[] = [];
  for (const jobKey of MODEL_JOB_KEYS) {
    if (!sameJobDraft(draft[jobKey], saved[jobKey])) out.push(jobKey);
  }
  return out;
}

function sameSlot(a: JobAssignmentSlot | undefined, b: JobAssignmentSlot | undefined): boolean {
  return (a?.providerId ?? "") === (b?.providerId ?? "") && (a?.effort ?? "") === (b?.effort ?? "");
}

function sameJobDraft(
  a: JobAssignmentDraft | undefined,
  b: JobAssignmentDraft | undefined,
): boolean {
  return (
    sameSlot(a?.first, b?.first) &&
    sameSlot(a?.fallback1, b?.fallback1) &&
    sameSlot(a?.fallback2, b?.fallback2)
  );
}

/** How many jobs have changed. Zero is the footer's other sentence. */
export function unsavedJobCount(
  draft: ModelAssignmentDraft,
  saved: ModelAssignmentDraft,
): number {
  return dirtyJobKeys(draft, saved).length;
}

/**
 * The footer's line, exactly as the design draws it.
 *
 * The zero-dirty sentence is not "0 unsaved changes" -- the design says the
 * reassuring thing instead, and the reason it is this sentence is that it is
 * also the screen's one warning: a job whose only row names a model this build
 * no longer offers is NOT working, and the notice beside that row is where the
 * editor finds out.
 */
export function unsavedSummary(count: number): string {
  if (count === 0) return "All jobs have a working first choice except where marked.";
  return `${count} unsaved change${count > 1 ? "s" : ""}. Nothing changes until you save.`;
}
