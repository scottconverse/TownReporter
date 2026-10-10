/** Structured policy warnings and mandatory editor override auditing.
 * Callers inside a transaction must ensure the audit schema before entering it. */
import { audit, auditWithSql, type AuditSqlTag } from "./ops.ts";

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
  /*
    The audit is NOT best-effort. The consent and the record of it are the same
    act: an override that runs with no `audit_events` row is exactly the silent
    bypass Scott's rule is meant to replace, so a failed write must surface as a
    failure, not be swallowed. A caller inside a transaction passes `sql` (its
    schema must already be ensured -- the ensure is DDL); a caller with an open
    `audit_events` table passes `sql` too; only the ordinary path self-ensures.
  */
  const detail = JSON.stringify({ key, target: target ?? null });
  const newsroomId = context.newsroomId ?? 1;
  if (context.sql) {
    await auditWithSql(context.sql, context.userId, "override", detail, newsroomId, target);
  } else {
    await audit(context.userId, "override", detail, newsroomId, target);
  }
  return null;
}
