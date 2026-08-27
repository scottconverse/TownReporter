import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import type { ProvenanceItem } from "./findings.ts";

import { describeTextChanges, type VersionDiff } from "./retrieve.ts";

export type CaptureObservationKind =
  | "captured"
  | "changed"
  | "reverted"
  | "unavailable"
  | "restored"
  | "unchanged";

export type TimelineEntry = {
  capture_event_id: number;
  version_id: number | null;
  observed_at: string | null;
  observation: CaptureObservationKind;
  disappeared: boolean;
  content_label: string;
  content_hash: string | null;
  fetch_outcome: string;
  title: string;
};

export type PublicEvidence = {
  version_id: number | null;
  capture_event_id: number | null;
  url: string;
  title: string;
  captured_at: string | null;
  content_hash: string;
  fetch_outcome: string;
  disappeared: boolean;
  extraction_text: string;
  has_original_bytes: boolean;
  byte_length: number | null;
  observation: CaptureObservationKind;
  previously_observed_at: string | null;
  content_label: string;
  timeline: TimelineEntry[];
};

export type RawCapture = {
  capture_event_id: number;
  observed_at: string | null;
  version_id: number | null;
  content_hash: string | null;
  fetch_outcome: string;
  disappeared?: boolean;
  title?: string;
};

export type ClassifiedCapture = RawCapture & {
  observation: CaptureObservationKind;
  content_label: string;
  previously_observed_at: string | null;
  disappeared: boolean;
};

function goneOutcome(outcome: string, disappeared?: boolean): boolean {
  if (disappeared) return true;
  return /removed|not-found|soft-404|disappeared|unavailable/i.test(outcome);
}

/** Observation chronology. Repeated content is kept. Missing stays an event. */
export function classifyCaptureTimeline(events: RawCapture[]): ClassifiedCapture[] {
  const firstSeen: string[] = [];
  const lastSeenAt = new Map<string, string | null>();
  let lastContentHash: string | null = null;
  let lastGone = false;
  const out: ClassifiedCapture[] = [];
  for (const e of events) {
    const gone = goneOutcome(e.fetch_outcome, e.disappeared) || !e.content_hash || e.version_id == null;
    let observation: CaptureObservationKind;
    let contentLabel = "";
    let previously: string | null = null;
    if (gone) {
      observation = "unavailable";
      lastGone = true;
    } else {
      const hash = e.content_hash!;
      previously = lastSeenAt.get(hash) ?? null;
      const seenBefore = firstSeen.includes(hash);
      if (!firstSeen.length) {
        observation = "captured";
        firstSeen.push(hash);
      } else if (lastGone) {
        observation = "restored";
        if (!seenBefore) firstSeen.push(hash);
      } else if (hash === lastContentHash) {
        observation = "unchanged";
      } else if (seenBefore) {
        observation = "reverted";
      } else {
        observation = "changed";
        firstSeen.push(hash);
      }
      const idx = firstSeen.indexOf(hash);
      contentLabel = `Content version ${idx + 1}`;
      lastSeenAt.set(hash, e.observed_at);
      lastContentHash = hash;
      lastGone = false;
    }
    out.push({
      ...e,
      disappeared: gone,
      observation,
      content_label: contentLabel,
      previously_observed_at: previously,
    });
  }
  return out;
}

/** Previous distinct content-bearing capture vs the latest content-bearing capture. */
export function selectComparePair(
  history: ClassifiedCapture[],
): { older: ClassifiedCapture; newer: ClassifiedCapture } | null {
  const contentful = history.filter((e) => e.version_id != null && e.content_hash && !e.disappeared);
  if (!contentful.length) return null;
  const newer = contentful[contentful.length - 1]!;
  for (let i = contentful.length - 2; i >= 0; i -= 1) {
    const prev = contentful[i]!;
    if (prev.content_hash !== newer.content_hash) return { older: prev, newer };
  }
  if (contentful.length >= 2) return { older: contentful[contentful.length - 2]!, newer };
  return { older: newer, newer };
}

function provenanceFromRow(raw: string | null | undefined): ProvenanceItem[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? (v as ProvenanceItem[]) : [];
  } catch {
    return [];
  }
}

async function publishedSourceUrls(): Promise<Set<string>> {
  const sql = await getSql();
  const rows = await sql<{ provenance_json: string | null; source_urls: string }>`
    select provenance_json, source_urls from articles where status = 'published'
  `;
  const urls = new Set<string>();
  for (const row of rows) {
    const items = provenanceFromRow(row.provenance_json);
    for (const item of items) if (item.url) urls.add(item.url);
    try {
      const listed = JSON.parse(row.source_urls || "[]") as unknown;
      if (Array.isArray(listed)) for (const u of listed) if (typeof u === "string") urls.add(u);
    } catch {
      /* ignore */
    }
  }
  return urls;
}

function isPublicUrl(url: string, published: Set<string>): boolean {
  return published.has(url);
}

async function blobForVersion(versionId: number | null): Promise<{
  byte_length: number | null;
} | null> {
  if (versionId == null) return null;
  try {
    const sql = await getSql();
    const b = await sql<{ byte_length: number }>`
      select byte_length from artifact_blobs where version_id = ${versionId} limit 1
    `;
    return b[0] ? { byte_length: b[0].byte_length } : null;
  } catch {
    return null;
  }
}

type CaptureRow = {
  capture_event_id: number;
  version_id: number | null;
  observed_at: string | null;
  fetch_outcome: string;
  disappearance: boolean;
  content_hash: string | null;
  title: string | null;
  url: string;
  full_text: string | null;
  version_hash: string | null;
};

async function loadCapturesForUrl(url: string): Promise<CaptureRow[]> {
  const sql = await getSql();
  const events = await sql<CaptureRow>`
    select ce.id as capture_event_id, ce.version_id, ce.observed_at::text as observed_at,
      ce.fetch_outcome, ce.disappearance, coalesce(ce.content_hash, av.content_hash) as content_hash,
      coalesce(av.title, '') as title, ce.source_url as url,
      av.full_text as full_text, av.content_hash as version_hash
    from capture_events ce
    left join artifact_versions av on av.id = ce.version_id
    where ce.source_url = ${url}
    order by ce.observed_at asc, ce.id asc
    limit 80
  `;
  if (events.length) return events;
  const versions = await sql<CaptureRow>`
    select av.id as capture_event_id, av.id as version_id, av.captured_at::text as observed_at,
      av.fetch_outcome, false as disappearance, av.content_hash as content_hash,
      av.title as title, av.url as url, av.full_text as full_text, av.content_hash as version_hash
    from artifact_versions av
    where av.url = ${url}
    order by av.captured_at asc, av.id asc
    limit 40
  `;
  return versions;
}

function toTimeline(classified: ClassifiedCapture[]): TimelineEntry[] {
  return classified.map((c) => ({
    capture_event_id: c.capture_event_id,
    version_id: c.version_id,
    observed_at: c.observed_at,
    observation: c.observation,
    disappeared: c.disappeared,
    content_label: c.content_label,
    content_hash: c.content_hash,
    fetch_outcome: c.fetch_outcome,
    title: c.title ?? "",
  }));
}

async function asPublicEvidence(
  row: CaptureRow,
  classified: ClassifiedCapture | undefined,
  timeline: TimelineEntry[],
): Promise<PublicEvidence> {
  const blob = await blobForVersion(row.version_id);
  const gone = classified?.disappeared ?? goneOutcome(row.fetch_outcome, row.disappearance);
  return {
    version_id: row.version_id,
    capture_event_id: row.capture_event_id,
    url: row.url,
    title: row.title || row.url,
    captured_at: row.observed_at,
    content_hash: row.version_hash || row.content_hash || "",
    fetch_outcome: row.fetch_outcome,
    disappeared: gone,
    extraction_text: (row.full_text || "").slice(0, 80_000),
    has_original_bytes: Boolean(blob?.byte_length),
    byte_length: blob?.byte_length ?? null,
    observation: classified?.observation ?? (gone ? "unavailable" : "captured"),
    previously_observed_at: classified?.previously_observed_at ?? null,
    content_label: classified?.content_label || (row.version_id != null ? `Content version ${row.version_id}` : ""),
    timeline,
  };
}

export async function listPublicCaptureHistory(url: string): Promise<PublicEvidence[]> {
  const published = await publishedSourceUrls();
  if (!isPublicUrl(url, published)) return [];
  const rows = await loadCapturesForUrl(url);
  const classified = classifyCaptureTimeline(
    rows.map((r) => ({
      capture_event_id: r.capture_event_id,
      observed_at: r.observed_at,
      version_id: r.version_id,
      content_hash: r.version_hash || r.content_hash,
      fetch_outcome: r.fetch_outcome,
      disappeared: r.disappearance,
      title: r.title || "",
    })),
  );
  const timeline = toTimeline(classified);
  const out: PublicEvidence[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    out.push(await asPublicEvidence(rows[i]!, classified[i], timeline));
  }
  return out;
}

async function loadVersion(id: number): Promise<PublicEvidence | null> {
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    url: string;
    title: string;
    captured_at: string | null;
    content_hash: string;
    fetch_outcome: string;
    full_text: string;
  }>`
    select id, url, title, captured_at::text as captured_at, content_hash, fetch_outcome, full_text
    from artifact_versions where id = ${id} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const published = await publishedSourceUrls();
  if (!isPublicUrl(row.url, published)) return null;
  const history = await loadCapturesForUrl(row.url);
  const classified = classifyCaptureTimeline(
    history.map((r) => ({
      capture_event_id: r.capture_event_id,
      observed_at: r.observed_at,
      version_id: r.version_id,
      content_hash: r.version_hash || r.content_hash,
      fetch_outcome: r.fetch_outcome,
      disappeared: r.disappearance,
      title: r.title || "",
    })),
  );
  const timeline = toTimeline(classified);
  const match =
    [...history].reverse().find((r) => r.version_id === id) ??
    history.find((r) => r.version_id === id);
  const idx = match ? history.indexOf(match) : -1;
  const captureRow: CaptureRow = match ?? {
    capture_event_id: row.id,
    version_id: row.id,
    observed_at: row.captured_at,
    fetch_outcome: row.fetch_outcome,
    disappearance: goneOutcome(row.fetch_outcome),
    content_hash: row.content_hash,
    title: row.title,
    url: row.url,
    full_text: row.full_text,
    version_hash: row.content_hash,
  };
  return asPublicEvidence(captureRow, idx >= 0 ? classified[idx] : undefined, timeline);
}

export async function loadPublicEvidence(id: number): Promise<PublicEvidence | null> {
  return loadVersion(id);
}

export async function comparePublishedEvidence(data: {
  url?: string;
  a?: number;
  b?: number;
}): Promise<{
  older: PublicEvidence;
  newer: PublicEvidence;
  changes: VersionDiff;
  timeline: TimelineEntry[];
} | null> {
  if (data.a && data.b) {
    const left = await loadVersion(data.a);
    const right = await loadVersion(data.b);
    if (!left || !right) return null;
    const leftAt = left.captured_at ? Date.parse(left.captured_at) : 0;
    const rightAt = right.captured_at ? Date.parse(right.captured_at) : 0;
    const older = leftAt <= rightAt ? left : right;
    const newer = leftAt <= rightAt ? right : left;
    return {
      older,
      newer,
      changes: describeTextChanges(older.extraction_text, newer.extraction_text),
      timeline: newer.timeline.length ? newer.timeline : older.timeline,
    };
  }
  if (!data.url) return null;
  const history = await listPublicCaptureHistory(data.url);
  if (!history.length) return null;
  const classified: ClassifiedCapture[] = history.map((h) => ({
    capture_event_id: h.capture_event_id ?? 0,
    observed_at: h.captured_at,
    version_id: h.version_id,
    content_hash: h.content_hash,
    fetch_outcome: h.fetch_outcome,
    disappeared: h.disappeared,
    title: h.title,
    observation: h.observation,
    content_label: h.content_label,
    previously_observed_at: h.previously_observed_at,
  }));
  const pair = selectComparePair(classified);
  if (!pair) {
    const only = history[history.length - 1]!;
    return {
      older: only,
      newer: only,
      changes: { added: [], removed: [] },
      timeline: only.timeline,
    };
  }
  const older =
    history.find((h) => h.capture_event_id === pair.older.capture_event_id) ??
    history.find((h) => h.version_id === pair.older.version_id);
  const newer =
    history.find((h) => h.capture_event_id === pair.newer.capture_event_id) ??
    history.find((h) => h.version_id === pair.newer.version_id);
  if (!older || !newer) return null;
  return {
    older,
    newer,
    changes: describeTextChanges(older.extraction_text, newer.extraction_text),
    timeline: newer.timeline,
  };
}

export const getPublicEvidence = createServerFn({ method: "GET" })
  .validator((versionId: number) => versionId)
  .handler(async ({ data: versionId }) => loadPublicEvidence(versionId));

export const listPublicHistory = createServerFn({ method: "GET" })
  .validator((url: string) => url)
  .handler(async ({ data: url }) => listPublicCaptureHistory(url));

export const listPublicVersionsForUrl = createServerFn({ method: "GET" })
  .validator((url: string) => url)
  .handler(async ({ data: url }) => listPublicCaptureHistory(url));

export const comparePublicEvidence = createServerFn({ method: "GET" })
  .validator((input: { url?: string; a?: number; b?: number }) => input)
  .handler(async ({ data }) => comparePublishedEvidence(data));
