/**
 * The desk's registry writes (spec 24, Phase 1): load the starter list, publish
 * one entry, and the editor's upkeep -- edit one entry, add one, take a
 * published one back down.
 *
 * This file is plain, not `.server`, because the route imports it. The handler
 * bodies are removed from the client bundle, so the database functions in
 * `registry-desk-write.server.ts` never reach the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../../db.ts";
import { deskMiddleware } from "../desk-auth.ts";
import { normalizeRegistryEntryFields } from "./registry-entry-fields.ts";
import {
  addRegistryEntryIn,
  loadStarterListIn,
  publishRegistryEntryIn,
  takeDownRegistryEntryIn,
  updateRegistryEntryIn,
  type AddRegistryEntryResult,
  type LoadStarterListResult,
  type PublishRegistryEntryResult,
  type TakeDownRegistryEntryResult,
  type UpdateRegistryEntryResult,
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

/** Save an editor's changes to one entry, waiting or published. */
export const updateRegistryEntry = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: unknown): { serviceId: number; fields: ReturnType<typeof normalizeRegistryEntryFields> } => {
      const serviceId = Number((input as { serviceId?: unknown } | null)?.serviceId);
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        throw new Error("That entry could not be found. Nothing was changed.");
      }
      const fields = normalizeRegistryEntryFields((input as { fields?: unknown } | null)?.fields);
      return { serviceId, fields };
    },
  )
  .handler(async ({ data, context }): Promise<UpdateRegistryEntryResult> => {
    const sql = await getSql();
    return updateRegistryEntryIn(sql, context.newsroomId, data.serviceId, data.fields, context.userId);
  });

/** Add one entry to this newsroom, waiting to be published. */
export const addRegistryEntry = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(
    (input: unknown): { fields: ReturnType<typeof normalizeRegistryEntryFields> } => ({
      fields: normalizeRegistryEntryFields((input as { fields?: unknown } | null)?.fields),
    }),
  )
  .handler(async ({ data, context }): Promise<AddRegistryEntryResult> => {
    const sql = await getSql();
    return addRegistryEntryIn(sql, context.newsroomId, data.fields, context.userId);
  });

/** Take one published entry back off the public page. Deletes nothing. */
export const takeDownRegistryEntry = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number } => {
    const serviceId = Number((input as { serviceId?: unknown } | null)?.serviceId);
    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      throw new Error("That entry could not be found. Nothing was changed.");
    }
    return { serviceId };
  })
  .handler(async ({ data, context }): Promise<TakeDownRegistryEntryResult> => {
    const sql = await getSql();
    return takeDownRegistryEntryIn(sql, context.newsroomId, data.serviceId, context.userId);
  });
