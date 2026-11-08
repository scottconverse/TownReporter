/**
 * The fields the registry desk lets an editor write (spec 24, Phase 1, add
 * edit and take down).
 *
 * The same seven fields an entry shows on the desk: the organization's name,
 * the service's name, its category, its phone, its description, and the page
 * an editor read it from. Pure and browser-safe: the desk route imports the
 * types, and both the server functions and the writers in
 * `registry-desk-write.server.ts` import the normaliser so the words an editor
 * sees for a missing field are the same wherever the check runs.
 */

/** The directory name the desk's own rows are written under. */
export const DESK_DIRECTORY = "TownReporter desk";

export interface RegistryEntryFields {
  organizationName: string;
  serviceName: string;
  categoryName: string;
  phone: string;
  description: string;
  sourceTitle: string;
  sourceUrl: string;
}

/** A slug for an HSDS id: lower case, letters and digits, single dashes. */
export function deskSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Trim the seven fields and refuse the four that an entry cannot do without.
 *
 * Phone and description may be empty; organization name, service name,
 * category and source URL may not. Each missing field has its own sentence so
 * the editor knows which box to fill rather than only that something is wrong.
 */
export function normalizeRegistryEntryFields(input: unknown): RegistryEntryFields {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

  const fields: RegistryEntryFields = {
    organizationName: text(raw.organizationName),
    serviceName: text(raw.serviceName),
    categoryName: text(raw.categoryName),
    phone: text(raw.phone),
    description: text(raw.description),
    sourceTitle: text(raw.sourceTitle),
    sourceUrl: text(raw.sourceUrl),
  };

  if (!fields.organizationName) {
    throw new Error("Enter the organization's name. Nothing was saved.");
  }
  if (!fields.serviceName) {
    throw new Error("Enter the service's name. Nothing was saved.");
  }
  if (!fields.categoryName) {
    throw new Error("Enter a category. Nothing was saved.");
  }
  if (!fields.sourceUrl) {
    throw new Error("Enter the source URL. Nothing was saved.");
  }
  if (!/^https?:\/\//i.test(fields.sourceUrl)) {
    throw new Error("The source URL must start with https:// or http://. Nothing was saved.");
  }
  return fields;
}
