/**
 * Check an uploaded HSDS JSON file before anything is written. Pure: no
 * database, no I/O.
 *
 * `parseHsdsJson` takes the file's text and returns either an `HsdsBundle` or
 * a list of problems, each naming the record it is about, for example
 * `organizations[2].services[0]: name is missing`. It never throws on bad
 * input. JSON only.
 */

import type { HsdsBundle } from "./hsds-types.ts";

/** Same cap as the TownRecord import (src/components/townrecord-import.tsx). */
export const MAX_HSDS_JSON_BYTES = 8 * 1024 * 1024;

/** Stop listing after this many; a file this broken needs one fix pass, not a novel. */
const MAX_PROBLEMS = 50;

export type HsdsValidation =
  | { ok: true; bundle: HsdsBundle }
  | { ok: false; problems: string[] };

const STATUSES = new Set(["active", "inactive", "unverified"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Problems {
  readonly list: string[] = [];
  add(path: string, message: string): void {
    if (this.list.length < MAX_PROBLEMS) this.list.push(`${path}: ${message}`);
  }
}

function tooLarge(): HsdsValidation {
  return {
    ok: false,
    problems: ["file: the file is larger than 8 MiB. Choose a smaller file."],
  };
}

/** Parse the file's text, enforcing the size cap, then validate its shape. */
export function parseHsdsJson(text: string): HsdsValidation {
  // Every UTF-16 code unit takes at least one UTF-8 byte, so text longer than
  // the cap is over it already and needs no encoding.
  if (typeof text === "string" && text.length > MAX_HSDS_JSON_BYTES) return tooLarge();
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, problems: ["file: the file is empty"] };
  }
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_HSDS_JSON_BYTES) return tooLarge();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "it is not valid JSON";
    return { ok: false, problems: [`file: this is not valid JSON (${detail})`] };
  }
  return validateHsdsBundle(parsed);
}

/** Validate an already-parsed JSON value. */
export function validateHsdsBundle(value: unknown): HsdsValidation {
  const problems = new Problems();
  if (!isObject(value)) {
    problems.add("file", "expected a JSON object with an organizations list");
    return { ok: false, problems: problems.list };
  }
  if (!Array.isArray(value.organizations)) {
    problems.add("organizations", "is missing or is not a list");
    return { ok: false, problems: problems.list };
  }
  if (value.taxonomies !== undefined && !Array.isArray(value.taxonomies)) {
    problems.add("taxonomies", "is not a list");
    return { ok: false, problems: problems.list };
  }

  const seen = new Map<string, Set<string>>();
  const note = (kind: string, path: string, id: string): void => {
    let ids = seen.get(kind);
    if (!ids) seen.set(kind, (ids = new Set()));
    if (ids.has(id)) problems.add(path, `id "${id}" is used twice in ${kind}`);
    ids.add(id);
  };

  const taxonomyIds = new Set<string>();
  const locationIds = new Set<string>();
  const scheduleIds = new Set<string>();
  // References are checked after every id is known, so order in the file does not matter.
  const refs: { path: string; message: string; set: Set<string>; id: string }[] = [];

  const text = (obj: Obj, key: string, path: string): void => {
    const v = obj[key];
    if (v !== undefined && v !== null && typeof v !== "string") {
      problems.add(path, `${key} must be text`);
    }
  };
  const flag = (obj: Obj, key: string, path: string): void => {
    const v = obj[key];
    if (v !== undefined && v !== null && typeof v !== "boolean") {
      problems.add(path, `${key} must be true or false`);
    }
  };
  const required = (obj: Obj, key: string, path: string): string | null => {
    const v = obj[key];
    if (typeof v !== "string" || v.trim() === "") {
      problems.add(path, `${key} is missing`);
      return null;
    }
    return v;
  };
  const status = (obj: Obj, path: string): void => {
    const v = obj.status;
    if (v === undefined || v === null) return;
    if (typeof v !== "string" || !STATUSES.has(v)) {
      problems.add(path, `status "${String(v)}" is not one of active, inactive, unverified`);
    }
  };
  /** The objects in a nested list, each with its own path. */
  const items = (obj: Obj, key: string, path: string): { item: Obj; path: string }[] => {
    const v = obj[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      problems.add(`${path}.${key}`, "is not a list");
      return [];
    }
    const out: { item: Obj; path: string }[] = [];
    v.forEach((item, index) => {
      if (isObject(item)) out.push({ item, path: `${path}.${key}[${index}]` });
      else problems.add(`${path}.${key}[${index}]`, "is not an object");
    });
    return out;
  };

  const phones = (obj: Obj, path: string, parentId: string | null): void => {
    items(obj, "phones", path).forEach(({ item, path: p }, index) => {
      const explicit = item.id;
      if (explicit !== undefined && explicit !== null && typeof explicit !== "string") {
        problems.add(p, "id must be text");
      }
      const id = typeof explicit === "string" && explicit ? explicit : `${parentId ?? ""}:phone:${index}`;
      if (parentId !== null) note("contacts", p, id);
      for (const key of ["name", "role", "department", "phone", "phone_extension", "email", "website"]) {
        text(item, key, p);
      }
    });
  };

  const schedules = (obj: Obj, path: string): void => {
    for (const { item, path: p } of items(obj, "schedules", path)) {
      const id = required(item, "id", p);
      if (id) {
        note("schedules", p, id);
        scheduleIds.add(id);
      }
      flag(item, "by_appointment", p);
      text(item, "days", p);
      text(item, "notes", p);
      for (const key of ["opens_at", "closes_at"]) {
        const v = item[key];
        if (v === undefined || v === null) continue;
        if (typeof v !== "string" || !TIME.test(v)) {
          problems.add(p, `${key} "${String(v)}" must look like 09:00 or 17:30`);
        }
      }
    }
  };

  const accessibilities = (obj: Obj, path: string): void => {
    for (const { item, path: p } of items(obj, "accessibilities", path)) {
      const id = required(item, "id", p);
      if (id) note("accessibilities", p, id);
      required(item, "accessibility", p);
      text(item, "details", p);
    }
  };

  // Taxonomies first: parents and services point at them.
  const taxonomyList = Array.isArray(value.taxonomies) ? (value.taxonomies as unknown[]) : [];
  taxonomyList.forEach((raw, index) => {
    const path = `taxonomies[${index}]`;
    if (!isObject(raw)) {
      problems.add(path, "is not an object");
      return;
    }
    const id = required(raw, "id", path);
    required(raw, "name", path);
    if (id) {
      note("taxonomies", path, id);
      taxonomyIds.add(id);
    }
  });
  taxonomyList.forEach((raw, index) => {
    if (!isObject(raw)) return;
    const parent = raw.parent_id;
    if (parent === undefined || parent === null) return;
    const path = `taxonomies[${index}]`;
    if (typeof parent !== "string") problems.add(path, "parent_id must be text");
    else refs.push({ path, message: `parent_id "${parent}" is not a taxonomy in this file`, set: taxonomyIds, id: parent });
  });

  (value.organizations as unknown[]).forEach((rawOrg, orgIndex) => {
    const orgPath = `organizations[${orgIndex}]`;
    if (!isObject(rawOrg)) {
      problems.add(orgPath, "is not an object");
      return;
    }
    const orgId = required(rawOrg, "id", orgPath);
    required(rawOrg, "name", orgPath);
    if (orgId) note("organizations", orgPath, orgId);
    status(rawOrg, orgPath);
    for (const key of ["alternate_name", "description", "email", "website", "legal_status"]) {
      text(rawOrg, key, orgPath);
    }
    phones(rawOrg, orgPath, orgId);

    for (const { item: svc, path } of items(rawOrg, "services", orgPath)) {
      const id = required(svc, "id", path);
      required(svc, "name", path);
      if (id) note("services", path, id);
      status(svc, path);
      for (const key of ["description", "url", "fees", "application_process"]) text(svc, key, path);
      flag(svc, "crisis", path);
      const taxonomy = svc.taxonomy_id;
      if (taxonomy !== undefined && taxonomy !== null) {
        if (typeof taxonomy !== "string") problems.add(path, "taxonomy_id must be text");
        else refs.push({ path, message: `taxonomy_id "${taxonomy}" is not a taxonomy in this file`, set: taxonomyIds, id: taxonomy });
      }
      phones(svc, path, id);
      schedules(svc, path);
      accessibilities(svc, path);

      for (const { item, path: p } of items(svc, "eligibilities", path)) {
        const eid = required(item, "id", p);
        if (eid) note("eligibilities", p, eid);
        text(item, "description", p);
        const criteria = item.criteria;
        if (criteria !== undefined && criteria !== null && !isObject(criteria)) {
          problems.add(p, "criteria must be an object");
        }
      }
      for (const { item, path: p } of items(svc, "required_documents", path)) {
        const did = required(item, "id", p);
        if (did) note("required_documents", p, did);
        required(item, "document", p);
        text(item, "description", p);
        flag(item, "required", p);
      }
      for (const { item, path: p } of items(svc, "languages", path)) {
        const lid = required(item, "id", p);
        if (lid) note("languages", p, lid);
        required(item, "language", p);
        text(item, "note", p);
      }
      for (const { item, path: p } of items(svc, "service_at_locations", path)) {
        const sid = required(item, "id", p);
        if (sid) note("service_at_locations", p, sid);
        const location = required(item, "location_id", p);
        if (location) {
          refs.push({ path: p, message: `location_id "${location}" is not a location in this file`, set: locationIds, id: location });
        }
        text(item, "description", p);
        const schedule = item.schedule_id;
        if (schedule !== undefined && schedule !== null) {
          if (typeof schedule !== "string") problems.add(p, "schedule_id must be text");
          else refs.push({ path: p, message: `schedule_id "${schedule}" is not a schedule in this file`, set: scheduleIds, id: schedule });
        }
      }
    }

    for (const { item: loc, path } of items(rawOrg, "locations", orgPath)) {
      const id = required(loc, "id", path);
      if (id) {
        note("locations", path, id);
        locationIds.add(id);
      }
      status(loc, path);
      for (const key of [
        "name",
        "description",
        "address_1",
        "address_2",
        "city",
        "state_province",
        "postal_code",
        "country",
        "accessibility_notes",
        "transportation_notes",
      ]) {
        text(loc, key, path);
      }
      for (const [key, limit] of [
        ["latitude", 90],
        ["longitude", 180],
      ] as const) {
        const v = loc[key];
        if (v === undefined || v === null) continue;
        if (typeof v !== "number" || !Number.isFinite(v)) {
          problems.add(path, `${key} must be a number`);
        } else if (v < -limit || v > limit) {
          problems.add(path, `${key} ${v} is outside -${limit} to ${limit}`);
        }
      }
      phones(loc, path, id);
      schedules(loc, path);
      accessibilities(loc, path);
    }
  });

  for (const ref of refs) {
    if (!ref.set.has(ref.id)) problems.add(ref.path, ref.message);
  }

  if (problems.list.length) return { ok: false, problems: problems.list };
  return { ok: true, bundle: value as unknown as HsdsBundle };
}
