/** Structured policy warnings and mandatory editor override auditing.
 * Callers inside a transaction must ensure the audit schema before entering it. */
import { ensureAuditEventsSchema, type AuditSqlTag } from "./ops.ts";
import { getSql } from "../db.ts";

/** One policy block, named and said. */
export type EditorWarning = { key: string; sentence: string };

/**
 * The refusal a caller returns. `error` is the sentence, kept for the old
 * consumers; `warning` is the structured pair the UI draws and echoes back.
 */
export type EditorWarningResult = {
  ok: false;
  warning: EditorWarning;
  error: string;
};

/** The optional input every overridable action carries. */
export type EditorOverrideInput = { override?: string[] };

/** Whether the editor's second press named this exact key. Exact, never a prefix. */
export function overrideIncludes(
  override: readonly string[] | undefined,
  key: string,
): boolean {
  return Array.isArray(override) && override.includes(key);
}

/** The warning object for a key, with `error` as the same sentence. */
export function editorWarningResult(key: string, sentence: string): EditorWarningResult {
  return { ok: false as const, warning: { key, sentence }, error: sentence };
}

/**
 * Warn about `key`/`sentence` unless `override` names `key`, in which case
 * record the override and let the action proceed (return null).
 *
 * @param context the editor overriding, the newsroom, and an optional `sql`
 *   handle when the caller is already inside a transaction.
 * @param override the keys the editor has already approved this press.
 * @param key a stable key; the UI echoes it back verbatim on the second press.
 * @param sentence the one sentence the editor reads.
 * @param target what the override is about, for the audit trail.
 */
export async function editorWarning(
  context: { userId: string; newsroomId?: number; sql?: AuditSqlTag },
  override: readonly string[] | undefined,
  key: string,
  sentence: string,
  target?: { kind: string; id: number },
): Promise<EditorWarningResult | null> {
  if (!overrideIncludes(override, key)) return editorWarningResult(key, sentence);
  await recordEditorOverrides(context, [{ key, sentence }], target);
  return null;
}

/** The single audit shape for every policy override, including publication. */
export async function recordEditorOverrides(
  context: { userId: string; newsroomId?: number; sql?: AuditSqlTag },
  warnings: readonly EditorWarning[],
  target?: { kind: string; id: number },
): Promise<number> {
  let sql = context.sql;
  if (!sql) {
    await ensureAuditEventsSchema();
    sql = await getSql();
  }
  const recorded = new Set<string>();
  for (const warning of warnings) {
    if (recorded.has(warning.key)) continue;
    const detail = JSON.stringify({ key: warning.key, target: target ?? null });
    await sql`
      insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
      values (${context.userId}, 'override', ${detail}, ${context.newsroomId ?? 1}, ${target?.kind ?? null}, ${target?.id ?? null})
    `;
    recorded.add(warning.key);
  }
  return recorded.size;
}

/** Check first; callers record only keys used by their completed action. */
export function checkOverride(input: EditorOverrideInput, key: string, sentence: string): EditorWarningResult | null {
  return overrideIncludes(input.override, key) ? null : editorWarningResult(key, sentence);
}

export function isOverrideWarning(value: unknown): value is EditorWarningResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; warning?: { key?: unknown; sentence?: unknown } };
  return candidate.ok === false && typeof candidate.warning?.key === "string" && typeof candidate.warning.sentence === "string";
}

export async function auditOverrides(
  context: { userId: string; newsroomId: number }, keys: string[], target: { kind: string; id: number },
): Promise<void> {
  await recordEditorOverrides(context, keys.map(key => ({ key, sentence: "" })), target);
}
