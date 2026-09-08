export const ROUTINE_NOTICE_FORMAT_KEYS = [
  "library-notice",
  "parks-recreation-notice",
  "community-arts-event-logistics",
  "registration-deadline",
  "waste-recycling-schedule",
  "public-meeting-logistics",
] as const;

/**
 * Pure structural contracts for routine-notice data. A valid result means the
 * supplied fields have the required shape; it does not verify their source,
 * truth, authority, publication eligibility, or current policy permission.
 */

export type RoutineNoticeFormatKey = (typeof ROUTINE_NOTICE_FORMAT_KEYS)[number];

export type RoutineField = { value: string; locator: string };

export type UnverifiedRoutineNoticeProvenance = {
  newsroomId: number;
  sourceId: number;
  sourceUrl: string;
  policyRevision: number;
  captureEventId: number;
  artifactVersionId: number;
  contentHash: string;
  externalId: string;
};

type CommonInput<K extends RoutineNoticeFormatKey, V extends string, F> = {
  formatKey: K;
  variant: V;
  provenance: UnverifiedRoutineNoticeProvenance;
  fields: F;
};

type WithTime = { timezone?: RoutineField };

export type RoutineNoticeInput =
  | CommonInput<
      "library-notice",
      "program",
      {
        issuer: RoutineField;
        program: RoutineField;
        start: RoutineField;
        location?: RoutineField;
        end?: RoutineField;
        participationUrl?: RoutineField;
        eventStatus?: RoutineField;
      } & WithTime
    >
  | CommonInput<
      "library-notice",
      "planned-hours",
      {
        issuer: RoutineField;
        branch: RoutineField;
        effectiveDate: RoutineField;
        hours: RoutineField;
      }
    >
  | CommonInput<
      "library-notice",
      "closure",
      {
        issuer: RoutineField;
        branch: RoutineField;
        effectiveDate: RoutineField;
        closure: RoutineField;
      }
    >
  | CommonInput<
      "parks-recreation-notice",
      "program" | "facility",
      {
        issuer: RoutineField;
        program: RoutineField;
        start: RoutineField;
        location: RoutineField;
        end?: RoutineField;
        registrationUrl?: RoutineField;
        registrationRequired?: RoutineField;
        eventStatus?: RoutineField;
      } & WithTime
    >
  | CommonInput<
      "community-arts-event-logistics",
      "event",
      {
        issuer: RoutineField;
        title: RoutineField;
        start: RoutineField;
        venue?: RoutineField;
        end?: RoutineField;
        onlineUrl?: RoutineField;
        admission?: RoutineField;
        allDay?: RoutineField;
        cancellation?: RoutineField;
        eventStatus?: RoutineField;
      } & WithTime
    >
  | CommonInput<
      "registration-deadline",
      "deadline",
      {
        issuer: RoutineField;
        program: RoutineField;
        deadline: RoutineField;
        registrationUrl: RoutineField;
        eligibility?: RoutineField;
      } & WithTime
    >
  | CommonInput<
      "waste-recycling-schedule",
      "regular",
      {
        issuer: RoutineField;
        service: RoutineField;
        area: RoutineField;
        serviceDate: RoutineField;
      }
    >
  | CommonInput<
      "waste-recycling-schedule",
      "changed",
      {
        issuer: RoutineField;
        service: RoutineField;
        area: RoutineField;
        serviceDate: RoutineField;
        scheduleChange: RoutineField;
      }
    >
  | CommonInput<
      "public-meeting-logistics",
      "meeting",
      {
        issuer: RoutineField;
        title: RoutineField;
        start: RoutineField;
        venue?: RoutineField;
        attendanceUrl?: RoutineField;
        agendaUrl: RoutineField;
        cancellation?: RoutineField;
      } & WithTime
    >;

export type RoutineNoticeReasonCode =
  | "missing-required-field"
  | "invalid-field"
  | "ambiguous-timezone"
  | "unsupported-recurrence"
  | "unsupported-format"
  | "unsupported-field"
  | "conflicting-identity"
  | "outside-routine-contract";

export type RoutineNoticeInvalid = {
  valid: false;
  formatKey: RoutineNoticeFormatKey | null;
  reasons: Array<{ code: RoutineNoticeReasonCode; field?: string }>;
};

export type StructurallyValidRoutineNotice = {
  formatKey: RoutineNoticeFormatKey;
  variant: string;
  provenance: UnverifiedRoutineNoticeProvenance;
  provenanceVerification: "unverified";
  fields: Record<string, RoutineField>;
  normalizedFields: Record<string, string>;
  fingerprintMaterial: string;
};

export type RoutineNoticeValidation =
  RoutineNoticeInvalid | { valid: true; notice: StructurallyValidRoutineNotice; rendered: string };

type Shape = {
  required: readonly string[];
  optional: readonly string[];
  temporal?: readonly string[];
  atLeastOne?: readonly string[];
};

const shapes: Record<string, Shape> = {
  "library-notice:program": {
    required: ["issuer", "program", "start"],
    optional: ["end", "location", "participationUrl", "eventStatus", "timezone"],
    temporal: ["start", "end"],
    atLeastOne: ["location", "participationUrl"],
  },
  "library-notice:planned-hours": {
    required: ["issuer", "branch", "effectiveDate", "hours"],
    optional: [],
    temporal: ["effectiveDate"],
  },
  "library-notice:closure": {
    required: ["issuer", "branch", "effectiveDate", "closure"],
    optional: [],
    temporal: ["effectiveDate"],
  },
  "parks-recreation-notice:program": {
    required: ["issuer", "program", "start", "location"],
    optional: ["end", "registrationUrl", "registrationRequired", "eventStatus", "timezone"],
    temporal: ["start", "end"],
  },
  "parks-recreation-notice:facility": {
    required: ["issuer", "program", "start", "location"],
    optional: ["end", "registrationUrl", "registrationRequired", "timezone"],
    temporal: ["start", "end"],
  },
  "community-arts-event-logistics:event": {
    required: ["issuer", "title", "start"],
    optional: ["end", "venue", "onlineUrl", "admission", "allDay", "cancellation", "eventStatus", "timezone"],
    temporal: ["start", "end"],
    atLeastOne: ["venue", "onlineUrl"],
  },
  "registration-deadline:deadline": {
    required: ["issuer", "program", "deadline", "registrationUrl"],
    optional: ["eligibility", "timezone"],
    temporal: ["deadline"],
  },
  "waste-recycling-schedule:regular": {
    required: ["issuer", "service", "area", "serviceDate"],
    optional: [],
    temporal: ["serviceDate"],
  },
  "waste-recycling-schedule:changed": {
    required: ["issuer", "service", "area", "serviceDate", "scheduleChange"],
    optional: [],
    temporal: ["serviceDate"],
  },
  "public-meeting-logistics:meeting": {
    required: ["issuer", "title", "start", "agendaUrl"],
    optional: ["venue", "attendanceUrl", "cancellation", "timezone"],
    temporal: ["start"],
    atLeastOne: ["venue", "attendanceUrl"],
  },
};

const labels: Record<string, string> = {
  issuer: "Issuer",
  program: "Program",
  title: "Title",
  branch: "Branch",
  start: "Start",
  end: "End",
  effectiveDate: "Effective date",
  hours: "Hours",
  closure: "Closure",
  location: "Location",
  venue: "Venue",
  participationUrl: "Participation",
  onlineUrl: "Online",
  admission: "Admission",
  allDay: "All day",
  cancellation: "Cancellation",
  eventStatus: "Event status",
  registrationUrl: "Registration",
  registrationRequired: "Registration required",
  eligibility: "Eligibility",
  deadline: "Deadline",
  service: "Service",
  area: "Area",
  serviceDate: "Date",
  scheduleChange: "Schedule change",
  attendanceUrl: "Attendance",
  agendaUrl: "Agenda",
  timezone: "Timezone",
};

const isField = (value: unknown): value is RoutineField => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.value === "string" &&
    row.value.trim().length > 0 &&
    typeof row.locator === "string" &&
    row.locator.trim().length > 0 &&
    Object.keys(row).every((key) => key === "value" || key === "locator")
  );
};

const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
const offsetDateTime =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/;
const localDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function validCalendarParts(parts: number[]) {
  const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return false;
  }
  const lastDay = new Date(0);
  lastDay.setUTCHours(0, 0, 0, 0);
  lastDay.setUTCFullYear(year, month, 0);
  return day <= lastDay.getUTCDate();
}

function formatterParts(formatter: Intl.DateTimeFormat, instant: number) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
}

function localTimeInstants(value: string, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return [];
  }
  const match = localDateTime.exec(value);
  if (!match) return [];
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = Number(match[6] ?? 0);
  const center = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = center + hours * 3_600_000;
    const [sampleYear, sampleMonth, sampleDay, sampleHour, sampleMinute, sampleSecond] =
      formatterParts(formatter, sample);
    const represented = Date.UTC(
      sampleYear,
      sampleMonth - 1,
      sampleDay,
      sampleHour,
      sampleMinute,
      sampleSecond,
    );
    offsets.add(represented - sample);
  }
  return [...offsets]
    .map((offset) => center - offset)
    .filter((instant) => {
      const parts = formatterParts(formatter, instant);
      return parts.every((part, index) => part === [year, month, day, hour, minute, second][index]);
    });
}

function offsetDateTimeMatchesTimezone(value: string, timezone: string) {
  const match = offsetDateTime.exec(value);
  if (!match) return false;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return false;
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return false;
  const supplied = match.slice(1, 7).map((part) => Number(part ?? 0));
  return formatterParts(formatter, instant).every((part, index) => part === supplied[index]);
}

function validTemporal(value: string, timezone?: string) {
  const date = dateOnly.exec(value);
  if (date) return validCalendarParts(date.slice(1).map(Number)) ? "valid" : "invalid";
  const offset = offsetDateTime.exec(value);
  if (offset) {
    const parts = offset.slice(1, 7).map((part) => Number(part ?? 0));
    const zone = offset[8];
    if (zone !== "Z") {
      const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
      if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
        return "invalid";
      }
    }
    if (!validCalendarParts(parts)) return "invalid";
    return !timezone || offsetDateTimeMatchesTimezone(value, timezone) ? "valid" : "invalid";
  }
  const local = localDateTime.exec(value);
  if (local) {
    if (!validCalendarParts(local.slice(1).map((part) => Number(part ?? 0)))) return "invalid";
    if (!timezone) return "ambiguous";
    return localTimeInstants(value, timezone).length === 1 ? "valid" : "ambiguous";
  }
  return "invalid";
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function comparableTemporal(value: string, timezone?: string) {
  const date = dateOnly.exec(value);
  if (date) {
    const [year, month, day] = date.slice(1).map(Number);
    const instant = new Date(0);
    instant.setUTCHours(0, 0, 0, 0);
    instant.setUTCFullYear(year, month - 1, day);
    return instant.getTime();
  }
  if (offsetDateTime.test(value)) return Date.parse(value);
  if (timezone && localDateTime.test(value)) return localTimeInstants(value, timezone)[0];
  return undefined;
}

function invalidProvenanceField(provenance: UnverifiedRoutineNoticeProvenance) {
  const positive = [
    "newsroomId",
    "sourceId",
    "policyRevision",
    "captureEventId",
    "artifactVersionId",
  ] as const;
  for (const key of positive) {
    if (!Number.isSafeInteger(provenance?.[key]) || provenance[key] <= 0) return key;
  }
  const text = ["sourceUrl", "contentHash", "externalId"] as const;
  for (const key of text) {
    if (typeof provenance?.[key] !== "string" || !provenance[key].trim()) return key;
  }
  try {
    const url = new URL(provenance.sourceUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "sourceUrl";
  } catch {
    return "sourceUrl";
  }
  return null;
}

function stableFingerprintMaterial(
  input: RoutineNoticeInput,
  fields: Record<string, RoutineField>,
) {
  const sortedFields = Object.fromEntries(
    Object.entries(fields)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, { value: value.value, locator: value.locator }]),
  );
  return JSON.stringify({
    formatKey: input.formatKey,
    variant: input.variant,
    newsroomId: input.provenance.newsroomId,
    sourceId: input.provenance.sourceId,
    sourceUrl: input.provenance.sourceUrl,
    policyRevision: input.provenance.policyRevision,
    captureEventId: input.provenance.captureEventId,
    externalId: input.provenance.externalId,
    artifactVersionId: input.provenance.artifactVersionId,
    contentHash: input.provenance.contentHash,
    fields: sortedFields,
  });
}

function renderNotice(notice: StructurallyValidRoutineNotice) {
  const lines = [`Format: ${notice.formatKey}`, `Variant: ${notice.variant}`];
  for (const [key, value] of Object.entries(notice.normalizedFields)) {
    lines.push(`${labels[key] ?? key}: ${value}`);
  }
  lines.push(`Source: ${notice.provenance.sourceUrl}`);
  return lines.join("\n");
}

export function validateRoutineNotice(input: unknown): RoutineNoticeValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, formatKey: null, reasons: [{ code: "invalid-field", field: "input" }] };
  }
  const row = input as Record<string, unknown>;
  const formatKey = ROUTINE_NOTICE_FORMAT_KEYS.includes(row.formatKey as RoutineNoticeFormatKey)
    ? (row.formatKey as RoutineNoticeFormatKey)
    : null;
  if (!formatKey) {
    return { valid: false, formatKey: null, reasons: [{ code: "unsupported-format" }] };
  }
  const key = `${formatKey}:${row.variant}`;
  const shape = shapes[key];
  if (!shape) {
    return { valid: false, formatKey, reasons: [{ code: "unsupported-format" }] };
  }

  const typedInput = input as RoutineNoticeInput;
  const provenanceField = invalidProvenanceField(typedInput.provenance);
  if (provenanceField) {
    return {
      valid: false,
      formatKey,
      reasons: [{ code: "invalid-field", field: `provenance.${provenanceField}` }],
    };
  }

  if (!row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) {
    return { valid: false, formatKey, reasons: [{ code: "invalid-field", field: "fields" }] };
  }
  const fields = row.fields as Record<string, unknown>;
  const allowed = new Set([...shape.required, ...shape.optional]);
  const unsupported = Object.keys(fields)
    .filter((field) => !allowed.has(field))
    .sort();
  if (unsupported.length) {
    return {
      valid: false,
      formatKey,
      reasons: unsupported.map((field) => ({
        code:
          field === "recurrence"
            ? "unsupported-recurrence"
            : ["body", "description", "narrative", "summary"].includes(field)
              ? "outside-routine-contract"
              : "unsupported-field",
        field,
      })),
    };
  }

  const missing = shape.required.filter((field) => fields[field] === undefined);
  if (missing.length) {
    return {
      valid: false,
      formatKey,
      reasons: missing.map((field) => ({ code: "missing-required-field", field })),
    };
  }
  if (shape.atLeastOne && !shape.atLeastOne.some((field) => fields[field] !== undefined)) {
    return {
      valid: false,
      formatKey,
      reasons: [{ code: "missing-required-field", field: shape.atLeastOne.join("|") }],
    };
  }

  const malformed = Object.entries(fields)
    .filter(([, value]) => !isField(value))
    .map(([field]) => ({ code: "invalid-field" as const, field }));
  if (malformed.length) return { valid: false, formatKey, reasons: malformed };

  const typedFields = Object.fromEntries(
    Object.entries(fields).sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, RoutineField>;
  const timezone = typedFields.timezone?.value;
  if (timezone && !validIanaTimezone(timezone)) {
    return { valid: false, formatKey, reasons: [{ code: "invalid-field", field: "timezone" }] };
  }
  for (const field of shape.temporal ?? []) {
    const candidate = typedFields[field];
    if (!candidate) continue;
    const state = validTemporal(candidate.value, timezone);
    if (state === "ambiguous") {
      return { valid: false, formatKey, reasons: [{ code: "ambiguous-timezone", field }] };
    }
    if (state === "invalid") {
      return { valid: false, formatKey, reasons: [{ code: "invalid-field", field }] };
    }
  }

  for (const field of [
    "participationUrl",
    "onlineUrl",
    "registrationUrl",
    "attendanceUrl",
    "agendaUrl",
  ]) {
    const candidate = typedFields[field];
    if (candidate && !validHttpUrl(candidate.value)) {
      return { valid: false, formatKey, reasons: [{ code: "invalid-field", field }] };
    }
  }
  for (const field of ["allDay", "registrationRequired"]) {
    const candidate = typedFields[field];
    if (candidate && candidate.value !== "true" && candidate.value !== "false") {
      return { valid: false, formatKey, reasons: [{ code: "invalid-field", field }] };
    }
  }
  const cancellation = typedFields.cancellation;
  if (
    cancellation &&
    !["cancelled", "postponed", "rescheduled"].includes(cancellation.value.toLowerCase())
  ) {
    return { valid: false, formatKey, reasons: [{ code: "invalid-field", field: "cancellation" }] };
  }
  const eventStatus = typedFields.eventStatus;
  const normalizedEventStatuses = new Map([
    ["EventScheduled", "scheduled"],
    ["EventCancelled", "cancelled"],
    ["EventPostponed", "postponed"],
    ["EventRescheduled", "rescheduled"],
    ["http://schema.org/EventScheduled", "scheduled"],
    ["http://schema.org/EventCancelled", "cancelled"],
    ["http://schema.org/EventPostponed", "postponed"],
    ["http://schema.org/EventRescheduled", "rescheduled"],
    ["https://schema.org/EventScheduled", "scheduled"],
    ["https://schema.org/EventCancelled", "cancelled"],
    ["https://schema.org/EventPostponed", "postponed"],
    ["https://schema.org/EventRescheduled", "rescheduled"],
  ]);
  if (eventStatus && !normalizedEventStatuses.has(eventStatus.value)) {
    return { valid: false, formatKey, reasons: [{ code: "invalid-field", field: "eventStatus" }] };
  }
  if (typedFields.registrationRequired?.value === "true" && !typedFields.registrationUrl) {
    return {
      valid: false,
      formatKey,
      reasons: [{ code: "missing-required-field", field: "registrationUrl" }],
    };
  }
  if (typedFields.start && typedFields.end) {
    const samePrecision =
      (dateOnly.test(typedFields.start.value) && dateOnly.test(typedFields.end.value)) ||
      (offsetDateTime.test(typedFields.start.value) &&
        offsetDateTime.test(typedFields.end.value)) ||
      (localDateTime.test(typedFields.start.value) && localDateTime.test(typedFields.end.value));
    if (samePrecision) {
      const start = comparableTemporal(typedFields.start.value, timezone);
      const end = comparableTemporal(typedFields.end.value, timezone);
      if (start !== undefined && end !== undefined && end < start) {
        return {
          valid: false,
          formatKey,
          reasons: [{ code: "invalid-field", field: "end" }],
        };
      }
    }
  }

  const notice: StructurallyValidRoutineNotice = {
    formatKey,
    variant: typedInput.variant,
    provenance: typedInput.provenance,
    provenanceVerification: "unverified",
    fields: typedFields,
    normalizedFields: Object.fromEntries(
      Object.entries(typedFields).map(([key, value]) => [
        key,
        key === "cancellation"
          ? value.value.trim().toLowerCase()
          : key === "eventStatus"
            ? normalizedEventStatuses.get(value.value)!
            : value.value.trim(),
      ]),
    ),
    fingerprintMaterial: stableFingerprintMaterial(typedInput, typedFields),
  };
  return { valid: true, notice, rendered: renderNotice(notice) };
}
