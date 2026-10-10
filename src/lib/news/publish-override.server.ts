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
  const recorded = new Set<string>();
  for (const warning of input.warnings) {
    if (recorded.has(warning.key)) continue;
    const detail = JSON.stringify({
      key: warning.key,
      draftId: input.draftId,
      leadId: input.leadId,
      editor: input.userId,
    });
    // The ordinary audit helper clips prose to 500 characters. Structured
    // decisions must retain the exact key and valid JSON; use the same table
    // directly, with the editor and time also recorded in their own columns.
    await sql`
      insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
      values (${input.userId}, 'publish-override', ${detail}, ${input.newsroomId}, 'drafts', ${input.draftId})
    `;
    recorded.add(warning.key);
  }
  return recorded.size;
}

/** Only current warning keys count; extra submitted keys confer no permission. */
export function acknowledgedWarnings(
  warnings: readonly AcknowledgedWarning[],
  acknowledgedKeys: readonly string[],
): AcknowledgedWarning[] {
  const wanted = new Set(acknowledgedKeys);
  return warnings.filter((warning) => wanted.has(warning.key));
}
