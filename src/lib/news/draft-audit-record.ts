/**
 * What the story page reads back: the style audit of one draft, stored with
 * the draft so the list stays current without asking a model anything.
 *
 * The findings live in `drafts.research_json` -- the desk's own machine
 * findings, which is where a style finding belongs -- and the four-number
 * summary goes into the completion receipt beside the citation and name
 * checks. Nothing here reaches `provenance_json`, which is reader-facing.
 *
 * PURE. No I/O, no clock (the timestamp is passed in), no model. Every value
 * that comes back out of a stored row is treated as untrusted: a row written
 * by a later version, or by hand, must never make the page print a wrong line
 * or throw while rendering a story.
 */
import type { DraftAuditFinding, DraftAuditMeasurements, DraftAuditResult, DraftAuditSeverity } from "./draft-audit.ts";
import type { DraftRepairStatus, DraftStyleRepairOutcome } from "./draft-audit-repair.ts";
import type { DraftStyleAuditSummary } from "./draft-completion.ts";

/** The key this record occupies inside `drafts.research_json`. */
export const STYLE_AUDIT_KEY = "styleAudit";

export type DraftStyleRecord = {
  version: 1;
  status: DraftRepairStatus;
  /** Rounds that reached the model. 0 when only the code measured the draft. */
  rounds: number;
  repairCalls: number;
  fixCount: number;
  reviewCount: number;
  /** The findings as they stand against the saved text. */
  findings: DraftAuditFinding[];
  measurementsBefore: DraftAuditMeasurements;
  measurementsAfter: DraftAuditMeasurements;
  rejections: Array<{ round: number; reason: string }>;
  /** One plain sentence for the editor. */
  note: string;
  /** ISO timestamp, supplied by the caller: this module has no clock. */
  checkedAt?: string;
  /** True when the editor pressed "Fix these with the model". */
  requested?: boolean;
};

const SEVERITIES: readonly DraftAuditSeverity[] = ["fix", "review"];
const STATUSES: readonly DraftRepairStatus[] = ["clean", "repaired", "open", "provider-failed"];

/** The measurement half of an audit, copied so a stored record cannot share
 *  state with a live result. */
const measurementsOf = (result: DraftAuditResult): DraftAuditMeasurements => ({ ...result.measurements });

/** A record of an audit where no model was asked to rewrite anything: the
 *  editor saved, and the desk measured what was saved. */
export function styleRecordFromAudit(
  result: DraftAuditResult,
  checkedAt?: string,
): DraftStyleRecord {
  return {
    version: 1,
    status: result.fixCount > 0 ? "open" : "clean",
    rounds: 0,
    repairCalls: 0,
    fixCount: result.fixCount,
    reviewCount: result.reviewCount,
    findings: result.findings.map((finding) => ({ ...finding })),
    measurementsBefore: measurementsOf(result),
    measurementsAfter: measurementsOf(result),
    rejections: [],
    note:
      result.fixCount > 0
        ? "The style check measured the draft; no model was asked to rewrite it."
        : "The style check found nothing to fix.",
    ...(checkedAt ? { checkedAt } : {}),
  };
}

/** A record of a full repair run: the audit before, the rounds, the audit of
 *  the text that was kept. */
export function styleRecordFromRepair(
  outcome: DraftStyleRepairOutcome,
  options: { checkedAt?: string; requested?: boolean } = {},
): DraftStyleRecord {
  return {
    version: 1,
    status: outcome.status,
    rounds: outcome.rounds,
    repairCalls: outcome.repairCalls,
    fixCount: outcome.after.fixCount,
    reviewCount: outcome.after.reviewCount,
    findings: outcome.after.findings.map((finding) => ({ ...finding })),
    measurementsBefore: measurementsOf(outcome.before),
    measurementsAfter: measurementsOf(outcome.after),
    rejections: outcome.rejections.map((rejection) => ({ ...rejection })),
    note: outcome.note,
    ...(options.checkedAt ? { checkedAt: options.checkedAt } : {}),
    ...(options.requested ? { requested: true } : {}),
  };
}

const asCount = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const asText = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

function asMeasurement(raw: unknown): DraftAuditMeasurements | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const numbers = [
    "paragraphCount",
    "sentenceCount",
    "wordCount",
    "meanSentenceWords",
    "sentenceLengthCv",
    "shortestSentenceWords",
    "longestSentenceWords",
    "maxParagraphWords",
    "paragraphCap",
    "zigzagShare",
    "sixWordRepeats",
  ] as const;
  if (numbers.some((key) => !Number.isFinite(Number(row[key])))) return null;
  return Object.fromEntries(numbers.map((key) => [key, Number(row[key])])) as DraftAuditMeasurements;
}

function asFinding(raw: unknown): DraftAuditFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const severity = asText(row.severity);
  if (!SEVERITIES.includes(severity as DraftAuditSeverity)) return null;
  const message = asText(row.message);
  if (!message) return null;
  return {
    severity: severity as DraftAuditSeverity,
    code: asText(row.code, "style"),
    paragraph: asCount(row.paragraph),
    sentence: asCount(row.sentence),
    message,
    snippet: asText(row.snippet),
  };
}

/**
 * The stored record, or null when there is none or it cannot be trusted. A
 * partial row is not repaired into a complete-looking one: a page that prints
 * "0 things to fix" because a field was missing would be lying about the
 * draft, so an unusable record reads as "no audit".
 */
export function parseStyleRecord(raw: unknown): DraftStyleRecord | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw || "null");
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = asText(row.status);
  if (!STATUSES.includes(status as DraftRepairStatus)) return null;
  const before = asMeasurement(row.measurementsBefore);
  const after = asMeasurement(row.measurementsAfter);
  if (!before || !after) return null;
  if (!Array.isArray(row.findings)) return null;
  const findings = row.findings.map(asFinding).filter((finding): finding is DraftAuditFinding => finding != null);
  if (findings.length !== row.findings.length) return null;
  const fixCount = findings.filter((finding) => finding.severity === "fix").length;
  const reviewCount = findings.length - fixCount;
  const rejections = Array.isArray(row.rejections)
    ? row.rejections.flatMap((rejection) => {
        if (!rejection || typeof rejection !== "object") return [];
        const entry = rejection as Record<string, unknown>;
        const reason = asText(entry.reason);
        return reason ? [{ round: asCount(entry.round), reason }] : [];
      })
    : [];
  return {
    version: 1,
    status: status as DraftRepairStatus,
    rounds: asCount(row.rounds),
    repairCalls: asCount(row.repairCalls),
    // Counted from the findings that survived parsing, never from the stored
    // totals: the two can only disagree when the row was not written by this
    // code, and the list is what the editor is shown.
    fixCount,
    reviewCount,
    findings,
    measurementsBefore: before,
    measurementsAfter: after,
    rejections,
    note: asText(row.note),
    ...(typeof row.checkedAt === "string" ? { checkedAt: row.checkedAt } : {}),
    ...(row.requested === true ? { requested: true } : {}),
  };
}

/** The four numbers the completion receipt carries, from a stored record. */
export function styleAuditSummary(record: DraftStyleRecord): DraftStyleAuditSummary {
  return {
    status: record.status,
    fixCount: record.fixCount,
    reviewCount: record.reviewCount,
    rounds: record.rounds,
  };
}

/** The findings the editor can act on, in the order the audit sorted them. */
export function fixFindings(record: DraftStyleRecord | null): DraftAuditFinding[] {
  return record ? record.findings.filter((finding) => finding.severity === "fix") : [];
}

/** The review findings, shown below the ones to fix. */
export function reviewFindings(record: DraftStyleRecord | null): DraftAuditFinding[] {
  return record ? record.findings.filter((finding) => finding.severity === "review") : [];
}
