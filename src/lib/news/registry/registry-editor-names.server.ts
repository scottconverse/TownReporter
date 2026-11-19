/**
 * The name the desk prints for the editor who accepted, rejected or checked
 * something.
 *
 * The stored ids (`resource_changes.reviewed_by`, `resource_verifications.checked_by`)
 * stay as they are; only what the desk shows is a name. The label is the
 * account's name, then its email when the name is empty, then "an editor" when
 * no account matches the id. One lookup serves a whole list. The public page
 * never reads this: it shows no names.
 */

import type { Sql } from "../../db.ts";

/** What the desk says when no account matches the id it has stored. */
export const UNKNOWN_EDITOR = "an editor";

/** The label for each account id in `userIds` that has one. Ids with no account are absent. */
export async function editorLabels(
  sql: Sql,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id !== ""))];
  const labels = new Map<string, string>();
  if (ids.length === 0) return labels;
  const rows = await sql.query<{ id: string; name: string | null; email: string | null }>(
    `select id, name, email from "user" where id = any($1::text[])`,
    [ids],
  );
  for (const row of rows) {
    const label = nonBlank(row.name) ?? nonBlank(row.email);
    if (label) labels.set(String(row.id), label);
  }
  return labels;
}

/** The label for one stored id: the name, else the email, else "an editor". */
export function editorLabel(labels: ReadonlyMap<string, string>, userId: string | null): string {
  return (userId === null ? undefined : labels.get(userId)) ?? UNKNOWN_EDITOR;
}

function nonBlank(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
