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
  removeEntryRowIn,
  restoreEntryRowIn,
  saveContactIn,
  saveEntryRowIn,
  saveOrganizationDetailsIn,
  saveServiceDetailsIn,
  type EntrySaveResult,
  type RegistryEntryDetail,
  type RemoveRowInput,
  type SaveContactInput,
  type SaveRowInput,
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

function rowIdOf(raw: { rowId?: unknown }): number | null {
  if (raw.rowId === undefined || raw.rowId === null) return null;
  const rowId = Number(raw.rowId);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new Error("That row could not be found. Nothing was changed.");
  }
  return rowId;
}

/**
 * Add a place, hours, an eligibility rule, a required document, a language or
 * an accessibility note to the entry, or change one of them.
 */
export const saveRegistryRow = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown): { serviceId: number; row: SaveRowInput } => {
    const raw = (input ?? {}) as {
      kind?: unknown;
      rowId?: unknown;
      fields?: unknown;
      locationId?: unknown;
    };
    const locationId =
      raw.locationId === undefined || raw.locationId === null ? null : Number(raw.locationId);
    if (locationId !== null && (!Number.isInteger(locationId) || locationId <= 0)) {
      throw new Error("That place could not be found. Nothing was changed.");
    }
    return {
      serviceId: serviceIdOf(input),
      row: {
        kind: raw.kind as SaveRowInput["kind"],
        rowId: rowIdOf(raw),
        fields: raw.fields,
        locationId,
      },
    };
  })
  .handler(async ({ data, context }): Promise<EntrySaveResult> => {
    const sql = await getSql();
    return saveEntryRowIn(sql, context.newsroomId, data.serviceId, data.row, context.userId);
  });

function removeInput(input: unknown): { serviceId: number; row: RemoveRowInput } {
  const raw = (input ?? {}) as { kind?: unknown; rowId?: unknown };
  const rowId = rowIdOf(raw);
  if (rowId === null) throw new Error("That row could not be found. Nothing was changed.");
  return {
    serviceId: serviceIdOf(input),
    row: { kind: raw.kind as RemoveRowInput["kind"], rowId },
  };
}

/** Remove one row from the entry. A marker only: nothing is deleted. */
export const removeRegistryRow = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(removeInput)
  .handler(async ({ data, context }): Promise<EntrySaveResult> => {
    const sql = await getSql();
    return removeEntryRowIn(sql, context.newsroomId, data.serviceId, data.row, context.userId);
  });

/** Bring a removed row back to the entry. */
export const restoreRegistryRow = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(removeInput)
  .handler(async ({ data, context }): Promise<EntrySaveResult> => {
    const sql = await getSql();
    return restoreEntryRowIn(sql, context.newsroomId, data.serviceId, data.row, context.userId);
  });
