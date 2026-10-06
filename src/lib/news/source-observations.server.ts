/**
 * Persisting and reading dated source observations (migration 0128).
 *
 * The pure vocabulary lives in `source-inventory.ts`; this is the thin database
 * layer that writes one observation per event and reads them back for a source,
 * a run, or a lead. It writes NOTHING on its own -- every function here is called
 * by a caller that just observed something (the scan touch path, the reporting
 * worker recording "this source verified a claim", an editor correcting an
 * earlier call).
 *
 * `recordObservation` is idempotent on (source, kind, day, run) only in the sense
 * that it will not write a second identical row for the same scan run -- a
 * retried touch must not double-count a failure. Everything else is append-only
 * history on purpose.
 */
import { getSql, type Sql } from "../db.ts";

export const OBSERVATION_KINDS = [
  "changed",
  "quiet",
  "retrieval-error",
  "extraction-failure",
  "asked-to-wait",
  "blocked",
  "never-checked",
  "verified-claim",
  "filled-gap",
  "corrected-draft",
  "replaced",
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export type SourceObservationRow = {
  id: number;
  source_id: number;
  observed_on: string;
  kind: ObservationKind;
  note: string | null;
  lead_id: number | null;
  claim_key: string | null;
  scan_run_id: number | null;
  observed_by: string;
  reversal_of: number | null;
  created_at: string;
};

export type RecordObservationInput = {
  newsroomId: number;
  sourceId: number;
  kind: ObservationKind;
  /** One plain sentence, for the editor. Null when there is nothing to say. */
  note?: string | null;
  /** Scope: which story this observation belongs to, when it has one. */
  leadId?: number | null;
  claimKey?: string | null;
  scanRunId?: number | null;
  /** Who observed it: 'scan' | 'scheduler' | 'editor' | 'reporting' | 'system'. */
  observedBy?: string;
  /** The observation this one corrects, when it is a reversal. */
  reversalOf?: number | null;
};

const NOTE_MAX = 600;

/**
 * Write one observation. Returns the new row's id, or null when an identical
 * observation for the same source, kind, and scan run already exists -- a
 * retried touch must not record a second failure.
 */
export async function recordObservation(
  input: RecordObservationInput,
  sql?: Sql,
): Promise<number | null> {
  const db = sql ?? (await getSql());
  const note = input.note?.trim().slice(0, NOTE_MAX) || null;
  if (input.scanRunId != null) {
    const existing = await db.query<{ id: number }>(
      "select id from source_observations where newsroom_id=$1 and source_id=$2 and kind=$3 and scan_run_id=$4 limit 1",
      [input.newsroomId, input.sourceId, input.kind, input.scanRunId],
    );
    if (existing[0]) return null;
  }
  const rows = await db.query<{ id: number }>(
    `insert into source_observations
       (newsroom_id, source_id, kind, note, lead_id, claim_key, scan_run_id, observed_by, reversal_of)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [
      input.newsroomId,
      input.sourceId,
      input.kind,
      note,
      input.leadId ?? null,
      input.claimKey ?? null,
      input.scanRunId ?? null,
      input.observedBy ?? "system",
      input.reversalOf ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

/** Record an editor's correction of an earlier observation: the same shape,
 *  with `reversal_of` pointing at the row it corrects. The old row is KEPT. */
export async function reverseObservation(input: {
  newsroomId: number;
  sourceId: number;
  correctsId: number;
  kind: ObservationKind;
  note?: string | null;
  observedBy?: string;
}): Promise<number | null> {
  return recordObservation({
    newsroomId: input.newsroomId,
    sourceId: input.sourceId,
    kind: input.kind,
    note: input.note ?? null,
    observedBy: input.observedBy ?? "editor",
    reversalOf: input.correctsId,
  });
}

export async function observationsForSource(
  newsroomId: number,
  sourceId: number,
  limit = 20,
): Promise<SourceObservationRow[]> {
  const sql = await getSql();
  return sql.query<SourceObservationRow>(
    "select * from source_observations where newsroom_id=$1 and source_id=$2 order by created_at desc, id desc limit $3",
    [newsroomId, sourceId, Math.max(1, Math.min(200, limit))],
  );
}

/** The observations that matter to a story: anything scoped to this lead. */
export async function observationsForLead(
  newsroomId: number,
  leadId: number,
): Promise<SourceObservationRow[]> {
  const sql = await getSql();
  return sql.query<SourceObservationRow>(
    "select * from source_observations where newsroom_id=$1 and lead_id=$2 order by created_at desc, id desc limit 200",
    [newsroomId, leadId],
  );
}

/** The most recent observation per source, for the inventory and the screen. */
export async function latestObservationPerSource(
  newsroomId: number,
): Promise<Map<number, SourceObservationRow>> {
  const sql = await getSql();
  const rows = await sql.query<SourceObservationRow>(
    `select distinct on (source_id) *
       from source_observations
      where newsroom_id=$1
      order by source_id, created_at desc, id desc`,
    [newsroomId],
  );
  return new Map(rows.map((row) => [row.source_id, row]));
}

/**
 * Translate one attempt's outcome (a `SourceTouch` from `fetch-politeness.ts`)
 * into the observation kind it should be recorded as, plus a plain sentence.
 *
 * PURE, so the one place that decides "a wait is not a failure" and "no change
 * is not a problem" can be pinned without a database. `changed` cannot be known
 * from a touch alone -- a read that found a new hash is `changed`, one that did
 * not is `quiet` -- so the caller passes `changedByHash`.
 */
export function observationForTouch(input: {
  outcome: "read" | "wait" | "blocked" | "failed" | "skipped";
  last_error?: string | null;
  changedByHash?: boolean;
  retry_after_note?: string | null;
}): { kind: ObservationKind; note: string | null } {
  switch (input.outcome) {
    case "read":
      return input.changedByHash
        ? { kind: "changed", note: "Read cleanly and the page had changed." }
        : { kind: "quiet", note: "Read cleanly; nothing new." };
    case "wait":
      return {
        kind: "asked-to-wait",
        note: input.retry_after_note ?? "The site asked the desk to come back later.",
      };
    case "blocked":
      return { kind: "blocked", note: input.last_error ?? "The site refused the desk." };
    case "skipped":
      return { kind: "asked-to-wait", note: input.retry_after_note ?? null };
    case "failed":
    default: {
      const message = input.last_error ?? "";
      return /extract|parse|readab|empty page|had almost no|no text/i.test(message)
        ? { kind: "extraction-failure", note: message || null }
        : { kind: "retrieval-error", note: message || null };
    }
  }
}
