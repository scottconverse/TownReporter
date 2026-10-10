import type { Sql } from "../db.ts";

export type AcknowledgedWarning = { key: string; sentence: string };

/** Record overrides on the publishing transaction, so a rollback leaves no decision behind. */
export async function auditPublishOverrides(
  sql: Sql,
  input: {
    newsroomId: number;
    userId: string;
    leadId: number;
    draftId: number;
    warnings: readonly AcknowledgedWarning[];
  },
): Promise<number> {
  const { recordEditorOverrides } = await import("./editor-override.ts");
  return recordEditorOverrides({ userId: input.userId, newsroomId: input.newsroomId, sql }, input.warnings, { kind: "drafts", id: input.draftId });
}

/** Only current warning keys count; extra submitted keys confer no permission. */
export function acknowledgedWarnings(
  warnings: readonly AcknowledgedWarning[],
  acknowledgedKeys: readonly string[],
): AcknowledgedWarning[] {
  const wanted = new Set(acknowledgedKeys);
  return warnings.filter((warning) => wanted.has(warning.key));
}
