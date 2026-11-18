/**
 * Proposal review (spec 24, Phase 3). An editor accepts or rejects one waiting
 * change. Accepting can apply the proposed value to the one row it points at,
 * but only when that row still holds the value the proposal was made against.
 * Accepting never verifies an entry.
 *
 * Every function runs in one transaction (`withTransaction`, like the other
 * registry writers), locks the change row first, and writes one audit row.
 * Nothing here builds SQL from user input: the table and column come from
 * fixed maps.
 */

import { withTransaction, type Sql } from "../../db.ts";
import {
  asText,
  ENTITY_TYPE,
  REMOVABLE_TABLES,
  TABLE_COLUMNS,
} from "./hsds-import.server.ts";
import type { RegistryTableName } from "./hsds-map.ts";
import { recordRegistryEvent } from "./registry-audit.server.ts";

export const REVIEW_NOTE_MAX = 1000;

export type ReviewRefusal =
  | "resolved"
  | "no-target"
  | "not-applicable"
  | "stale"
  | "not-found"
  | "bad-note";

export type ReviewResult =
  | { ok: true; state: "accepted" | "rejected"; applied: boolean; message: string }
  | { ok: false; reason: ReviewRefusal; message: string };

const NO_TARGET_ADVICE =
  "This proposal does not point at one live row. Reject it, or accept it without applying and edit the entry yourself.";
const NOT_IN_NEWSROOM = "That proposal is not in this newsroom. Nothing was changed.";

/** The table a proposal's entity_type names. */
const TABLE_FOR_ENTITY = new Map<string, RegistryTableName>(
  (Object.entries(ENTITY_TYPE) as [RegistryTableName, string][]).map(([table, type]) => [type, table]),
);

/**
 * The columns a proposal may change: the ones the importer compares, minus the
 * columns that point at another row (a proposal must not re-point a row).
 */
export function applicableColumns(table: RegistryTableName): string[] {
  return TABLE_COLUMNS[table].filter((column) => !column.endsWith("_id"));
}

/** The table and column a proposal could be applied to, or null. */
export function applyTargetFor(entityType: string, fieldName: string): { table: RegistryTableName; column: string } | null {
  const table = TABLE_FOR_ENTITY.get(entityType);
  if (!table) return null;
  const column = applicableColumns(table).find((name) => name === fieldName);
  return column ? { table, column } : null;
}

/** Trim, and refuse a note that is too long or holds control characters. */
export function cleanReviewNote(
  note: unknown,
): { ok: true; note: string | null } | { ok: false; message: string } {
  if (note === null || note === undefined) return { ok: true, note: null };
  if (typeof note !== "string") return { ok: false, message: "The note must be text. Nothing was changed." };
  const trimmed = note.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) {
    return { ok: false, message: "The note has characters that cannot be saved. Nothing was changed." };
  }
  if (trimmed.length > REVIEW_NOTE_MAX) {
    return {
      ok: false,
      message: `The note is longer than ${REVIEW_NOTE_MAX} characters. Shorten it. Nothing was changed.`,
    };
  }
  return { ok: true, note: trimmed === "" ? null : trimmed };
}

interface ChangeRow {
  id: number;
  entity_type: string;
  entity_id: number | null;
  field_name: string;
  before_value: string | null;
  after_value: string | null;
  review_state: string;
  reviewed_by: string | null;
  reviewed_at: string | Date | null;
}

function dateOf(value: string | Date | null): string {
  if (!value) return "an unknown date";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "an unknown date" : d.toISOString().slice(0, 10);
}

function resolvedResult(row: ChangeRow): ReviewResult {
  return {
    ok: false,
    reason: "resolved",
    message: `This proposal was already ${row.review_state} by ${row.reviewed_by ?? "an editor"} on ${dateOf(row.reviewed_at)}. Nothing was changed.`,
  };
}

async function lockChange(sql: Sql, newsroomId: number, changeId: number): Promise<ChangeRow | null> {
  const rows = await sql.query<ChangeRow>(
    `select id, entity_type, entity_id, field_name, before_value, after_value,
            review_state, reviewed_by, reviewed_at
       from resource_changes
      where id = $1 and newsroom_id = $2
      for update`,
    [changeId, newsroomId],
  );
  return rows[0] ?? null;
}

function describe(row: ChangeRow): string {
  return `${row.entity_type} ${row.entity_id ?? "(new)"} ${row.field_name}`;
}

type ApplyOutcome = { ok: true } | { ok: false; reason: ReviewRefusal; message: string };

/**
 * Whether a write error means the value itself cannot be stored: SQLSTATE class
 * 22 (data exception, e.g. a bad number) or class 23 (integrity constraint, e.g.
 * a check the value breaks). PGlite checks a boolean on the client and throws
 * "Invalid input for boolean type" before the statement is sent, with no
 * SQLSTATE; pg sends the text and Postgres raises 22P02. That is the same
 * refusal, so it counts too. Any other error is a failure of the database or of
 * this code, not a refusal of the value.
 */
function isValueRefusal(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code === "string") return code.startsWith("22") || code.startsWith("23");
  return typeof message === "string" && /^Invalid input for \w+ type$/.test(message);
}

/** Check the target row under a lock and write the one column. */
async function applyToTarget(sql: Sql, newsroomId: number, row: ChangeRow): Promise<ApplyOutcome> {
  if (row.entity_id === null) return { ok: false, reason: "no-target", message: NO_TARGET_ADVICE };
  const target = applyTargetFor(row.entity_type, row.field_name);
  if (!target) {
    // A known table with an unknown field is "not applicable"; an unknown
    // table has no target at all.
    return TABLE_FOR_ENTITY.has(row.entity_type)
      ? { ok: false, reason: "not-applicable", message: NO_TARGET_ADVICE }
      : { ok: false, reason: "no-target", message: NO_TARGET_ADVICE };
  }
  const { table, column } = target;
  const removable = REMOVABLE_TABLES.has(table);
  // `table` and `column` are members of fixed maps, never the input itself.
  const found = await sql.query<Record<string, unknown>>(
    `select ${column} as current_value${removable ? ", removed_at" : ""}
       from ${table}
      where id = $1 and newsroom_id = $2
      for update`,
    [row.entity_id, newsroomId],
  );
  const live = found[0];
  if (!live || (removable && live.removed_at !== null && live.removed_at !== undefined)) {
    return { ok: false, reason: "no-target", message: NO_TARGET_ADVICE };
  }
  const current = asText(live.current_value);
  if (current !== row.before_value) {
    return {
      ok: false,
      reason: "stale",
      message: `This entry changed after the proposal was made. It now says ${current === null ? "nothing" : `"${current}"`}; the proposal would change it to ${row.after_value === null ? "nothing" : `"${row.after_value}"`}. Nothing was changed. Reject the proposal, or accept it without applying.`,
    };
  }
  // A value the column cannot hold must refuse, not abort the transaction, so
  // the write sits inside a savepoint. Only a value refusal is "not applicable";
  // any other error is rethrown and the whole transaction rolls back with it.
  await sql.query("savepoint registry_apply");
  try {
    await sql.query(
      `update ${table} set ${column} = $1, updated_at = now() where id = $2 and newsroom_id = $3`,
      [row.after_value, row.entity_id, newsroomId],
    );
    await sql.query("release savepoint registry_apply");
  } catch (error) {
    if (!isValueRefusal(error)) throw error;
    await sql.query("rollback to savepoint registry_apply");
    return {
      ok: false,
      reason: "not-applicable",
      message:
        "The proposed value cannot be stored in that field. Reject it, or accept it without applying and edit the entry yourself.",
    };
  }
  return { ok: true };
}

export interface AcceptChangeInput {
  changeId: number;
  apply: boolean;
  note?: string | null;
}

export interface RejectChangeInput {
  changeId: number;
  note?: string | null;
}

/**
 * Accept one proposal, applying it to the entry when `apply` is true. Opens its
 * own transaction; the caller passes no connection.
 */
export async function acceptChange(
  newsroomId: number,
  userId: string,
  input: AcceptChangeInput,
): Promise<ReviewResult> {
  const note = cleanReviewNote(input.note);
  if (!note.ok) return { ok: false, reason: "bad-note", message: note.message };
  return withTransaction(async (tx): Promise<ReviewResult> => {
    const row = await lockChange(tx, newsroomId, input.changeId);
    if (!row) return { ok: false, reason: "not-found", message: NOT_IN_NEWSROOM };
    if (row.review_state === "accepted" || row.review_state === "rejected") return resolvedResult(row);

    if (input.apply) {
      const outcome = await applyToTarget(tx, newsroomId, row);
      if (!outcome.ok) return outcome;
    }
    await tx.query(
      `update resource_changes
          set review_state = 'accepted', reviewed_by = $1, reviewed_at = now(),
              applied_at = ${input.apply ? "now()" : "null"}, review_note = $2, updated_at = now()
        where id = $3 and newsroom_id = $4`,
      [userId, note.note, row.id, newsroomId],
    );
    await recordRegistryEvent(tx, {
      newsroomId,
      userId,
      action: "registry.change.accept",
      subjectKind: "registry-change",
      subjectId: row.id,
      detail: `Accepted the proposed change to ${describe(row)}${input.apply ? " and applied it" : " without applying it"}.${note.note ? ` Note: ${note.note}` : ""}`,
    });
    return {
      ok: true,
      state: "accepted",
      applied: input.apply,
      message: input.apply ? "Accepted and applied." : "Accepted. The entry was not changed.",
    };
  });
}

/** Reject one proposal. The entry is never changed. Opens its own transaction. */
export async function rejectChange(
  newsroomId: number,
  userId: string,
  input: RejectChangeInput,
): Promise<ReviewResult> {
  const note = cleanReviewNote(input.note);
  if (!note.ok) return { ok: false, reason: "bad-note", message: note.message };
  return withTransaction(async (tx): Promise<ReviewResult> => {
    const row = await lockChange(tx, newsroomId, input.changeId);
    if (!row) return { ok: false, reason: "not-found", message: NOT_IN_NEWSROOM };
    if (row.review_state === "accepted" || row.review_state === "rejected") return resolvedResult(row);
    await tx.query(
      `update resource_changes
          set review_state = 'rejected', reviewed_by = $1, reviewed_at = now(),
              review_note = $2, updated_at = now()
        where id = $3 and newsroom_id = $4`,
      [userId, note.note, row.id, newsroomId],
    );
    await recordRegistryEvent(tx, {
      newsroomId,
      userId,
      action: "registry.change.reject",
      subjectKind: "registry-change",
      subjectId: row.id,
      detail: `Rejected the proposed change to ${describe(row)}.${note.note ? ` Note: ${note.note}` : ""}`,
    });
    return { ok: true, state: "rejected", applied: false, message: "Rejected." };
  });
}
