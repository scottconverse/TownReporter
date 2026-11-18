/**
 * The desk's proposal review (spec 24, Phase 3): accept or reject one waiting
 * change. Plain file, not `.server`, because the route imports it; the handler
 * bodies are removed from the client bundle.
 */

import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "../desk-auth.ts";
import {
  acceptChange,
  rejectChange,
  type ReviewResult,
} from "./registry-review.server.ts";

function changeIdOf(input: unknown): number {
  const changeId = Number((input as { changeId?: unknown } | null)?.changeId);
  if (!Number.isInteger(changeId) || changeId <= 0) {
    throw new Error("That proposal could not be found. Nothing was changed.");
  }
  return changeId;
}

function noteOf(input: unknown): string | null {
  const note = (input as { note?: unknown } | null)?.note;
  return typeof note === "string" ? note : null;
}

/** Accept one proposal in this newsroom, applying it to the entry or not. */
export const acceptRegistryChange = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { changeId: number; apply: boolean; note: string | null } => ({
    changeId: changeIdOf(input),
    apply: (input as { apply?: unknown } | null)?.apply === true,
    note: noteOf(input),
  }))
  .handler(async ({ data, context }): Promise<ReviewResult> => {
    return acceptChange(context.newsroomId, context.userId, data);
  });

/** Reject one proposal in this newsroom. The entry is not changed. */
export const rejectRegistryChange = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { changeId: number; note: string | null } => ({
    changeId: changeIdOf(input),
    note: noteOf(input),
  }))
  .handler(async ({ data, context }): Promise<ReviewResult> => {
    return rejectChange(context.newsroomId, context.userId, data);
  });
