/**
 * One audit row for a registry action (spec 24, Phase 3). The columns are the
 * ones every other desk writer uses: who, what, a readable sentence, and the
 * newsroom and subject the action was about.
 */

import type { Sql } from "../../db.ts";

export type RegistryAuditAction =
  | "registry.change.accept"
  | "registry.change.reject"
  | "registry.service.verify"
  | "registry.service.publish"
  | "registry.service.withdraw"
  /** A scan's commit applied and published an entry by itself (Scott, Nov 20 2026). */
  | "registry.service.autopublish"
  /** The same, for a change to an organization or location rather than a service. */
  | "registry.change.autopublish";

export interface RegistryEventInput {
  newsroomId: number;
  userId: string;
  action: RegistryAuditAction;
  /** 'registry-change' or 'registry-service'. */
  subjectKind: "registry-change" | "registry-service";
  subjectId: number;
  /** Plain readable text. */
  detail: string;
}

export async function recordRegistryEvent(sql: Sql, event: RegistryEventInput): Promise<void> {
  await sql.query(
    `insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [event.userId, event.action, event.detail, event.newsroomId, event.subjectKind, event.subjectId],
  );
}
