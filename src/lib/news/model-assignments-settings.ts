/**
 * The two calls the Models screen makes: read the newsroom's assignments, and
 * save the set the editor is holding.
 *
 * Same shape as ./provider-login.ts and ./custom-ai-settings.ts, and for the
 * same reason: the module that opens a database handle is imported INSIDE each
 * handler, so the client bundle that renders the screen never sees `getSql`.
 * The route imports this file; this file imports the store lazily.
 *
 * WHO MAY DO WHAT. Reading is open to any desk member: the table says which
 * model runs the daily scan, that is a fact about the paper, and an invited
 * editor who is told "the scan is down" should be able to look. Writing is the
 * owner's, refused the same way every other paper-wide setting is
 * (`assertOwner`, and the same sentence an editor sees on Server settings).
 * The screen hides the buttons from an editor as well -- but the refusal is
 * here, where hiding it is not the protection.
 */

import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "./desk-auth.ts";
import { modelAssignmentRowsInput } from "./request-input.ts";
import type { ModelAssignmentRow } from "./model-assignments.ts";

export type { ModelAssignmentRow, ModelJobKey } from "./model-assignments.ts";

/** Shared React Query key. Dependency-free, so the client bundle can import it. */
export const MODEL_ASSIGNMENTS_QUERY_KEY = ["model-assignments"] as const;

export type ModelAssignmentsResult =
  | { ok: true; assignments: ModelAssignmentRow[] }
  | { ok: false; code: "forbidden" | "invalid" | "unavailable"; error: string };

export const getModelAssignmentsFn = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<ModelAssignmentsResult> => {
    try {
      const { ensureModelAssignmentsSchema, readModelAssignments } = await import(
        "./model-assignments-store.ts"
      );
      await ensureModelAssignmentsSchema();
      return { ok: true, assignments: await readModelAssignments(context.newsroomId) };
    } catch (e) {
      return {
        ok: false,
        code: "unavailable",
        error: e instanceof Error ? e.message : "Could not read the assignments.",
      };
    }
  });

export const saveModelAssignmentsFn = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown): ModelAssignmentRow[] => {
    const parsed = modelAssignmentRowsInput.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Assignments must be a list of job, rank and model rows.");
    }
    return parsed.data.map((row) => ({
      jobKey: row.jobKey as ModelAssignmentRow["jobKey"],
      rank: row.rank,
      providerId: row.providerId,
      effort: row.effort ?? null,
    }));
  })
  .handler(async ({ context, data }): Promise<ModelAssignmentsResult> => {
    try {
      assertOwner(context.role);
    } catch (e) {
      return {
        ok: false,
        code: "forbidden",
        error: e instanceof Error ? e.message : "Only the owner can do that.",
      };
    }
    try {
      const { ensureModelAssignmentsSchema, saveModelAssignments } = await import(
        "./model-assignments-store.ts"
      );
      await ensureModelAssignmentsSchema();
      /* Read back from the table, not echoed from the body: what the screen
         shows as saved has to be what a run would read. */
      const assignments = await saveModelAssignments(context.newsroomId, data);
      return { ok: true, assignments };
    } catch (e) {
      /*
        `ModelAssignmentInputError` is the store refusing a row it could not
        store -- an unknown job, a rank out of range, two models at one rank.
        That is the editor's form being wrong, so it answers with the store's
        own sentence rather than a 500. Anything else is a real failure and
        says so the same way, because a save that silently did nothing is the
        one outcome the footer must never allow.
      */
      return {
        ok: false,
        code: "invalid",
        error: e instanceof Error ? e.message : "Could not save the assignments.",
      };
    }
  });

/**
 * Put a saved set into the cache the screen reads, so the two tabs and any
 * other mount of the form agree without a refetch. Shaped for React Query's
 * `setQueryData`, and pure enough to test on its own.
 */
export function assignmentsFromSave(result: ModelAssignmentsResult): ModelAssignmentRow[] | null {
  return result.ok ? result.assignments : null;
}
