/**
 * Explicit verification of a registry entry (spec 24, Phase 3).
 *
 * An editor who checked an entry records how they checked it and on what basis.
 * The record keeps a snapshot of the entry's key facts at that moment, so the
 * desk can later say which key facts differ from what was checked. A save, a
 * publish, an update or a proposal accept never verifies anything.
 *
 * Key facts (and only these): the service's status, fees and application
 * process; the organization's name; each live linked place's name and address;
 * the live phones and the place each belongs to; the live hours; eligibility;
 * required documents. Descriptions, notes, languages and accessibility are not
 * key facts, so a spelling change in a description is not a changed fact. A row
 * an editor removed (`removed_at` set) is not part of the facts. Only what the
 * public page can show counts for phones, places and hours: a row that is not
 * published, and a place that is not published and active, are not facts until
 * they are. Eligibility and required documents count while they are not removed,
 * published or not, because the public page does not show them.
 */

import { withTransaction, type Sql } from "../../db.ts";
import { recordRegistryEvent } from "./registry-audit.server.ts";
import { hasControlCharacter } from "./registry-entry-editor-fields.ts";
import {
  isVerifyMethod,
  VERIFY_AFTER_DAYS,
  VERIFY_METHODS,
  verifyMethodWords,
} from "./registry-verify-methods.ts";

export { VERIFY_AFTER_DAYS } from "./registry-verify-methods.ts";

export const VERIFY_BASIS_MAX = 2000;
export const VERIFY_SOURCE_URL_MAX = 2000;
export const VERIFY_HISTORY_MAX = 50;

const NOT_IN_NEWSROOM = "That entry is not in this newsroom. Nothing was changed.";
/** The one changed-fact name when a stored check cannot be read as a snapshot. */
const UNREADABLE_CHECK = "saved check could not be read";
/**
 * Characters a reader cannot see that change how text runs: the zero-width
 * space, the direction marks and bidi controls, invisible operators, the byte
 * order mark. The zero-width joiner and non-joiner are not here: Persian, Urdu
 * and Indic scripts need the non-joiner, and emoji sequences need the joiner.
 * Line breaks are not here either.
 */
const HIDDEN_CHARACTER = /[\u200B\u200E\u200F\u061C\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

type When = string | Date | null;

export interface KeyPlace {
  id: number;
  name: string | null;
  address: string | null;
}

export interface KeyPhone {
  /** The place's location id, or null for the service's or organization's own line. */
  placeId: number | null;
  scope: "service" | "organization" | "place";
  phone: string;
  extension: string | null;
}

export interface KeyHours {
  placeId: number | null;
  byAppointment: boolean;
  days: string | null;
  opensAt: string | null;
  closesAt: string | null;
}

export interface KeyFacts {
  version: 1;
  service: { status: string; fees: string | null; applicationProcess: string | null };
  organization: { name: string };
  places: KeyPlace[];
  phones: KeyPhone[];
  hours: KeyHours[];
  eligibility: { description: string | null; criteria: string }[];
  requiredDocuments: { document: string; required: boolean }[];
}

/** Sort entries by their JSON text, so the order never depends on row ids. */
function stableSorted<T>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = stableJson(a);
    const right = stableJson(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** JSON with keys in sorted order, so equal jsonb values give equal text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

function joinAddress(parts: (string | null | undefined)[]): string | null {
  const kept = parts.map((part) => (part ?? "").trim()).filter(Boolean);
  return kept.length ? kept.join(", ") : null;
}

/**
 * The service's key facts now. Newsroom-scoped; throws when the service is not
 * in this newsroom. Reads only, in a stable order, so an unchanged entry gives
 * an identical snapshot.
 */
export async function readKeyFacts(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
): Promise<KeyFacts> {
  const service = await sql.query<{
    organization_id: number;
    status: string;
    fees: string | null;
    application_process: string | null;
    organization_name: string;
  }>(
    `select s.organization_id, s.status, s.fees, s.application_process,
            o.name as organization_name
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
      where s.id = $1 and s.newsroom_id = $2`,
    [serviceId, newsroomId],
  );
  if (!service[0]) throw new Error(NOT_IN_NEWSROOM);
  const organizationId = Number(service[0].organization_id);

  const placeRows = await sql.query<{
    location_id: number;
    name: string | null;
    address_1: string | null;
    address_2: string | null;
    city: string | null;
    state_province: string | null;
    postal_code: string | null;
  }>(
    `select distinct l.id as location_id, l.name, l.address_1, l.address_2, l.city,
            l.state_province, l.postal_code
       from service_at_locations sal
       join locations l on l.id = sal.location_id and l.newsroom_id = sal.newsroom_id
      where sal.newsroom_id = $1 and sal.service_id = $2 and sal.removed_at is null
        and sal.published = true and l.published = true and l.status = 'active'`,
    [newsroomId, serviceId],
  );
  const places: KeyPlace[] = placeRows
    .map((row) => ({
      id: Number(row.location_id),
      name: clean(row.name),
      address: joinAddress([
        row.address_1,
        row.address_2,
        row.city,
        row.state_province,
        row.postal_code,
      ]),
    }))
    .sort((a, b) => a.id - b.id);
  const placeIds = places.map((place) => place.id);

  const contactRows = await sql.query<{
    organization_id: number | null;
    service_id: number | null;
    location_id: number | null;
    phone: string;
    phone_extension: string | null;
  }>(
    `select organization_id, service_id, location_id, phone, phone_extension
       from contacts
      where newsroom_id = $1 and published = true and removed_at is null
        and phone is not null and btrim(phone) <> ''
        and ((service_id = $2 and (location_id is null or location_id = any($4::int[])))
             or (service_id is null and location_id is null and organization_id = $3)
             or (service_id is null and location_id = any($4::int[])))`,
    [newsroomId, serviceId, organizationId, placeIds],
  );
  const phones: KeyPhone[] = stableSorted(
    contactRows.map((row): KeyPhone => {
      const locationId = row.location_id == null ? null : Number(row.location_id);
      const scope: KeyPhone["scope"] =
        locationId != null
          ? "place"
          : row.service_id != null
            ? "service"
            : "organization";
      return {
        placeId: locationId,
        scope,
        phone: row.phone.trim(),
        extension: clean(row.phone_extension),
      };
    }),
  );

  // A link counts only when its place is shown. A schedule of this service that
  // is linked only to a hidden place stays service-wide, as on the public page.
  const scheduleRows = await sql.query<{
    location_id: number | null;
    by_appointment: boolean;
    days: string | null;
    opens_at: string | null;
    closes_at: string | null;
  }>(
    `select coalesce(sch.location_id, ref.location_id) as location_id,
            sch.by_appointment, sch.days, sch.opens_at, sch.closes_at
       from schedules sch
       left join (
         select schedule_id, min(location_id) as location_id
           from service_at_locations
          where newsroom_id = $1 and service_id = $2
            and removed_at is null and published = true and schedule_id is not null
            and location_id = any($3::int[])
          group by schedule_id
       ) ref on ref.schedule_id = sch.id
      where sch.newsroom_id = $1 and sch.published = true and sch.removed_at is null
        and (sch.service_id = $2 or ref.schedule_id is not null)`,
    [newsroomId, serviceId, placeIds],
  );
  const hours: KeyHours[] = stableSorted(
    scheduleRows
      .map((row): KeyHours => ({
        placeId: row.location_id == null ? null : Number(row.location_id),
        byAppointment: Boolean(row.by_appointment),
        days: clean(row.days),
        opensAt: clean(row.opens_at),
        closesAt: clean(row.closes_at),
      }))
      // Hours tied to a place that is not shown here are not live under it.
      .filter((row) => row.placeId == null || placeIds.includes(row.placeId)),
  );

  // Eligibility and required documents are not gated on published: the public
  // page does not read them, and an imported or added row starts unpublished.
  const eligibilityRows = await sql.query<{ description: string | null; criteria: unknown }>(
    `select description, criteria from eligibilities
      where newsroom_id = $1 and service_id = $2 and removed_at is null`,
    [newsroomId, serviceId],
  );
  const eligibility = stableSorted(
    eligibilityRows.map((row) => ({
      description: clean(row.description),
      criteria: stableJson(
        typeof row.criteria === "string" ? JSON.parse(row.criteria) : (row.criteria ?? {}),
      ),
    })),
  );

  const documentRows = await sql.query<{ document: string; required: boolean }>(
    `select document, required from required_documents
      where newsroom_id = $1 and service_id = $2 and removed_at is null`,
    [newsroomId, serviceId],
  );
  const requiredDocuments = stableSorted(
    documentRows.map((row) => ({ document: row.document.trim(), required: Boolean(row.required) })),
  );

  return {
    version: 1,
    service: {
      status: service[0].status,
      fees: clean(service[0].fees),
      applicationProcess: clean(service[0].application_process),
    },
    organization: { name: service[0].organization_name.trim() },
    places,
    phones,
    hours,
    eligibility,
    requiredDocuments,
  };
}

function placeLabel(places: KeyPlace[], placeId: number): string {
  const place = places.find((candidate) => candidate.id === placeId);
  return place?.name ?? place?.address ?? "a place";
}

/**
 * Plain names of the key facts that differ between two snapshots, in a fixed
 * order: "status", "fees", "application process", "organization name", places,
 * then "phone" / "phone at <place>", "hours" / "hours at <place>",
 * "eligibility", "required documents".
 */
export function diffKeyFacts(before: KeyFacts, after: KeyFacts): string[] {
  const changed: string[] = [];
  if (before.service.status !== after.service.status) changed.push("status");
  if (before.service.fees !== after.service.fees) changed.push("fees");
  if (before.service.applicationProcess !== after.service.applicationProcess) {
    changed.push("application process");
  }
  if (before.organization.name !== after.organization.name) changed.push("organization name");

  const placeIds = [...new Set([...before.places, ...after.places].map((p) => p.id))].sort(
    (a, b) => a - b,
  );
  for (const id of placeIds) {
    const was = before.places.find((p) => p.id === id);
    const now = after.places.find((p) => p.id === id);
    if (!was || !now) {
      changed.push(`place ${placeLabel(was ? before.places : after.places, id)}`);
    } else if (was.name !== now.name || was.address !== now.address) {
      changed.push(`address of ${placeLabel(before.places, id)}`);
    }
  }

  const groups = (facts: KeyFacts, key: "phones" | "hours") => {
    const map = new Map<string, string[]>();
    for (const row of facts[key]) {
      const group =
        row.placeId != null ? `p${row.placeId}` : "scope" in row ? row.scope : "";
      map.set(group, [...(map.get(group) ?? []), stableJson(row)]);
    }
    for (const list of map.values()) list.sort();
    return map;
  };
  for (const [key, word] of [
    ["phones", "phone"],
    ["hours", "hours"],
  ] as const) {
    const was = groups(before, key);
    const now = groups(after, key);
    // The entry's own lines first, then each place in id order.
    const isPlace = (name: string) => /^p\d+$/.test(name);
    const names = [...new Set([...was.keys(), ...now.keys()])].sort(
      (a, b) =>
        Number(isPlace(a)) - Number(isPlace(b)) ||
        (isPlace(a) && isPlace(b) ? Number(a.slice(1)) - Number(b.slice(1)) : a.localeCompare(b)),
    );
    for (const name of names) {
      if (JSON.stringify(was.get(name) ?? []) === JSON.stringify(now.get(name) ?? [])) continue;
      if (name.startsWith("p")) {
        const id = Number(name.slice(1));
        const places = after.places.some((p) => p.id === id) ? after.places : before.places;
        changed.push(`${word} at ${placeLabel(places, id)}`);
      } else if (name === "organization") {
        changed.push(`${word} of the organization`);
      } else {
        changed.push(word);
      }
    }
  }

  if (stableJson(before.eligibility) !== stableJson(after.eligibility)) {
    changed.push("eligibility");
  }
  if (stableJson(before.requiredDocuments) !== stableJson(after.requiredDocuments)) {
    changed.push("required documents");
  }
  return [...new Set(changed)];
}

export interface RecordVerificationInput {
  serviceId: number;
  method: string;
  basis: string;
  sourceUrl?: string | null;
}

export type VerificationProblems = Partial<Record<"method" | "basis" | "sourceUrl", string>>;

export type RecordVerificationResult =
  | { ok: true; verificationId: number; message: string }
  | { ok: false; problems: VerificationProblems };

function checkSourceUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when the address carries a user name or a password (user:pw@host). */
function hasCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return url.username !== "" || url.password !== "";
  } catch {
    return false;
  }
}

/**
 * Record that an editor checked one entry. Writes one `resource_verifications`
 * row with the key-facts snapshot and one audit event, in one transaction.
 * An entry from another newsroom throws and nothing is written; a bad method,
 * basis or address returns the problems and nothing is written.
 */
export async function recordVerificationIn(
  sql: Sql,
  newsroomId: number,
  userId: string,
  input: RecordVerificationInput,
): Promise<RecordVerificationResult> {
  return withTransaction(async (tx) => {
    const found = await tx.query<{ id: number; name: string }>(
      "select id, name from services where id = $1 and newsroom_id = $2 for update",
      [input.serviceId, newsroomId],
    );
    if (!found[0]) throw new Error(NOT_IN_NEWSROOM);
    const serviceId = Number(found[0].id);

    const problems: VerificationProblems = {};
    if (!isVerifyMethod(input.method)) {
      problems.method = `Choose how it was checked: ${VERIFY_METHODS.join(", ")}.`;
    }
    const basis = typeof input.basis === "string" ? input.basis.trim() : "";
    if (basis === "") {
      problems.basis = "Say what you checked and where you saw it.";
    } else if (basis.length > VERIFY_BASIS_MAX) {
      problems.basis = `The basis is too long. Use ${VERIFY_BASIS_MAX} characters or fewer.`;
    } else if (hasControlCharacter(basis, true)) {
      problems.basis = "The basis contains a character that cannot be saved. Remove it and try again.";
    } else if (HIDDEN_CHARACTER.test(basis)) {
      problems.basis =
        "The basis contains a hidden character, such as a direction mark. Remove it and try again.";
    }
    const sourceUrl =
      typeof input.sourceUrl === "string" && input.sourceUrl.trim() !== ""
        ? input.sourceUrl.trim()
        : null;
    if (input.sourceUrl != null && typeof input.sourceUrl !== "string") {
      problems.sourceUrl = "The web address must be text.";
    } else if (sourceUrl && sourceUrl.length > VERIFY_SOURCE_URL_MAX) {
      problems.sourceUrl = `The web address is too long. Use ${VERIFY_SOURCE_URL_MAX} characters or fewer.`;
    } else if (sourceUrl && (hasControlCharacter(sourceUrl, false) || !checkSourceUrl(sourceUrl))) {
      problems.sourceUrl = "The web address must start with https:// or http://.";
    } else if (sourceUrl && hasCredentials(sourceUrl)) {
      problems.sourceUrl = "The web address must not include a user name or password.";
    }
    if (Object.keys(problems).length > 0) return { ok: false as const, problems };

    const facts = await readKeyFacts(tx, newsroomId, serviceId);
    const inserted = await tx.query<{ id: number }>(
      `insert into resource_verifications
         (newsroom_id, service_id, checked_by, method, basis, source_url, facts)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       returning id`,
      [newsroomId, serviceId, userId, input.method, basis, sourceUrl, JSON.stringify(facts)],
    );
    await recordRegistryEvent(tx, {
      newsroomId,
      userId,
      action: "registry.service.verify",
      subjectKind: "registry-service",
      subjectId: serviceId,
      detail: `Verified "${found[0].name}" ${verifyMethodWords(input.method)}.`,
    });
    return {
      ok: true as const,
      verificationId: Number(inserted[0]!.id),
      message: "Verification recorded.",
    };
  });
}

export interface VerificationRecord {
  id: number;
  method: string;
  basis: string;
  sourceUrl: string | null;
  checkedAt: When;
  checkedBy: string;
}

export interface LegacyVerification {
  /** Set by a save or publish before Phase 3; not a check. Null means no legacy line. */
  at: When;
  method: string | null;
  by: string | null;
}

export interface EntryVerification {
  latest: VerificationRecord | null;
  /** Newest first, at most VERIFY_HISTORY_MAX. */
  history: VerificationRecord[];
  legacy: LegacyVerification | null;
  /** Names of key facts that differ from the latest snapshot; empty when none. */
  changedFacts: string[];
}

interface VerificationRow {
  id: number;
  method: string;
  basis: string;
  source_url: string | null;
  checked_at: When;
  checked_by: string;
  facts: unknown;
}

function toRecord(row: VerificationRow): VerificationRecord {
  return {
    id: Number(row.id),
    method: row.method,
    basis: row.basis,
    sourceUrl: row.source_url,
    checkedAt: row.checked_at,
    checkedBy: row.checked_by,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A stored check's snapshot as key facts. Null when the stored value is not a
 * version 1 snapshot with its arrays (a row this code did not write, or a later
 * version), so the caller can list the check as changed instead of throwing.
 */
function readSavedFacts(value: unknown): KeyFacts | null {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null;
  const { service, organization } = parsed;
  if (!isRecord(service) || typeof service.status !== "string") return null;
  if (!isRecord(organization) || typeof organization.name !== "string") return null;
  const lists = [
    parsed.places,
    parsed.phones,
    parsed.hours,
    parsed.eligibility,
    parsed.requiredDocuments,
  ];
  if (!lists.every((list) => Array.isArray(list) && list.every(isRecord))) return null;
  return parsed as unknown as KeyFacts;
}

/**
 * Key facts that differ from a stored check's snapshot. A snapshot that cannot
 * be read counts as one changed fact, the plain words for that.
 */
async function changedSinceSaved(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
  saved: unknown,
): Promise<string[]> {
  const before = readSavedFacts(saved);
  if (!before) return [UNREADABLE_CHECK];
  return diffKeyFacts(before, await readKeyFacts(sql, newsroomId, serviceId));
}

/** Latest check, history, the legacy stamp and the facts changed since. */
export async function readVerificationIn(
  sql: Sql,
  newsroomId: number,
  serviceId: number,
): Promise<EntryVerification> {
  const service = await sql.query<{
    last_verified_at: When;
    verification_method: string | null;
    last_verified_by: string | null;
  }>(
    `select last_verified_at, verification_method, last_verified_by
       from services where id = $1 and newsroom_id = $2`,
    [serviceId, newsroomId],
  );
  if (!service[0]) throw new Error(NOT_IN_NEWSROOM);

  const rows = await sql.query<VerificationRow>(
    `select id, method, basis, source_url, checked_at, checked_by, facts
       from resource_verifications
      where newsroom_id = $1 and service_id = $2
      order by checked_at desc, id desc
      limit ${VERIFY_HISTORY_MAX}`,
    [newsroomId, serviceId],
  );

  // A legacy line is shown only with its date: a method or editor with no date
  // is not something the desk can date, so it is not shown at all.
  const legacyRow = service[0];
  const legacy: LegacyVerification | null = legacyRow.last_verified_at
    ? {
        at: legacyRow.last_verified_at,
        method: legacyRow.verification_method,
        by: legacyRow.last_verified_by,
      }
    : null;

  let changedFacts: string[] = [];
  if (rows[0]) {
    changedFacts = await changedSinceSaved(sql, newsroomId, serviceId, rows[0].facts);
  }
  return {
    latest: rows[0] ? toRecord(rows[0]) : null,
    history: rows.map(toRecord),
    legacy,
    changedFacts,
  };
}

export interface NeedsCheckingItem {
  serviceId: number;
  serviceName: string;
  organizationName: string;
  /** When it was last checked; null when it never was. */
  lastCheckedAt: When;
  /** Why it is listed, in plain words (one or more). */
  reasons: string[];
}

/**
 * Published entries an editor should check: never verified, last verified more
 * than VERIFY_AFTER_DAYS ago, or with key facts changed since the last check.
 * Never-verified first, then oldest check first.
 */
export async function listNeedsCheckingIn(
  sql: Sql,
  newsroomId: number,
): Promise<NeedsCheckingItem[]> {
  const rows = await sql.query<{
    service_id: number;
    service_name: string;
    organization_name: string;
    checked_at: When;
    facts: unknown;
    overdue: boolean | null;
  }>(
    `select s.id as service_id, s.name as service_name, o.name as organization_name,
            v.checked_at, v.facts,
            (v.checked_at < now() - ($2::int * interval '1 day')) as overdue
       from services s
       join organizations o
         on o.id = s.organization_id and o.newsroom_id = s.newsroom_id
       left join lateral (
         select checked_at, facts from resource_verifications rv
          where rv.newsroom_id = s.newsroom_id and rv.service_id = s.id
          order by rv.checked_at desc, rv.id desc
          limit 1
       ) v on true
      where s.newsroom_id = $1 and s.published = true`,
    [newsroomId, VERIFY_AFTER_DAYS],
  );

  const items: NeedsCheckingItem[] = [];
  for (const row of rows) {
    const serviceId = Number(row.service_id);
    const reasons: string[] = [];
    if (!row.checked_at) {
      reasons.push("Never verified");
    } else {
      if (row.overdue) reasons.push(`Last verified more than ${VERIFY_AFTER_DAYS} days ago`);
      const changed = await changedSinceSaved(sql, newsroomId, serviceId, row.facts);
      if (changed.length > 0) reasons.push(`Changed since verified: ${changed.join(", ")}`);
    }
    if (reasons.length === 0) continue;
    items.push({
      serviceId,
      serviceName: row.service_name,
      organizationName: row.organization_name,
      lastCheckedAt: row.checked_at,
      reasons,
    });
  }

  const time = (when: When): number => (when ? new Date(when).getTime() : 0);
  const never = (item: NeedsCheckingItem): number => (item.lastCheckedAt ? 1 : 0);
  return items.sort(
    (a, b) =>
      never(a) - never(b) ||
      time(a.lastCheckedAt) - time(b.lastCheckedAt) ||
      a.serviceName.localeCompare(b.serviceName) ||
      a.serviceId - b.serviceId,
  );
}
