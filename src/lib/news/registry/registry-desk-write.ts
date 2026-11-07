/**
 * The desk's two registry writes (spec 24, Phase 1): load the starter list, and
 * publish one entry.
 *
 * This file is plain, not `.server`, because the route imports it. The handler
 * bodies are removed from the client bundle, so the database functions in
 * `registry-desk-write.server.ts` never reach the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../../db.ts";
import { deskMiddleware } from "../desk-auth.ts";
import {
  loadStarterListIn,
  publishRegistryEntryIn,
  type LoadStarterListResult,
  type PublishRegistryEntryResult,
} from "./registry-desk-write.server.ts";

/** Load the approved starter list. Publishes nothing. */
export const loadStarterList = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<LoadStarterListResult> => {
    const sql = await getSql();
    return loadStarterListIn(sql, context.newsroomId, context.userId);
  });

/** Publish one registry entry in this newsroom. */
export const publishRegistryEntry = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number } => {
    const serviceId = Number((input as { serviceId?: unknown } | null)?.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      throw new Error("That entry could not be found. Nothing was changed.");
    }
    return { serviceId };
  })
  .handler(async ({ data, context }): Promise<PublishRegistryEntryResult> => {
    const sql = await getSql();
    return publishRegistryEntryIn(sql, context.newsroomId, data.serviceId, context.userId);
  });
