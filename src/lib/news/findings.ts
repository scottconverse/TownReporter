import { sanitizePublicUrls } from "./schema.ts";

export type ProvenanceItem = {
  title: string;
  organization: string;
  document_date: string;
  url: string;
  captured_at: string | null;
  version_id: number | null;
  version_count: number | null;
  capture_event_id?: number | null;
  disappeared: boolean;
  role: string;
};

export type StoryFinding = {
  text: string;
  source_urls: string[];
  capture_event_ids: number[];
  artifact_version_ids: number[];
  locators: string[];
  excerpt?: string;
};

export function describeSourceUrl(url: string): { title: string; organization: string } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "");
    const parts = u.pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] ?? "");
    const cleaned = last
      .replace(/\.[a-z0-9]{2,4}$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const title =
      cleaned && !/^(index|home|default)$/i.test(cleaned)
        ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase())
        : host;
    return { title, organization: host };
  } catch {
    return { title: url, organization: "" };
  }
}

function nonempty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isWeakTitle(title: string, url: string): boolean {
  const t = title.trim().toLowerCase();
  if (!t) return true;
  const desc = describeSourceUrl(url);
  return t === desc.organization.toLowerCase() || t === url.toLowerCase();
}

function isWeakOrg(org: string, url: string): boolean {
  const o = org.trim().toLowerCase();
  if (!o) return true;
  return o === describeSourceUrl(url).organization.toLowerCase();
}

function pickReporting(
  current: string,
  incoming: string | undefined,
  weak: (value: string) => boolean,
): string {
  const inc = nonempty(incoming);
  const cur = nonempty(current);
  if (!inc) return cur;
  if (!cur || weak(cur)) {
    if (!weak(inc) || !cur) return inc;
  }
  return cur;
}

export function mergeProvenanceItem(
  base: ProvenanceItem,
  extra: Partial<ProvenanceItem>,
): ProvenanceItem {
  const url = extra.url || base.url;
  return {
    url,
    title: pickReporting(base.title, extra.title, (v) => isWeakTitle(v, url)),
    organization: pickReporting(base.organization, extra.organization, (v) => isWeakOrg(v, url)),
    document_date: pickReporting(base.document_date, extra.document_date, (v) => !v),
    role: pickReporting(base.role, extra.role, (v) => !v || v === "source") || "source",
    captured_at:
      extra.captured_at !== undefined && extra.captured_at !== null && extra.captured_at !== ""
        ? extra.captured_at
        : base.captured_at,
    version_id: extra.version_id != null ? extra.version_id : base.version_id,
    version_count: extra.version_count != null ? extra.version_count : base.version_count,
    capture_event_id:
      extra.capture_event_id != null ? extra.capture_event_id : base.capture_event_id ?? null,
    disappeared: extra.disappeared !== undefined ? Boolean(extra.disappeared) : base.disappeared,
  };
}

function blankProvenance(url: string): ProvenanceItem {
  return {
    title: "",
    organization: "",
    document_date: "",
    url,
    captured_at: null,
    version_id: null,
    version_count: null,
    capture_event_id: null,
    disappeared: false,
    role: "",
  };
}

function finalizeProvenance(item: ProvenanceItem): ProvenanceItem {
  const desc = describeSourceUrl(item.url);
  return {
    ...item,
    title: item.title || desc.title,
    organization: item.organization || desc.organization,
    role: item.role || "source",
  };
}

export function provenanceFromUrls(
  urls: string[],
  extras: Partial<ProvenanceItem>[] = [],
): ProvenanceItem[] {
  const byUrl = new Map<string, ProvenanceItem>();
  for (const url of urls) {
    if (!url) continue;
    byUrl.set(url, blankProvenance(url));
  }
  for (const extra of extras) {
    if (!extra.url) continue;
    const cur = byUrl.get(extra.url) ?? blankProvenance(extra.url);
    byUrl.set(extra.url, mergeProvenanceItem(cur, extra));
  }
  return [...byUrl.values()].map(finalizeProvenance);
}

function asIntList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 16);
}

export function parseFindings(raw: unknown): StoryFinding[] {
  if (raw == null || raw === "") return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return [
        {
          text: trimmed.slice(0, 1200),
          source_urls: [],
          capture_event_ids: [],
          artifact_version_ids: [],
          locators: [],
        },
      ];
    }
  }
  const rows = Array.isArray(value) ? value : [value];
  const out: StoryFinding[] = [];
  for (const row of rows) {
    if (typeof row === "string" && row.trim()) {
      out.push({
        text: row.trim().slice(0, 1200),
        source_urls: [],
        capture_event_ids: [],
        artifact_version_ids: [],
        locators: [],
      });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const text = String(o.text ?? o.found ?? "").trim();
    if (!text) continue;
    out.push({
      text: text.slice(0, 1200),
      source_urls: sanitizePublicUrls(o.source_urls),
      capture_event_ids: asIntList(o.capture_event_ids),
      artifact_version_ids: asIntList(o.artifact_version_ids ?? o.version_ids),
      locators: Array.isArray(o.locators) ? o.locators.map(String).slice(0, 12) : [],
      excerpt: typeof o.excerpt === "string" ? o.excerpt.slice(0, 800) : undefined,
    });
  }
  return out.slice(0, 6);
}

export function serializeFindings(findings: StoryFinding[]): string {
  if (!findings.length) return "";
  return JSON.stringify(findings);
}

export function resolvePublicFindings(
  findings: StoryFinding[],
  provenance: ProvenanceItem[],
): StoryFinding[] {
  const urls = new Set(provenance.map((p) => p.url));
  const versions = new Set(
    provenance.map((p) => p.version_id).filter((id): id is number => id != null),
  );
  const captures = new Set(
    provenance
      .map((p) => p.capture_event_id)
      .filter((id): id is number => id != null),
  );
  return findings.filter((f) => {
    if (!f.text.trim()) return false;
    const urlOk = f.source_urls.some((u) => urls.has(u));
    if (!urlOk) return false;
    const versionOk = f.artifact_version_ids.some((id) => versions.has(id));
    const captureOk = f.capture_event_ids.some((id) => captures.has(id));
    return versionOk || captureOk;
  });
}
