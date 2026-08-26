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
      return "Showed up again";
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
      return "From the scanner";
    case "signal":
      return "Earlier note";
    default:
      return "Worth a look";
  }
}

export function editorStatus(status: string): string {
  switch (status) {
    case "investigating":
      return "Looking now";
    case "paused":
      return "Stopped — more to read";
    case "open":
      return "Ready to continue";
    case "exhausted":
    case "closed":
      return "Set aside";
    default:
      return status.replace(/[-_]/g, " ");
  }
}

export function editorError(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const t = raw.trim();
  if (/cannot read propert/i.test(t) || /undefined \(reading/i.test(t) || /is not a function/i.test(t)) {
    return "Something broke after the records were already saved. Nothing was thrown away. Click Keep digging to continue.";
  }
  if (/403/.test(t) || /forbidden/i.test(t)) {
    return "The writing model was unavailable. Searches and captures already ran are kept. Click Keep digging to retry.";
  }
  if (/xai api error/i.test(t) || /api error/i.test(t) || /AI is not available/i.test(t)) {
    return "The writing model did not finish this round. Searches and captures already ran are kept. Click Keep digging to continue.";
  }
  if (/timeout|timed out|network/i.test(t)) {
    return "A search or page load timed out. What was already found is still here.";
  }
  if (/rate limit/i.test(t)) {
    return "Dark Desk paused so it does not burn through the hourly allowance. Try again in a bit.";
  }
  return plainEditorText(t);
}

export function editorPauseReason(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  if (/editor set this aside/i.test(raw)) {
    return "You set this aside. Pull it back onto the desk anytime.";
  }
  const budget = raw.match(/(\d+)\s+frontier item/i);
  if (budget) {
    const n = budget[1];
    return `Dark Desk opened a batch of records, then stopped so it would not run all night. It still has ${n} pages, names, or documents it has not opened yet. That is normal — not an error, and not “too many leads.” Click Keep digging to read the next batch.`;
  }
  return editorError(raw);
}

export function looksLikeInternalSummary(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /^(heuristic hop:|hops \d|opened from dark desk|looked through \d+ rounds)/i.test(t);
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
  const round = input.hops;
  const of = input.budget || 5;
  if (input.running && round === 0 && input.artifacts === 0) {
    return "Searching records…";
  }
  if (input.running || input.status === "investigating") {
    if (input.artifacts > 0 && round > 0) {
      return `${input.artifacts} records on file. Round ${round} of ${of}…`;
    }
    if (round > 0) return `Still reading. Round ${round} of ${of}…`;
    if (input.searches > 0) return "Following names and documents mentioned in the records…";
    if (input.artifacts > 0) return `${input.artifacts} records on file. Checking earlier copies…`;
    if (input.claims > 0) return "Checking what the records actually say…";
    return "Checking earlier copies…";
  }
  if (input.status === "paused") {
    return "Finished this round. More still to open.";
  }
  if (input.artifacts > 0) return `This round is done. ${input.artifacts} records on file.`;
  return "This round is done.";
}

/** Strip engine jargon from anything an editor might read. */
export function plainEditorText(text: string): string {
  return text
    .replace(
      /Hops?\s+(\d+)\.?\s*Artifacts?\s+(\d+)\.?\s*Open frontier\s+(\d+)\.?/gi,
      (_m, h, a, f) =>
        `Looked through ${h} rounds. Saved ${a} records. ${f} things still to open.`,
    )
    .replace(
      /Heuristic hop:\s*(\d+) searches,\s*(\d+) fetches,\s*(\d+) frontier items\.?/gi,
      (_m, s, f, n) =>
        `This round ran ${s} searches and opened ${f} pages. It added ${n} things to follow.`,
    )
    .replace(/Hop budget \d+ reached with (\d+) frontier item\(s\) still open[^.]*\./gi, (_m, n) => {
      return `Stopped after this round with ${n} things still to open.`;
    })
    .replace(/\bhop budget\b/gi, "this round")
    .replace(/\bfrontier items?\b/gi, "things to follow")
    .replace(/\bfrontier\b/gi, "to-follow list")
    .replace(/\bartifacts?\b/gi, "records")
    .replace(/\bhops?\b/gi, "rounds")
    .replace(/\bSynthesis:\s*/gi, "")
    .replace(/xAI API error \d+/gi, "the writing model did not finish")
    .replace(/Previously parked\s*\([^)]*\)\.?\s*/gi, "")
    .replace(/Reopened from resolved:?\s*/gi, "")
    .replace(/Prior:\s*Fetched\.?/gi, "")
    .replace(/Planner fetch target/gi, "mentioned in a record")
    .replace(/Queued for fetch/gi, "waiting to be opened")
    .replace(/Attachment\/document link on/gi, "linked from")
    .replace(/Discovered this hop — fetch next/gi, "turned up this round — not opened yet")
    .replace(/Budget pauses work; evidence exhaustion would close it\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function plainFinding(summary: string, url?: string | null): string {
  const extracted = url || summary.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  const title = extracted ? headlineFromUrl(extracted) : "";
  const org = extracted ? organizationFromUrl(extracted) : "";
  const who = title || org;
  if (/document changed/i.test(summary)) {
    if (/youtube\.com/i.test(extracted || summary)) {
      return `${who || "A YouTube page"} looks different than the last time Dark Desk captured it. That may just be a new video, not a vanished record.`;
    }
    return `${who || "A page Dark Desk already had on file"} looks different than the last time it was captured.`;
  }
  if (/previously captured document is gone|is gone:/i.test(summary)) {
    return `${who || "A record"} is no longer at the address Dark Desk had.`;
  }
  if (/restored/i.test(summary)) {
    return `${who || "A record"} is back after previously being missing.`;
  }
  const cleaned = plainEditorText(summary);
  if (extracted && /https?:\/\//i.test(cleaned)) {
    return cleaned.replace(extracted, who || org || "that page");
  }
  return cleaned;
}

export function titlesOverlap(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 12 && nb.length >= 12 && (na.includes(nb) || nb.includes(na))) return true;
  const words = na.split(" ").filter((w) => w.length > 3);
  if (words.length < 2) return false;
  const hit = words.filter((w) => nb.includes(w)).length;
  return hit >= 2 && hit / words.length >= 0.5;
}

export function worthItemOnDesk(
  item: { id: string; title: string; source_url?: string },
  investigations: { title: string }[],
  claimedIds: string[] = [],
): boolean {
  if (claimedIds.includes(item.id)) return true;
  return investigations.some((inv) => titlesOverlap(item.title, inv.title));
}

export function pileForStatus(status: string): "desk" | "aside" {
  if (["open", "investigating", "paused"].includes(status)) return "desk";
  return "aside";
}
