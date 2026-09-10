import { parseHTML } from "linkedom";
import { compiledDocumentUrl } from "./primegov.ts";
import {
  validateRoutineNotice,
  type RoutineField,
  type RoutineNoticeInput,
  type RoutineNoticeValidation,
  type UnverifiedRoutineNoticeProvenance,
} from "./routine-notice-types.ts";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_JSON_LD_SCRIPTS = 32;
const MAX_JSON_LD_SCRIPT_BYTES = 128 * 1024;
const MAX_JSON_LD_NODES = 100;
const MAX_JSON_LD_DEPTH = 64;
const MAX_JSON_LD_TRAVERSAL = 1_000;

type BaseProvenance = Omit<UnverifiedRoutineNoticeProvenance, "externalId">;

export type RoutineExtractionRefusalCode =
  | "content-too-large"
  | "script-too-large"
  | "script-limit-exceeded"
  | "node-limit-exceeded"
  | "traversal-limit-exceeded"
  | "malformed-json"
  | "missing-stable-identity"
  | "unsupported-event-type"
  | "missing-owner-context"
  | "structurally-invalid";

export type RoutineExtractionResult =
  | { status: "parsed"; locator: string; validation: RoutineNoticeValidation; code?: never }
  | {
      status: "refused";
      code: RoutineExtractionRefusalCode;
      locator: string;
      validation?: RoutineNoticeValidation;
    };

type PrimeGovContext = {
  provenance: BaseProvenance;
  issuer: RoutineField;
  timezone?: RoutineField;
  portalOrigin: string;
};

type JsonLdContext = {
  formatKey: "library-notice" | "parks-recreation-notice" | "community-arts-event-logistics";
  provenance: BaseProvenance;
  /** Exact approved-source issuer supplied by saved owner automation settings. */
  ownerIssuer?: RoutineField;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const field = (value: string | null, locator: string): RoutineField | undefined =>
  value ? { value, locator } : undefined;

const compactFields = (fields: Record<string, RoutineField | undefined>) =>
  Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, RoutineField] => !!entry[1]),
  );

function refused(
  code: RoutineExtractionRefusalCode,
  locator: string,
  validation?: RoutineNoticeValidation,
): RoutineExtractionResult {
  return { status: "refused", code, locator, ...(validation ? { validation } : {}) };
}

export function extractPrimeGovMeeting(
  raw: unknown,
  context: PrimeGovContext,
): RoutineExtractionResult {
  const meeting = record(raw);
  if (!meeting || !Number.isSafeInteger(meeting.id) || Number(meeting.id) <= 0) {
    return refused("structurally-invalid", "/id");
  }
  const documents = Array.isArray(meeting.documentList) ? meeting.documentList : [];
  const agendaIndex = documents.findIndex((value) => {
    const document = record(value);
    return document && /\bagenda\b/i.test(text(document.templateName) ?? "");
  });
  if (agendaIndex < 0) return refused("structurally-invalid", "/documentList");
  const agenda = record(documents[agendaIndex]);
  if (!agenda) return refused("structurally-invalid", `/documentList/${agendaIndex}`);
  const directLink = text(agenda.link);
  const templateId = Number(agenda.templateId);
  const documentId = Number(agenda.id);
  if (
    !directLink &&
    (!Number.isSafeInteger(templateId) || templateId <= 0) &&
    (!Number.isSafeInteger(documentId) || documentId <= 0)
  ) {
    return refused("structurally-invalid", `/documentList/${agendaIndex}/link`);
  }
  const agendaUrl = directLink
    ? directLink
    : compiledDocumentUrl(context.portalOrigin, {
        id: Number.isSafeInteger(documentId) && documentId > 0 ? documentId : 0,
        templateId: Number.isSafeInteger(templateId) && templateId > 0 ? templateId : 0,
        compileOutputType: Number(agenda.compileOutputType) || 1,
        templateName: text(agenda.templateName) ?? "Agenda",
        link: null,
      });
  const agendaLocator = directLink
    ? `/documentList/${agendaIndex}/link`
    : Number.isSafeInteger(templateId) && templateId > 0
      ? `/documentList/${agendaIndex}/templateId`
      : `/documentList/${agendaIndex}/id`;
  const fields = {
    issuer: context.issuer,
    title: field(text(meeting.title), "/title"),
    start: field(text(meeting.dateTime), "/dateTime"),
    venue: field(text(meeting.location), "/location"),
    agendaUrl: field(agendaUrl, agendaLocator),
    ...(context.timezone ? { timezone: context.timezone } : {}),
  };
  const validation = validateRoutineNotice({
    formatKey: "public-meeting-logistics",
    variant: "meeting",
    provenance: { ...context.provenance, externalId: String(meeting.id) },
    fields: compactFields(fields),
  });
  return validation.valid
    ? { status: "parsed", locator: "/", validation }
    : refused("structurally-invalid", "/", validation);
}

function jsonNodes(
  value: unknown,
  locator: string,
  remainingNodes: number,
): {
  nodes: Array<{ row: Record<string, unknown>; locator: string }>;
  limit: "node" | "traversal" | null;
  limitLocator?: string;
} {
  const nodes: Array<{ row: Record<string, unknown>; locator: string }> = [];
  type Entry =
    | { kind: "value"; value: unknown; locator: string; depth: number }
    | {
        kind: "array";
        value: unknown[];
        locator: string;
        depth: number;
        index: number;
      };
  const stack: Entry[] = [{ kind: "value", value, locator, depth: 0 }];
  let traversed = 0;
  while (stack.length) {
    const current = stack.pop()!;
    traversed += 1;
    if (current.depth > MAX_JSON_LD_DEPTH || traversed > MAX_JSON_LD_TRAVERSAL) {
      return { nodes, limit: "traversal", limitLocator: current.locator };
    }
    if (current.kind === "array") {
      if (current.index >= current.value.length) continue;
      stack.push({ ...current, index: current.index + 1 });
      stack.push({
        kind: "value",
        value: current.value[current.index],
        locator: `${current.locator}[${current.index}]`,
        depth: current.depth + 1,
      });
      continue;
    }
    if (Array.isArray(current.value)) {
      stack.push({
        kind: "array",
        value: current.value,
        locator: current.locator,
        depth: current.depth,
        index: 0,
      });
      continue;
    }
    const row = record(current.value);
    if (!row) continue;
    if (Array.isArray(row["@graph"])) {
      stack.push({
        kind: "array",
        value: row["@graph"],
        locator: `${current.locator}['@graph']`,
        depth: current.depth,
        index: 0,
      });
      continue;
    }
    if (nodes.length >= remainingNodes) {
      return { nodes, limit: "node", limitLocator: current.locator };
    }
    nodes.push({ row, locator: current.locator });
  }
  return { nodes, limit: null };
}

const supportedEventTypes = new Set([
  "Event",
  "https://schema.org/Event",
  "http://schema.org/Event",
]);

function eventTypes(value: unknown) {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function firstLocation(row: Record<string, unknown>, locator: string) {
  const locations = Array.isArray(row.location) ? row.location : [row.location];
  let venue: RoutineField | undefined;
  let onlineUrl: RoutineField | undefined;
  for (let index = 0; index < locations.length; index += 1) {
    const location = record(locations[index]);
    if (!location) continue;
    const prefix = Array.isArray(row.location)
      ? `${locator}.location[${index}]`
      : `${locator}.location`;
    venue ??= field(text(location.name), `${prefix}.name`);
    onlineUrl ??= field(text(location.url), `${prefix}.url`);
  }
  return { venue, onlineUrl };
}

function eventStatus(value: unknown) {
  return text(value) ?? undefined;
}

function eventInput(
  row: Record<string, unknown>,
  locator: string,
  context: JsonLdContext,
  externalId: string,
): RoutineNoticeInput {
  const organizer = record(row.organizer);
  const issuer = field(text(organizer?.name), `${locator}.organizer.name`) ?? context.ownerIssuer;
  const title = field(text(row.name), `${locator}.name`);
  const start = field(text(row.startDate), `${locator}.startDate`);
  const end = field(text(row.endDate), `${locator}.endDate`);
  const { venue, onlineUrl } = firstLocation(row, locator);
  const statusValue = eventStatus(row.eventStatus);
  const eventStatusField = field(statusValue ?? null, `${locator}.eventStatus`);
  const timezone = field(text(row.timezone), `${locator}.timezone`);
  const recurrence = row.eventSchedule
    ? field(JSON.stringify(row.eventSchedule), `${locator}.eventSchedule`)
    : undefined;
  const common = {
    provenance: { ...context.provenance, externalId },
    fields: compactFields({
      issuer,
      start,
      end,
      timezone,
      eventStatus: eventStatusField,
      recurrence,
    }),
  };
  if (context.formatKey === "library-notice") {
    return {
      formatKey: "library-notice",
      variant: "program",
      ...common,
      fields: compactFields({
        ...common.fields,
        program: title,
        location: venue,
        participationUrl: onlineUrl,
      }),
    } as unknown as RoutineNoticeInput;
  }
  if (context.formatKey === "parks-recreation-notice") {
    return {
      formatKey: "parks-recreation-notice",
      variant: "program",
      ...common,
      fields: compactFields({ ...common.fields, program: title, location: venue }),
    } as unknown as RoutineNoticeInput;
  }
  return {
    formatKey: "community-arts-event-logistics",
    variant: "event",
    ...common,
    fields: compactFields({ ...common.fields, title, venue, onlineUrl }),
  } as unknown as RoutineNoticeInput;
}

export function extractJsonLdEvents(
  html: string,
  context: JsonLdContext,
): RoutineExtractionResult[] {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return [refused("content-too-large", "document")];
  }
  const { document } = parseHTML(html);
  const allScripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  const scripts = allScripts.slice(0, MAX_JSON_LD_SCRIPTS);
  const results: RoutineExtractionResult[] = [];
  let visited = 0;
  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex += 1) {
    const locator = `script[${scriptIndex}]`;
    const source = scripts[scriptIndex]?.textContent ?? "";
    if (Buffer.byteLength(source, "utf8") > MAX_JSON_LD_SCRIPT_BYTES) {
      results.push(refused("script-too-large", locator));
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      results.push(refused("malformed-json", locator));
      continue;
    }
    const collected = jsonNodes(parsed, `${locator}.$`, MAX_JSON_LD_NODES - visited);
    for (const node of collected.nodes) {
      visited += 1;
      const types = eventTypes(node.row["@type"]);
      if (!types.some((type) => supportedEventTypes.has(type))) {
        if (types.some((type) => /(?:^|[/#:])[^/#:]*Event$/.test(type))) {
          results.push(refused("unsupported-event-type", `${node.locator}['@type']`));
        }
        continue;
      }
      const externalId = text(node.row["@id"]) ?? text(node.row.url);
      if (!externalId) {
        results.push(refused("missing-stable-identity", node.locator));
        continue;
      }
      if (
        Object.prototype.hasOwnProperty.call(node.row, "eventStatus") &&
        !text(node.row.eventStatus)
      ) {
        results.push(refused("structurally-invalid", `${node.locator}.eventStatus`));
        continue;
      }
      const structuredIssuer = text(record(node.row.organizer)?.name);
      if (
        structuredIssuer &&
        context.ownerIssuer &&
        structuredIssuer !== context.ownerIssuer.value
      ) {
        results.push(refused("structurally-invalid", `${node.locator}.organizer.name`));
        continue;
      }
      const validation = validateRoutineNotice(
        eventInput(node.row, node.locator, context, externalId),
      );
      results.push(
        validation.valid
          ? { status: "parsed", locator: node.locator, validation }
          : refused("structurally-invalid", node.locator, validation),
      );
    }
    if (collected.limit) {
      const code = collected.limit === "node" ? "node-limit-exceeded" : "traversal-limit-exceeded";
      if (!results.some((result) => result.code === code)) {
        results.push(refused(code, collected.limitLocator ?? locator));
      }
    }
  }
  if (allScripts.length > MAX_JSON_LD_SCRIPTS) {
    results.push(refused("script-limit-exceeded", `script[${MAX_JSON_LD_SCRIPTS}]`));
  }
  return results;
}
