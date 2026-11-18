/**
 * The fields the registry entry editor writes (spec 24, Phase 2, job C1): the
 * service's own details, its organization's details, and one contact.
 *
 * Pure and browser-safe. The server writers validate with these functions, so
 * what an editor is told is wrong is the same wherever the check runs. Every
 * problem is a plain sentence keyed by the field it belongs to, so the editor
 * knows which box to fix.
 */

export interface ServiceDetailFields {
  name: string;
  description: string;
  url: string;
  fees: string;
  applicationProcess: string;
  crisis: boolean;
}

export interface OrganizationDetailFields {
  name: string;
  alternateName: string;
  description: string;
  email: string;
  website: string;
  legalStatus: string;
}

export interface ContactDetailFields {
  name: string;
  role: string;
  department: string;
  phone: string;
  phoneExtension: string;
  email: string;
  website: string;
}

/** Plain-words problems, keyed by field name. */
export type FieldProblems = Record<string, string>;

export type Validated<T> = { ok: true; values: T } | { ok: false; problems: FieldProblems };

/** Where a contact belongs, as the editor sees it. */
export type ContactScope = "service" | "organization" | "location";

/** One other entry that uses a shared row. */
export interface SharedEntry {
  serviceId: number;
  /** "Organization — Service", as the desk lists entries. */
  name: string;
}

export const SERVICE_LIMITS = {
  name: 200,
  description: 2000,
  url: 2000,
  fees: 1000,
  applicationProcess: 2000,
} as const;

export const ORGANIZATION_LIMITS = {
  name: 200,
  alternateName: 200,
  description: 2000,
  email: 320,
  website: 2000,
  legalStatus: 200,
} as const;

export const CONTACT_LIMITS = {
  name: 200,
  role: 200,
  department: 200,
  phone: 60,
  phoneExtension: 20,
  email: 320,
  website: 2000,
} as const;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function asRecord(input: unknown): Record<string, unknown> {
  return (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
}

function checkLength(
  problems: FieldProblems,
  key: string,
  label: string,
  value: string,
  max: number,
) {
  if (value.length > max && !problems[key]) {
    problems[key] = `${label} is too long. Use ${max} characters or fewer.`;
  }
}

function checkUrl(problems: FieldProblems, key: string, label: string, value: string) {
  if (!value || problems[key]) return;
  let ok = /^https?:\/\/\S+$/i.test(value);
  if (ok) {
    try {
      new URL(value);
    } catch {
      ok = false;
    }
  }
  if (!ok) problems[key] = `${label} must be a full web address starting with https:// or http://.`;
}

function checkEmail(problems: FieldProblems, key: string, label: string, value: string) {
  if (!value || problems[key]) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    problems[key] = `${label} must look like name@example.org.`;
  }
}

export function validateServiceDetails(input: unknown): Validated<ServiceDetailFields> {
  const raw = asRecord(input);
  const values: ServiceDetailFields = {
    name: text(raw.name),
    description: text(raw.description),
    url: text(raw.url),
    fees: text(raw.fees),
    applicationProcess: text(raw.applicationProcess),
    crisis: raw.crisis === true,
  };
  const problems: FieldProblems = {};
  if (!values.name) problems.name = "Enter the service's name.";
  checkLength(problems, "name", "The service's name", values.name, SERVICE_LIMITS.name);
  checkLength(problems, "description", "The description", values.description, SERVICE_LIMITS.description);
  checkLength(problems, "url", "The web address", values.url, SERVICE_LIMITS.url);
  checkUrl(problems, "url", "The web address", values.url);
  checkLength(problems, "fees", "The fees", values.fees, SERVICE_LIMITS.fees);
  checkLength(
    problems,
    "applicationProcess",
    "The application process",
    values.applicationProcess,
    SERVICE_LIMITS.applicationProcess,
  );
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, values };
}

export function validateOrganizationDetails(input: unknown): Validated<OrganizationDetailFields> {
  const raw = asRecord(input);
  const values: OrganizationDetailFields = {
    name: text(raw.name),
    alternateName: text(raw.alternateName),
    description: text(raw.description),
    email: text(raw.email),
    website: text(raw.website),
    legalStatus: text(raw.legalStatus),
  };
  const problems: FieldProblems = {};
  if (!values.name) problems.name = "Enter the organization's name.";
  checkLength(problems, "name", "The organization's name", values.name, ORGANIZATION_LIMITS.name);
  checkLength(problems, "alternateName", "The other name", values.alternateName, ORGANIZATION_LIMITS.alternateName);
  checkLength(problems, "description", "The description", values.description, ORGANIZATION_LIMITS.description);
  checkLength(problems, "email", "The email address", values.email, ORGANIZATION_LIMITS.email);
  checkEmail(problems, "email", "The email address", values.email);
  checkLength(problems, "website", "The website", values.website, ORGANIZATION_LIMITS.website);
  checkUrl(problems, "website", "The website", values.website);
  checkLength(problems, "legalStatus", "The legal status", values.legalStatus, ORGANIZATION_LIMITS.legalStatus);
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, values };
}

export function validateContactDetails(input: unknown): Validated<ContactDetailFields> {
  const raw = asRecord(input);
  const values: ContactDetailFields = {
    name: text(raw.name),
    role: text(raw.role),
    department: text(raw.department),
    phone: text(raw.phone),
    phoneExtension: text(raw.phoneExtension),
    email: text(raw.email),
    website: text(raw.website),
  };
  const problems: FieldProblems = {};
  if (!values.name && !values.phone && !values.email && !values.website) {
    problems.form = "Enter at least a name, a phone number, an email address or a website.";
  }
  checkLength(problems, "name", "The name", values.name, CONTACT_LIMITS.name);
  checkLength(problems, "role", "The role", values.role, CONTACT_LIMITS.role);
  checkLength(problems, "department", "The department", values.department, CONTACT_LIMITS.department);
  checkLength(problems, "phone", "The phone number", values.phone, CONTACT_LIMITS.phone);
  checkLength(problems, "phoneExtension", "The extension", values.phoneExtension, CONTACT_LIMITS.phoneExtension);
  if (values.phoneExtension && !values.phone && !problems.phoneExtension) {
    problems.phoneExtension = "An extension needs a phone number. Enter the phone number too.";
  }
  checkLength(problems, "email", "The email address", values.email, CONTACT_LIMITS.email);
  checkEmail(problems, "email", "The email address", values.email);
  checkLength(problems, "website", "The website", values.website, CONTACT_LIMITS.website);
  checkUrl(problems, "website", "The website", values.website);
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, values };
}

/** How many names the notice spells out before it says "and N more". */
export const SHARED_NAMES_SHOWN = 12;

/**
 * The words above a field group that belongs to a row other entries also use.
 * Null when nothing else uses it.
 */
export function sharedScopeNotice(sharedWith: readonly SharedEntry[]): string | null {
  if (sharedWith.length === 0) return null;
  const shown = sharedWith.slice(0, SHARED_NAMES_SHOWN).map((entry) => entry.name);
  const more = sharedWith.length - shown.length;
  const names = more > 0 ? `${shown.join("; ")}; and ${more} more` : shown.join("; ");
  const count = sharedWith.length;
  return `This is shared with ${count} other ${count === 1 ? "entry" : "entries"}: ${names}. A change here changes them too.`;
}
