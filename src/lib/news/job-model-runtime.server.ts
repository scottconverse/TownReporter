import { resolveJobModel, type ModelJobKey } from "./model-assignments.ts";
import { ensureModelAssignmentsSchema, readModelAssignments } from "./model-assignments-store.ts";
import type { ModelEffort } from "./provider-registry.ts";

/** Resolve the job's saved first choice before probing or snapshotting a run. */
export async function resolveRequestedJobModel(
  newsroomId: number,
  jobKey: ModelJobKey,
  requested?: string | null,
  effort?: ModelEffort | null,
  modelChoiceExplicit = false,
) {
  // A named per-run pick wins. Automatic is the form's absence of a pick;
  // a saved Automatic row still deliberately selects the normal ladder.
  const explicit = requested && (requested !== "auto" || modelChoiceExplicit) ? requested : null;
  // Keep the named runtime intact for its boundary's own validation, including
  // legacy forced-runtime aliases. No assignment can replace that decision.
  if (explicit)
    return {
      providerId: explicit,
      effort: effort ?? null,
      source: "explicit" as const,
      rank: null,
      notice: null,
    };
  await ensureModelAssignmentsSchema();
  const resolved = resolveJobModel({
    jobKey,
    explicit,
    assignments: explicit ? [] : await readModelAssignments(newsroomId),
  });
  return {
    ...resolved,
    effort: resolved.source === "assignment" ? resolved.effort : (effort ?? resolved.effort),
  };
}
