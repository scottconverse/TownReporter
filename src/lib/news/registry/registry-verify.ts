/**
 * The desk's explicit verification (spec 24, Phase 3): record a check, read an
 * entry's checks, and list the entries that need checking. Plain file, not
 * `.server`, because the route imports it; the handler bodies are removed from
 * the client bundle.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../../db.ts";
import { deskMiddleware } from "../desk-auth.ts";
import {
  listNeedsCheckingIn,
  readVerificationIn,
  recordVerificationIn,
  type EntryVerification,
  type NeedsCheckingItem,
  type RecordVerificationInput,
  type RecordVerificationResult,
} from "./registry-verify.server.ts";

function serviceIdOf(input: unknown): number {
  const serviceId = Number((input as { serviceId?: unknown } | null)?.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    throw new Error("That entry could not be found. Nothing was changed.");
  }
  return serviceId;
}

/** Record that the editor checked one entry in this newsroom. */
export const recordRegistryVerification = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): RecordVerificationInput => {
    const record = (input ?? {}) as Record<string, unknown>;
    return {
      serviceId: serviceIdOf(input),
      method: typeof record.method === "string" ? record.method : "",
      basis: typeof record.basis === "string" ? record.basis : "",
      sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : null,
    };
  })
  .handler(async ({ data, context }): Promise<RecordVerificationResult> => {
    const sql = await getSql();
    return recordVerificationIn(sql, context.newsroomId, context.userId, data);
  });

/** The latest check, the history and the changed facts of one entry. */
export const readRegistryVerification = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number } => ({ serviceId: serviceIdOf(input) }))
  .handler(async ({ data, context }): Promise<EntryVerification> => {
    const sql = await getSql();
    return readVerificationIn(sql, context.newsroomId, data.serviceId);
  });

/** The published entries that need checking, never-verified and oldest first. */
export const listRegistryNeedsChecking = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<NeedsCheckingItem[]> => {
    const sql = await getSql();
    return listNeedsCheckingIn(sql, context.newsroomId);
  });
