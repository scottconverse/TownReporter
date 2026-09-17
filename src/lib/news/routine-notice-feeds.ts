import { parseHTML } from "linkedom";
import {
  validateRoutineNotice,
  type RoutineField,
  type UnverifiedRoutineNoticeProvenance,
} from "./routine-notice-types.ts";
import type { RoutineExtractionResult } from "./routine-notice-extract.ts";

type Base = Omit<UnverifiedRoutineNoticeProvenance, "externalId">;
export type FeedResult = RoutineExtractionResult;
const rec = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
const txt = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
const f = (value: string | null, locator: string): RoutineField | undefined =>
  value ? { value, locator } : undefined;
const compact = (x: Record<string, RoutineField | undefined>) =>
  Object.fromEntries(Object.entries(x).filter((e): e is [string, RoutineField] => !!e[1]));
const finish = (input: any, locator: string): FeedResult => {
  const validation = validateRoutineNotice(input);
  return validation.valid
    ? { status: "parsed", locator, validation }
    : { status: "refused", locator, code: "malformed-json" };
};

/** Schema.org EducationalOccupationalProgram.applicationDeadline is the next-cycle application deadline, never an Event end date. */
export function extractApplicationDeadlines(html: string, provenance: Base): FeedResult[] {
  if (Buffer.byteLength(html, "utf8") > 512 * 1024)
    return [{ status: "refused", locator: "document", code: "malformed-json" }];
  const { document } = parseHTML(html);
  const out: FeedResult[] = [];
  [...document.querySelectorAll('script[type="application/ld+json"]')]
    .slice(0, 32)
    .forEach((script, i) => {
      let value: unknown;
      try {
        value = JSON.parse(script.textContent ?? "");
      } catch {
        out.push({ status: "refused", locator: `script[${i}]`, code: "malformed-json" });
        return;
      }
      const rows = Array.isArray(value) ? value : [value];
      rows.forEach((raw, j) => {
        const row = rec(raw);
        if (!row) return;
        const types = Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]];
        if (
          !types.some(
            (t) =>
              t === "EducationalOccupationalProgram" ||
              t === "https://schema.org/EducationalOccupationalProgram",
          )
        )
          return;
        const locator = `script[${i}].$[${j}]`;
        const id = txt(row["@id"]) ?? txt(row.url);
        if (!id) {
          out.push({ status: "refused", locator, code: "missing-stable-identity" });
          return;
        }
        const provider = rec(row.provider);
        out.push(
          finish(
            {
              formatKey: "registration-deadline",
              variant: "deadline",
              provenance: { ...provenance, externalId: id },
              fields: compact({
                issuer: f(txt(provider?.name), `${locator}.provider.name`),
                program: f(txt(row.name), `${locator}.name`),
                deadline: f(txt(row.applicationDeadline), `${locator}.applicationDeadline`),
                registrationUrl: f(txt(row.url), `${locator}.url`),
              }),
            },
            locator,
          ),
        );
      });
    });
  return out;
}

/** Schema.org specialOpeningHoursSpecification. Explicit 00:00–00:00 is a dated closure. */
export function extractLibraryHours(
  html: string,
  context: { provenance: Base; issuer: string; branch: string },
): FeedResult[] {
  if (Buffer.byteLength(html, "utf8") > 512 * 1024)
    return [{ status: "refused", locator: "document", code: "malformed-json" }];
  const { document } = parseHTML(html);
  const out: FeedResult[] = [];
  [...document.querySelectorAll('script[type="application/ld+json"]')]
    .slice(0, 32)
    .forEach((script, i) => {
      let root: unknown;
      try {
        root = JSON.parse(script.textContent ?? "");
      } catch {
        out.push({ status: "refused", locator: `script[${i}]`, code: "malformed-json" });
        return;
      }
      for (const raw of Array.isArray(root) ? root : [root]) {
        const parent = rec(raw);
        if (!parent) continue;
        const parentTypes = Array.isArray(parent["@type"]) ? parent["@type"] : [parent["@type"]];
        if (
          !parentTypes.some(
            (type) =>
              type === "Library" ||
              type === "Place" ||
              type === "https://schema.org/Library" ||
              type === "https://schema.org/Place",
          ) ||
          txt(parent.name) !== context.branch
        )
          continue;
        const rawSpecs = parent.specialOpeningHoursSpecification;
        const specs = Array.isArray(rawSpecs) ? rawSpecs : [rawSpecs];
        specs.forEach((value, j) => {
          const spec = rec(value);
          if (!spec) return;
          const locator = `script[${i}].$.specialOpeningHoursSpecification[${j}]`;
          const date = txt(spec.validFrom),
            opens = txt(spec.opens),
            closes = txt(spec.closes);
          const externalId =
            txt(spec["@id"]) ?? `${txt(parent["@id"]) ?? txt(parent.url) ?? ""}#${date ?? ""}`;
          if (!externalId || externalId === "#") {
            out.push({ status: "refused", locator, code: "missing-stable-identity" });
            return;
          }
          const through = txt(spec.validThrough),
            days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
          const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
          const weekday = date
            ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
                new Date(`${date}T12:00:00Z`),
              )
            : "";
          if (
            (through && through !== date) ||
            (days[0] !== undefined &&
              (!date || days.length !== 1 || !String(days[0]).endsWith(weekday))) ||
            !opens ||
            !closes ||
            !clock.test(opens) ||
            !clock.test(closes)
          ) {
            out.push({ status: "refused", locator, code: "structurally-invalid" });
            return;
          }
          const closed = opens === "00:00" && closes === "00:00";
          out.push(
            finish(
              {
                formatKey: "library-notice",
                variant: closed ? "closure" : "planned-hours",
                provenance: { ...context.provenance, externalId },
                fields: compact({
                  issuer: f(context.issuer, `${locator}.OWNER_ISSUER`),
                  branch: f(context.branch, `${locator}.OWNER_BRANCH`),
                  effectiveDate: f(date, `${locator}.validFrom`),
                  closure: closed ? f("Closed", `${locator}.opens+closes`) : undefined,
                  hours: !closed
                    ? f(opens && closes ? `${opens}–${closes}` : null, `${locator}.opens+closes`)
                    : undefined,
                }),
              },
              locator,
            ),
          );
        });
      }
    });
  return out;
}

type IcsKind = "waste" | "deadline";
function unfold(raw: string) {
  return raw.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}
function icsValue(line: string) {
  const at = line.indexOf(":");
  return at < 0
    ? null
    : line
        .slice(at + 1)
        .replace(/\\n/gi, " ")
        .replace(/\\,/g, ",")
        .trim();
}
function icsDate(value: string | null) {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
  if (!m) return value;
  return `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6]}${value.endsWith("Z") ? "Z" : ""}` : ""}`;
}
/** RFC 5545 bounded VEVENT subset. Caller selects the approved format and designated collection area. */
export function extractRoutineIcs(
  raw: string,
  kind: IcsKind,
  context: { provenance: Base; issuer: string; locality: string; collectionArea?: string },
): FeedResult[] {
  if (Buffer.byteLength(raw, "utf8") > 512 * 1024)
    return [{ status: "refused", locator: "document", code: "malformed-json" }];
  const lines = unfold(raw),
    out: FeedResult[] = [];
  const stack: string[] = [];
  const events: Array<{ lines: string[]; malformed: boolean }> = [];
  let current: { lines: string[]; malformed: boolean } | null = null;
  let method = "";
  for (const line of lines) {
    const begin = /^BEGIN:(.+)$/i.exec(line),
      end = /^END:(.+)$/i.exec(line);
    if (begin) {
      const name = begin[1]!.toUpperCase();
      stack.push(name);
      if (name === "VEVENT") {
        if (current) current.malformed = true;
        current = { lines: [], malformed: false };
      } else if (current) current.malformed = true;
      continue;
    }
    if (end) {
      const name = end[1]!.toUpperCase();
      if (stack.pop() !== name) {
        if (current) current.malformed = true;
        continue;
      }
      if (name === "VEVENT" && current) {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (stack.length === 1 && /^METHOD:/i.test(line)) method = (icsValue(line) ?? "").toUpperCase();
    if (current && stack.at(-1) === "VEVENT") current.lines.push(line);
  }
  for (let ordinal = 0; ordinal < events.length; ordinal++) {
    const event = events[ordinal]!,
      loc = `VEVENT[${ordinal}]`;
    const entries = event.lines.map((line) => {
      const colon = line.indexOf(":");
      const head = colon < 0 ? line : line.slice(0, colon);
      const [name, ...params] = head.split(";");
      return { name: name!.toUpperCase(), params, value: icsValue(line) };
    });
    const critical = ["UID", "DTSTART", "SUMMARY", "URL", "STATUS"];
    const duplicate = critical.some((name) => entries.filter((e) => e.name === name).length > 1);
    const unsupported = entries.some((e) =>
      ["RRULE", "RDATE", "EXDATE", "RECURRENCE-ID"].includes(e.name),
    );
    const get = (name: string) => entries.find((e) => e.name === name);
    const startEntry = get("DTSTART"),
      tzid = startEntry?.params.find((p) => /^TZID=/i.test(p))?.slice(5) ?? null;
    const uid = get("UID")?.value ?? null,
      summary = get("SUMMARY")?.value ?? null,
      start = icsDate(startEntry?.value ?? null),
      url = get("URL")?.value ?? null,
      status = (get("STATUS")?.value ?? "").toUpperCase();
    if (
      event.malformed ||
      duplicate ||
      unsupported ||
      method === "CANCEL" ||
      status === "CANCELLED"
    ) {
      out.push({ status: "refused", locator: loc, code: "structurally-invalid" });
      continue;
    }
    if (!uid) {
      out.push({ status: "refused", locator: loc, code: "missing-stable-identity" });
    } else if (kind === "waste")
      out.push(
        finish(
          {
            formatKey: "waste-recycling-schedule",
            variant: /change|delay|holiday/i.test(summary ?? "") ? "changed" : "regular",
            provenance: { ...context.provenance, externalId: uid },
            fields: compact({
              issuer: f(context.issuer, `${loc}.OWNER_ISSUER`),
              service: f(summary, `${loc}.SUMMARY`),
              area: f(context.collectionArea ?? context.locality, `${loc}.OWNER_AREA`),
              serviceDate: f(start, `${loc}.DTSTART`),
              scheduleChange: /change|delay|holiday/i.test(summary ?? "")
                ? f(summary, `${loc}.SUMMARY`)
                : undefined,
            }),
          },
          loc,
        ),
      );
    else
      out.push(
        finish(
          {
            formatKey: "registration-deadline",
            variant: "deadline",
            provenance: { ...context.provenance, externalId: uid },
            fields: compact({
              issuer: f(context.issuer, `${loc}.OWNER_ISSUER`),
              program: f(summary, `${loc}.SUMMARY`),
              deadline: f(start, `${loc}.DTSTART`),
              registrationUrl: f(url, `${loc}.URL`),
              timezone: f(tzid, `${loc}.DTSTART.TZID`),
            }),
          },
          loc,
        ),
      );
  }
  if (stack.length || current)
    out.push({ status: "refused", locator: "document", code: "structurally-invalid" });
  return out;
}
