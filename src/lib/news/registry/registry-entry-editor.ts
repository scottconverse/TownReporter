/**
 * The registry entry editor's server functions (spec 24, Phase 2, job C1).
 *
 * Plain, not `.server`, because the editor component imports it. The handler
 * bodies are removed from the client bundle, so the database functions in
 * `registry-entry-editor.server.ts` never reach the browser. The validators
 * here only check the shape of the request; the writers check the fields.
 */

import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../../db.ts";
import { deskMiddleware } from "../desk-auth.ts";
import {
  getRegistryEntryDetail,
  saveContactIn,
  saveOrganizationDetailsIn,
  saveServiceDetailsIn,
  type EntrySaveResult,
  type RegistryEntryDetail,
  type SaveContactInput,
} from "./registry-entry-editor.server.ts";

function serviceIdOf(input: unknown): number {
  const serviceId = Number((input as { serviceId?: unknown } | null)?.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    throw new Error("That entry could not be found. Nothing was changed.");
  }
  return serviceId;
}

/** One entry with its organization and contacts, for the editor. */
export const readRegistryEntryDetail = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number } => ({ serviceId: serviceIdOf(input) }))
  .handler(async ({ data, context }): Promise<RegistryEntryDetail> => {
    const sql = await getSql();
    const detail = await getRegistryEntryDetail(sql, context.newsroomId, data.serviceId);
    if (!detail) throw new Error("That entry is not in this newsroom.");
    return detail;
  });

/** Save the service's own details. */
export const saveRegistryServiceDetails = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number; fields: unknown } => ({
    serviceId: serviceIdOf(input),
    fields: (input as { fields?: unknown }).fields,
  }))
  .handler(async ({ data, context }): Promise<EntrySaveResult> => {
    const sql = await getSql();
    return saveServiceDetailsIn(sql, context.newsroomId, data.serviceId, data.fields, context.userId);
  });

/** Save the details of the entry's organization. */
export const saveRegistryOrganizationDetails = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number; fields: unknown } => ({
    serviceId: serviceIdOf(input),
    fields: (input as { fields?: unknown }).fields,
  }))
  .handler(async ({ data, context }): Promise<EntrySaveResult> => {
    const sql = await getSql();
    return saveOrganizationDetailsIn(
      sql,
      context.newsroomId,
      data.serviceId,
      data.fields,
      context.userId,
    );
  });

/** Add a contact to the entry, or change one of its contacts. */
export const saveRegistryContact = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number; contact: SaveContactInput } => {
    const raw = (input ?? {}) as { contactId?: unknown; scope?: unknown; fields?: unknown };
    const contactId =
      raw.contactId === undefined || raw.contactId === null ? null : Number(raw.contactId);
    if (contactId !== null && (!Number.isInteger(contactId) || contactId <= 0)) {
      throw new Error("That contact could not be found. Nothing was changed.");
    }
    return {
      serviceId: serviceIdOf(input),
      contact: {
        contactId,
        scope: raw.scope === "organization" ? "organization" : "service",
        fields: raw.fields,
      },
    };
  })
  .handler(async ({ data, context }): Promise<EntrySaveResult> => {
    const sql = await getSql();
    return saveContactIn(sql, context.newsroomId, data.serviceId, data.contact, context.userId);
  });
