export type ExtractedRef = { kind: string; value: string };

import { PAPER } from "../paper.ts";

const LLC_RE =
  /\b([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,5}\s+(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Ltd\.?))\b/g;
const CONTRACT_RE =
  /\b(?:contract|agreement|po|purchase order)\s*#?\s*([A-Z0-9][A-Z0-9\/-]{3,})\b/gi;
const RFP_RE = /\b(?:RFP|RFQ|IFB)[\s#:.-]*([A-Z0-9][A-Z0-9\/-]{2,})\b/gi;
const ORD_RE = /\b(?:ordinance|resolution)\s*(?:no\.?|number|#)?\s*([A-Z0-9][A-Z0-9\/-]{2,})\b/gi;
const PARCEL_RE = /\b(?:parcel|AIN|assessor(?:'s)? (?:id|number)|PIN)\s*[:#]?\s*([A-Z0-9-]{5,})\b/gi;
const DATED_RE =
  /\b(?:pursuant to|according to|as previously approved|amended by|under|see attachment|as discussed(?: at)?|prepared by|submitted by)\b[^.\n]{5,120}/gi;
const URL_RE = /https?:\/\/[^\s<>"'\\)\]]+/gi;
const AGENT_RE =
  /\b(?:registered agent|principal|prepared by|submitted by|applicant)\s*[:\-–]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
const CASE_RE = /\b((?:PLN|SP|CUP|ANX|PLAN)[- ]?\d{2,4}[- ]?\d+)\b/gi;
const MONEY_RE = /\$[\d,]+(?:\.\d{2})?/g;

export function extractReferences(text: string): ExtractedRef[] {
  const out: ExtractedRef[] = [];
  const seen = new Set<string>();
  const push = (kind: string, value: string) => {
    const v = value.replace(/\s+/g, " ").trim().slice(0, 240);
    if (v.length < 3) return;
    const key = `${kind}:${v.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value: v });
  };
  let m: RegExpExecArray | null;
  LLC_RE.lastIndex = 0;
  while ((m = LLC_RE.exec(text))) push("company", m[1]!);
  CONTRACT_RE.lastIndex = 0;
  while ((m = CONTRACT_RE.exec(text))) push("contract", m[1]!);
  RFP_RE.lastIndex = 0;
  while ((m = RFP_RE.exec(text))) push("rfp", m[0]!.replace(/\s+/g, " "));
  ORD_RE.lastIndex = 0;
  while ((m = ORD_RE.exec(text))) push("legislation", m[0]!.replace(/\s+/g, " "));
  PARCEL_RE.lastIndex = 0;
  while ((m = PARCEL_RE.exec(text))) push("parcel", m[1]!);
  DATED_RE.lastIndex = 0;
  while ((m = DATED_RE.exec(text))) push("reference", m[0]!);
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    push("url", m[0]!.replace(/[.,;:]+$/, ""));
  }
  AGENT_RE.lastIndex = 0;
  while ((m = AGENT_RE.exec(text))) push("person", m[1]!);
  CASE_RE.lastIndex = 0;
  while ((m = CASE_RE.exec(text))) push("planning", m[1]!);
  MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(text))) push("amount", m[0]!);
  return out.slice(0, 80);
}

export function queriesForRef(ref: ExtractedRef, city = "Longmont"): string[] {
  const v = ref.value;
  switch (ref.kind) {
    case "company":
      return [
        `"${v}" ${city}`,
        `"${v}" "registered agent" Colorado`,
        `"${v}" campaign contribution`,
        `"${v}" contract OR RFP OR bid`,
      ];
    case "contract":
      return [`"${v}" ${city} contract`, `"${v}" RFP`];
    case "rfp":
      return [`${v} ${city}`, `${v} proposal`];
    case "parcel":
      return [`parcel ${v} ${city}`, `${v} assessor ${city}`];
    case "legislation":
      return [`${v} ${city}`, `${v} minutes`];
    case "person":
      return [
        `"${v}" ${city}`,
        `"${v}" "registered agent" Colorado`,
        `"${v}" campaign contribution`,
        `"${v}" planning`,
      ];
    case "planning":
      return [`${v} ${city}`, `${v} planning`, `${v} campaign contribution`];
    case "url":
      return [];
    default:
      return [`"${v}" ${city}`];
  }
}

export function heuristicPlan(
  text: string,
  tried: Set<string>,
  searchesPerHop = 3,
  fetchesPerHop = 4,
): {
  searches: string[];
  fetch_urls: string[];
  frontier: { label: string; kind: string; why: string; priority: number; queries: string[] }[];
  summary: string;
} {
  const refs = extractReferences(text);
  const searches: string[] = [];
  const fetch_urls: string[] = [];
  const frontier: {
    label: string;
    kind: string;
    why: string;
    priority: number;
    queries: string[];
  }[] = [];
  for (const ref of refs) {
    if (ref.kind === "url") fetch_urls.push(ref.value);
    else {
      frontier.push({
        label: ref.value,
        kind: ref.kind,
        why: "Referenced in evidence; not yet searched",
        priority: ref.kind === "company" || ref.kind === "contract" ? 9 : 6,
        queries: queriesForRef(ref),
      });
      for (const q of queriesForRef(ref)) {
        if (!tried.has(q)) searches.push(q);
      }
    }
  }
  return {
    searches: searches.slice(0, searchesPerHop),
    fetch_urls: fetch_urls.slice(0, fetchesPerHop),
    frontier,
    summary: `Heuristic hop: ${Math.min(searches.length, searchesPerHop)} searches, ${Math.min(fetch_urls.length, fetchesPerHop)} fetches, ${frontier.length} frontier items.`,
  };
}

export type BaselineEvent = { key: string; at: Date; title: string; url: string };

export function detectMissingCadence(
  events: BaselineEvent[],
  now: Date,
  cadenceDays: number,
  graceDays = 7,
): { key: string; daysLate: number; lastSeen: Date; title: string; url: string }[] {
  const last = new Map<string, BaselineEvent>();
  for (const e of events) {
    const prev = last.get(e.key);
    if (!prev || e.at > prev.at) last.set(e.key, e);
  }
  const out: { key: string; daysLate: number; lastSeen: Date; title: string; url: string }[] = [];
  for (const e of last.values()) {
    const days = (now.getTime() - e.at.getTime()) / 86400000;
    const late = days - cadenceDays;
    if (late > graceDays) {
      out.push({
        key: e.key,
        daysLate: Math.round(late),
        lastSeen: e.at,
        title: e.title,
        url: e.url,
      });
    }
  }
  return out;
}

export function nthWeekday(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "numeric",
    timeZone: PAPER.timezone,
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value || "1");
  const wd = parts.find((p) => p.type === "weekday")?.value || "Thursday";
  const n = Math.ceil(day / 7);
  return `${n}-${wd}`;
}

export type StructureSnapshot = {
  title: string;
  attachmentCount: number;
  hasAppendixC: boolean;
  headingCount: number;
  length: number;
};

export function structureSnapshot(title: string, text: string, extras: string[] = []): StructureSnapshot {
  return {
    title,
    attachmentCount: extras.length,
    hasAppendixC: /appendix\s*c/i.test(text),
    headingCount: (text.match(/\b(agenda|minutes|staff report|ordinance|resolution|consent)\b/gi) ?? []).length,
    length: text.length,
  };
}

export type PatternAnomaly = {
  kind: string;
  summary: string;
  details: string;
};

export function detectPatternAnomalies(opts: {
  previous: StructureSnapshot | null;
  current: StructureSnapshot;
  usualNthWeekday?: string | null;
  observedAt?: Date;
  usualAttachmentCount?: number | null;
  usualLeadHours?: number | null;
  currentLeadHours?: number | null;
}): PatternAnomaly[] {
  const out: PatternAnomaly[] = [];
  const prev = opts.previous;
  if (prev) {
    if (prev.title && opts.current.title && prev.title !== opts.current.title) {
      out.push({
        kind: "renamed",
        summary: `Title changed from "${prev.title}" to "${opts.current.title}"`,
        details: "Recurring record appears under a new title.",
      });
    }
    if (prev.attachmentCount > 0 && opts.current.attachmentCount < prev.attachmentCount) {
      out.push({
        kind: "attachment-omitted",
        summary: `Attachments dropped from ${prev.attachmentCount} to ${opts.current.attachmentCount}`,
        details: "Packet normally includes more attachments than this capture.",
      });
    }
    if (prev.hasAppendixC && !opts.current.hasAppendixC) {
      out.push({
        kind: "structurally-altered",
        summary: "Expected Appendix C is absent",
        details: "Prior capture of this recurring record included Appendix C.",
      });
    }
    if (prev.length > 2000 && opts.current.length < prev.length * 0.4) {
      out.push({
        kind: "structurally-altered",
        summary: "Recurring document is much shorter than the learned baseline",
        details: `Prior length ${prev.length}, current ${opts.current.length}.`,
      });
    }
  }
  if (
    opts.usualNthWeekday &&
    opts.observedAt &&
    nthWeekday(opts.observedAt) !== opts.usualNthWeekday
  ) {
    out.push({
      kind: "cadence-shifted",
      summary: `Expected ${opts.usualNthWeekday}, observed ${nthWeekday(opts.observedAt)}`,
      details: "Publication weekday/nth pattern shifted from the learned baseline.",
    });
  }
  if (
    opts.usualAttachmentCount != null &&
    opts.usualAttachmentCount > 0 &&
    opts.current.attachmentCount < opts.usualAttachmentCount
  ) {
    out.push({
      kind: "attachment-omitted",
      summary: `Usual attachment count ${opts.usualAttachmentCount}, this capture ${opts.current.attachmentCount}`,
      details: "Learned packet structure is missing attachments.",
    });
  }
  if (
    opts.usualLeadHours != null &&
    opts.usualLeadHours >= 24 &&
    opts.currentLeadHours != null &&
    opts.currentLeadHours < opts.usualLeadHours * 0.5
  ) {
    out.push({
      kind: "late",
      summary: `Posted ${opts.currentLeadHours}h before the meeting; usual lead is ${opts.usualLeadHours}h`,
      details: "Agenda or packet arrived later than the learned posting window.",
    });
  }
  return out;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

/** Best-effort meeting/hearing date from civic titles and headers. */
export function extractMeetingInstant(text: string): Date | null {
  const named = text.match(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2},\\s+20\\d{2}\\b`, "i"));
  if (named) {
    const d = new Date(`${named[0]} UTC`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const d = new Date(`${iso[1]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function leadHoursBefore(captured: Date, meeting: Date): number | null {
  const h = (meeting.getTime() - captured.getTime()) / 3600000;
  if (h <= 0 || h > 24 * 21) return null;
  return Math.round(h);
}

export function diffExcerpt(prev: string, next: string): string {
  if (prev === next) return "";
  if (!next) return "Content removed.";
  if (!prev) return "Content appeared.";
  const a = new Set(prev.split(/\s+/).filter((w) => w.length > 4));
  const b = next.split(/\s+/).filter((w) => w.length > 4);
  const added = b.filter((w) => !a.has(w)).slice(0, 24);
  const prevWords = prev.split(/\s+/).filter((w) => w.length > 4);
  const nextSet = new Set(b);
  const removed = prevWords.filter((w) => !nextSet.has(w)).slice(0, 24);
  return [
    removed.length ? `Removed: ${removed.join(" ")}` : "",
    added.length ? `Added: ${added.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function classifyClaimKind(raw: string): string {
  const k = raw.trim().toUpperCase();
  if (
    k === "FACT" ||
    k === "OBSERVATION" ||
    k === "ALLEGATION" ||
    k === "INFERENCE" ||
    k === "HYPOTHESIS" ||
    k === "UNKNOWN"
  ) {
    return k;
  }
  return "UNKNOWN";
}
