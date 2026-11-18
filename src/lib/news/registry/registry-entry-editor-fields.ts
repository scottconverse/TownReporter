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

/**
 * True when the text holds a control character. Tab, line feed and carriage
 * return are allowed only in a multi-line field; NUL is never allowed (Postgres
 * refuses it, and the save would fail with a database error instead of a
 * sentence).
 */
function hasControlCharacter(value: string, multiline: boolean): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      if (!multiline) return true;
    } else if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function checkText(
  problems: FieldProblems,
  key: string,
  label: string,
  value: string,
  max: number,
  multiline = false,
) {
  if (problems[key]) return;
  if (hasControlCharacter(value, multiline)) {
    problems[key] = `${label} contains a character that cannot be saved. Remove it and try again.`;
    return;
  }
  if (value.length > max) {
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
  checkText(problems, "name", "The service's name", values.name, SERVICE_LIMITS.name);
  checkText(problems, "description", "The description", values.description, SERVICE_LIMITS.description, true);
  checkText(problems, "url", "The web address", values.url, SERVICE_LIMITS.url);
  checkUrl(problems, "url", "The web address", values.url);
  checkText(problems, "fees", "The fees", values.fees, SERVICE_LIMITS.fees);
  checkText(
    problems,
    "applicationProcess",
    "The application process",
    values.applicationProcess,
    SERVICE_LIMITS.applicationProcess,
    true,
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
  checkText(problems, "name", "The organization's name", values.name, ORGANIZATION_LIMITS.name);
  checkText(problems, "alternateName", "The other name", values.alternateName, ORGANIZATION_LIMITS.alternateName);
  checkText(problems, "description", "The description", values.description, ORGANIZATION_LIMITS.description, true);
  checkText(problems, "email", "The email address", values.email, ORGANIZATION_LIMITS.email);
  checkEmail(problems, "email", "The email address", values.email);
  checkText(problems, "website", "The website", values.website, ORGANIZATION_LIMITS.website);
  checkUrl(problems, "website", "The website", values.website);
  checkText(problems, "legalStatus", "The legal status", values.legalStatus, ORGANIZATION_LIMITS.legalStatus);
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
  checkText(problems, "name", "The name", values.name, CONTACT_LIMITS.name);
  checkText(problems, "role", "The role", values.role, CONTACT_LIMITS.role);
  checkText(problems, "department", "The department", values.department, CONTACT_LIMITS.department);
  checkText(problems, "phone", "The phone number", values.phone, CONTACT_LIMITS.phone);
  checkText(problems, "phoneExtension", "The extension", values.phoneExtension, CONTACT_LIMITS.phoneExtension);
  if (values.phoneExtension && !values.phone && !problems.phoneExtension) {
    problems.phoneExtension = "An extension needs a phone number. Enter the phone number too.";
  }
  checkText(problems, "email", "The email address", values.email, CONTACT_LIMITS.email);
  checkEmail(problems, "email", "The email address", values.email);
  checkText(problems, "website", "The website", values.website, CONTACT_LIMITS.website);
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

/*
  The rest of an entry's rows (job C2): places, hours, eligibility, required
  documents, languages and accessibility. Each is described once, here, so the
  box labels, the limits and the checks are the same in the editor and in the
  writer.
*/

/** The kinds of row the editor adds and changes besides the contact. */
export type RowKind =
  | "location"
  | "schedule"
  | "eligibility"
  | "requiredDocument"
  | "language"
  | "accessibility";

/** Every kind a row can be removed or restored as: the above and the contact. */
export type RemovableKind = RowKind | "contact";

export const REMOVABLE_KINDS: readonly RemovableKind[] = [
  "contact",
  "location",
  "schedule",
  "eligibility",
  "requiredDocument",
  "language",
  "accessibility",
];

export interface RowTextSpec {
  key: string;
  label: string;
  /** The box in a sentence: "The street address is too long." */
  noun: string;
  max: number;
  multiline?: boolean;
  /** The problem to show when the box is empty; absent when it may be empty. */
  required?: string;
}

export interface RowFlagSpec {
  key: string;
  label: string;
  /** What a new row starts with. */
  initial: boolean;
}

export interface RowSpec {
  /** What one row is called in the editor's sentences, with its article. */
  thing: string;
  text: readonly RowTextSpec[];
  flags: readonly RowFlagSpec[];
}

export type RowValues = Record<string, string | boolean>;

export const ROW_SPECS: Record<RowKind, RowSpec> = {
  location: {
    thing: "this place",
    text: [
      { key: "name", label: "Name of the place", noun: "The name of the place", max: 200 },
      { key: "address1", label: "Street address", noun: "The street address", max: 200 },
      { key: "address2", label: "Address line 2", noun: "The second address line", max: 200 },
      { key: "city", label: "City", noun: "The city", max: 100 },
      { key: "stateProvince", label: "State", noun: "The state", max: 100 },
      { key: "postalCode", label: "ZIP code", noun: "The ZIP code", max: 20 },
      {
        key: "accessibilityNotes",
        label: "Getting in (access notes)",
        noun: "The access notes",
        max: 1000,
        multiline: true,
      },
      {
        key: "transportationNotes",
        label: "Getting there (bus, parking)",
        noun: "The transportation notes",
        max: 1000,
        multiline: true,
      },
    ],
    flags: [],
  },
  schedule: {
    thing: "these hours",
    text: [
      { key: "days", label: "Days (for example Monday to Friday)", noun: "The days", max: 200 },
      { key: "opensAt", label: "Opens at", noun: "The opening time", max: 40 },
      { key: "closesAt", label: "Closes at", noun: "The closing time", max: 40 },
      { key: "notes", label: "Notes about the hours", noun: "The notes", max: 1000, multiline: true },
    ],
    flags: [{ key: "byAppointment", label: "By appointment only", initial: false }],
  },
  eligibility: {
    thing: "this eligibility rule",
    text: [
      {
        key: "description",
        label: "Who can use this service",
        noun: "The eligibility rule",
        max: 2000,
        multiline: true,
        required: "Say who can use the service.",
      },
    ],
    flags: [],
  },
  requiredDocument: {
    thing: "this required document",
    text: [
      {
        key: "document",
        label: "Document",
        noun: "The document",
        max: 200,
        required: "Enter the name of the document.",
      },
      { key: "description", label: "Details", noun: "The details", max: 1000, multiline: true },
    ],
    flags: [{ key: "required", label: "This document is required", initial: true }],
  },
  language: {
    thing: "this language",
    text: [
      {
        key: "language",
        label: "Language",
        noun: "The language",
        max: 100,
        required: "Enter the language.",
      },
      { key: "note", label: "Note", noun: "The note", max: 500 },
    ],
    flags: [],
  },
  accessibility: {
    thing: "this accessibility note",
    text: [
      {
        key: "accessibility",
        label: "Accessibility feature",
        noun: "The accessibility feature",
        max: 200,
        required: "Enter the accessibility feature.",
      },
      { key: "details", label: "Details", noun: "The details", max: 1000, multiline: true },
    ],
    flags: [],
  },
};

/** The sentence's noun for a removable row, for the confirm step. */
export const REMOVE_THING: Record<RemovableKind, string> = {
  contact: "this contact",
  location: ROW_SPECS.location.thing,
  schedule: ROW_SPECS.schedule.thing,
  eligibility: ROW_SPECS.eligibility.thing,
  requiredDocument: ROW_SPECS.requiredDocument.thing,
  language: ROW_SPECS.language.thing,
  accessibility: ROW_SPECS.accessibility.thing,
};

/** A new row's starting values: empty text, and each flag's own start. */
export function emptyRow(kind: RowKind): RowValues {
  const values: RowValues = {};
  for (const spec of ROW_SPECS[kind].text) values[spec.key] = "";
  for (const flag of ROW_SPECS[kind].flags) values[flag.key] = flag.initial;
  return values;
}

/**
 * Check one row. The input is the whole record (the stored values with the
 * editor's changes laid over them). A place needs a name or an address; hours
 * need days, times, a note or "By appointment".
 */
export function validateRow(kind: RowKind, input: unknown): Validated<RowValues> {
  const raw = asRecord(input);
  const spec = ROW_SPECS[kind];
  const values: RowValues = {};
  const problems: FieldProblems = {};
  for (const field of spec.text) {
    values[field.key] = text(raw[field.key]);
  }
  for (const flag of spec.flags) {
    values[flag.key] = raw[flag.key] === true;
  }
  for (const field of spec.text) {
    const value = values[field.key] as string;
    if (field.required && !value) {
      problems[field.key] = field.required;
      continue;
    }
    checkText(problems, field.key, field.noun, value, field.max, field.multiline === true);
  }
  const has = (key: string) => Boolean(values[key]);
  if (kind === "location" && !has("name") && !has("address1") && !has("city") && !has("postalCode")) {
    problems.form = "Enter at least the name of the place or its address.";
  }
  if (
    kind === "schedule" &&
    !values.byAppointment &&
    !has("days") &&
    !has("opensAt") &&
    !has("closesAt") &&
    !has("notes")
  ) {
    problems.form = "Enter the days or the hours, or choose By appointment only.";
  }
  return Object.keys(problems).length ? { ok: false, problems } : { ok: true, values };
}
