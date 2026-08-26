/** Editor-facing copy. Does not change investigative behavior. */

export function organizationFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").replace(/^assets\./i, "");
    if (/bouldercounty\.gov$/i.test(host)) return "Boulder County";
    if (/longmontcolorado\.gov$/i.test(host)) return "City of Longmont";
    if (/svvsd\.org$/i.test(host)) return "St. Vrain Valley Schools";
    if (/nextlight\.net$/i.test(host)) return "NextLight";
    const base = host.split(".")[0] ?? host;
    return base.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

export function filenameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return last.replace(/\.[a-z0-9]{2,8}$/i, "");
  } catch {
    return "";
  }
}

export function headlineFromUrl(url: string): string {
  const raw = filenameFromUrl(url);
  if (!raw) return organizationFromUrl(url) || url;
  const parts = raw.split(/[-_.]+/).filter(Boolean);
  const drop = /^(rst|td\d+|o|pdf|docx?|final|draft|rev\d+|v\d+|pct|\d+pct)$/i;
  const kept = parts.filter((p) => !drop.test(p) && !/^\d+(\.\d+)?$/.test(p));
  const words = kept.length >= 2 ? kept : parts.filter((p) => p.length > 2 && !/^\d+$/.test(p));
  const picked = words.length ? words : parts;
  const title = picked
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .trim();
  const isDoc = /\.pdf($|\?)/i.test(url);
  if (title && isDoc && !/document|report|packet|minutes/i.test(title)) return `${title} document`;
  return title || organizationFromUrl(url) || url;
}

export function sourceLineFromUrl(url: string): string {
  const raw = filenameFromUrl(url);
  const pretty = raw
    ? raw
        .split(/[-_]+/)
        .filter(Boolean)
        .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ")
    : "";
  const org = organizationFromUrl(url);
  if (pretty && org) return `${pretty} — ${org}`;
  return pretty || org || url;
}

export function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s)\]>'"]+/i);
  return m?.[0] ?? "";
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function withoutUrls(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)\]>'"]+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s([.,;:])/g, "$1")
    .trim();
}

export function editorKindLabel(kind: string): string {
  switch (kind) {
    case "reopened":
      return "Resurfaced";
    case "disappeared":
    case "removed":
    case "soft-404":
      return "Missing record";
    case "missing-cadence":
    case "missing-record":
      return "Overdue";
    case "changed":
      return "Changed";
    case "promise":
      return "Open promise";
    case "lead":
      return "Scanner lead";
    case "signal":
      return "Prior finding";
    default:
      return "Worth a look";
  }
}

export function editorStatus(status: string): string {
  switch (status) {
    case "investigating":
      return "Researching";
    case "paused":
      return "Paused — work remaining";
    case "open":
      return "Needs follow-up";
    case "exhausted":
    case "closed":
      return "Parked";
    default:
      return status.replace(/[-_]/g, " ");
  }
}

export function editorError(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  if (/403/.test(t) || /forbidden/i.test(t)) {
    return "The reporting model was unavailable (access denied). The investigation is still on the desk — Keep digging to retry.";
  }
  if (/xai api error/i.test(t) || /api error/i.test(t)) {
    return "The reporting model did not finish this pass. Searches and captures that already ran are kept. Keep digging to continue.";
  }
  if (/timeout|timed out|network/i.test(t)) {
    return "A search or fetch timed out. The trail is still open.";
  }
  if (/rate limit/i.test(t)) {
    return "Dark Desk is pausing so we do not overrun the hourly research budget. Try again in a bit.";
  }
  return t
    .replace(/\bfrontier\b/gi, "leads")
    .replace(/\bhop budget\b/gi, "research budget");
}

export function editorPauseReason(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const budget = raw.match(/(\d+)\s+frontier item/i);
  if (budget) {
    return `Research paused with ${budget[1]} leads still open. A budget pause is not the end of the trail.`;
  }
  return editorError(raw);
}

export function progressLine(input: {
  running: boolean;
  status: string;
  hops: number;
  budget: number;
  artifacts: number;
  searches: number;
  claims: number;
}): string {
  if (input.running && input.hops === 0 && input.artifacts === 0) {
    return "Searching records…";
  }
  if (input.running || input.status === "investigating") {
    if (input.artifacts > 0 && input.hops > 0) {
      return `${input.artifacts} sources on file. Hop ${input.hops} of ${input.budget || 5}…`;
    }
    if (input.hops > 0) return `Following references… Hop ${input.hops} of ${input.budget || 5}…`;
    if (input.searches > 0) return "Following references…";
    if (input.artifacts > 0) return `${input.artifacts} sources on file. Checking prior records…`;
    if (input.claims > 0) return "Testing what the records support…";
    return "Checking prior records…";
  }
  if (input.status === "paused") return "Paused with work remaining.";
  if (input.artifacts > 0) return `Research pass complete. ${input.artifacts} sources on file.`;
  return "Research pass complete.";
}
