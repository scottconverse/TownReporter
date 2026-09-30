import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import type { ProvenanceItem } from "./findings.ts";

import { CHANGE_SENTENCES_MAX, describeTextChanges, type VersionDiff } from "./retrieve.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { parseFindings } from "./findings.ts";
import { evidenceUrl, evidenceCompareInput, rowId } from "./request-input.ts";

/**
 * How much of a capture a reader may see.
 *
 * A public evidence page used to print up to 80,000 characters of the page we
 * captured -- a third party's article, whole and crawlable, on a paper whose
 * own "How we report" page promises "We do not copy their article". The owner
 * decided on 2026-09-30 that a public evidence page shows an excerpt and a
 * link. This is the excerpt's ceiling, enforced where the record is BUILT
 * (`asPublicEvidence`), not only where it is printed: the desk's own reader
 * of a capture may still see all of it, and the public server function must
 * never hand the rest to a browser in the first place.
 */
export const PUBLIC_EXCERPT_MAX = 600;

/**
 * Bounds on what a public comparison may show, across BOTH sides: at most
 * `PUBLIC_CHANGE_SNIPPETS_MAX` snippets in total, each at most
 * `PUBLIC_CHANGE_SNIPPET_MAX` characters, and all of them together at most
 * `PUBLIC_CHANGE_CHARS_MAX`.
 *
 * The caps are on the whole payload, not per side. Three per side would let a
 * comparison hand back six snippets of 200 characters -- 1,200 characters of
 * two third-party pages, twice the evidence page's own 600-character excerpt.
 */
export const PUBLIC_CHANGE_SNIPPETS_MAX = 3;
export const PUBLIC_CHANGE_SNIPPET_MAX = 200;
export const PUBLIC_CHANGE_CHARS_MAX = 600;

const ELLIPSIS = "…";

/**
 * What a public comparison returns.
 *
 * `describeTextChanges` diffs the full captures server-side, which is the
 * point of the comparison -- but a diff of two articles is the articles back.
 * The reader gets the counts and the first few changed sentences, cut at a
 * word boundary, and no more.
 *
 * `*_total_at_least` says the server-side diff stopped counting at its own cap
 * (`CHANGE_SENTENCES_MAX`), so the total beside it is a floor.
 */
export type PublicVersionDiff = {
  added: string[];
  removed: string[];
  added_total: number;
  removed_total: number;
  added_total_at_least: boolean;
  removed_total_at_least: boolean;
};

/** Cut to at most `max` characters, ending on a word boundary. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max - ELLIPSIS.length);
  const space = window.lastIndexOf(" ");
  const body = space > 0 ? window.slice(0, space) : window;
  return `${body.trimEnd()}${ELLIPSIS}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where a stored receipt sits in a capture, whitespace-insensitively.
 *
 * The quote was copied out of the capture, but the capture is re-wrapped
 * between fetches and a sentence can acquire a newline in the middle. Matching
 * word-by-word lets the passage be found without normalising a whole document
 * just to look for it.
 */
function receiptOffset(text: string, quote: string): number {
  const words = quote.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!words.length) return -1;
  const match = new RegExp(words.join("\\s+"), "i").exec(text);
  return match ? match.index : -1;
}

/** The opening of a capture, cut at a word boundary. */
function openingExcerpt(text: string, max: number): string {
  return cutAtWord(text.replace(/\s+/g, " ").trim(), max);
}

/**
 * A window centred on the passage the story actually quoted.
 *
 * Falls back to null when the receipt is not in this capture at all (a story
 * may cite an earlier version than the one being read) or is too long to fit,
 * so the caller can take the capture's opening instead.
 */
function excerptAroundReceipt(text: string, quote: string): string | null {
  const at = receiptOffset(text, quote);
  if (at < 0) return null;
  // Room for the passage and for an ellipsis on either side.
  const budget = PUBLIC_EXCERPT_MAX - ELLIPSIS.length * 2;
  if (quote.length > budget) return null;
  const spare = budget - quote.length;
  const before = Math.min(at, Math.floor(spare / 2));
  const after = Math.min(text.length - (at + quote.length), spare - before);
  const start = at - before;
  const end = at + quote.length + after;
  let out = text.slice(start, end).replace(/\s+/g, " ").trim();
  // Trim partial words at an edge that falls inside a word. Never inside the
  // passage itself: `before`/`after` are zero exactly when the edge is the
  // passage's own boundary, which the match already put on a word bound.
  if (before > 0) out = out.replace(/^\S*\s+/, "");
  if (after > 0) out = out.replace(/\s+\S*$/, "");
  return `${start > 0 ? ELLIPSIS : ""}${out}${end < text.length ? ELLIPSIS : ""}`;
}

/**
 * A reader's excerpt of a capture: the passage a published story quoted from
 * it when there is one, and the opening when there is not.
 */
function publicExcerpt(fullText: string, receipts: string[]): string {
  for (const receipt of receipts) {
    const quote = receipt.replace(/\s+/g, " ").trim();
    if (!quote) continue;
    const centred = excerptAroundReceipt(fullText, quote);
    if (centred) return centred;
  }
  return openingExcerpt(fullText, PUBLIC_EXCERPT_MAX);
}

/**
 * Bound what a public comparison shows.
 *
 * One budget, spent in a fixed order -- removed first, then added. The reader
 * sees what the page lost before what it gained, and two identical requests
 * return the same snippet set, which a per-side cap decided by map order would
 * not guarantee.
 *
 * `cutAtWord` is asked for the smaller of the per-snippet cap and what is left
 * of the budget, so the character cap holds even if the other constants move.
 * It cannot actually bite today: three snippets of at most 200 characters is
 * exactly 600, so a free slot always has a full 200 characters behind it and
 * no snippet is ever cut to a stub.
 */
export function publicVersionDiff(diff: VersionDiff): PublicVersionDiff {
  let snippets = PUBLIC_CHANGE_SNIPPETS_MAX;
  let characters = PUBLIC_CHANGE_CHARS_MAX;
  const take = (rows: string[]): string[] => {
    const out: string[] = [];
    for (const row of rows) {
      if (snippets <= 0 || characters <= 0) break;
      const snippet = cutAtWord(row, Math.min(PUBLIC_CHANGE_SNIPPET_MAX, characters));
      out.push(snippet);
      snippets -= 1;
      characters -= snippet.length;
    }
    return out;
  };
  const removed = take(diff.removed);
  const added = take(diff.added);
  return {
    removed,
    added,
    removed_total: diff.removed.length,
    added_total: diff.added.length,
    removed_total_at_least: diff.removed.length >= CHANGE_SENTENCES_MAX,
    added_total_at_least: diff.added.length >= CHANGE_SENTENCES_MAX,
  };
}

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
  /**
   * A short excerpt of the capture, never the capture. See `PUBLIC_EXCERPT_MAX`.
   * Named for what it is so no caller can mistake it for the stored text.
   */
  excerpt: string;
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

type PublishedCitations = {
  /**
   * Every URL a published story cites, in the same canonical identity
   * retrieval stores. Membership is what makes a capture public at all.
   */
  urls: Set<string>;
  /**
   * The verbatim passages a published story recorded for a cited URL, keyed
   * the same way. These are the receipts the desk copied out of the capture
   * when it wrote the story (`StoryFinding.excerpt`), and they are the only
   * part of a capture a reader is shown in full.
   */
  receipts: Map<string, string[]>;
};

function canonicalOrNull(url: string): string | null {
  try {
    return canonicalPublicUrl(url);
  } catch {
    return null;
  }
}

async function publishedCitations(): Promise<PublishedCitations> {
  const sql = await getSql();
  const rows = await sql<{
    provenance_json: string | null;
    source_urls: string;
    found_note: string | null;
  }>`
    select provenance_json, source_urls, found_note from articles
    where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
  `;
  const urls = new Set<string>();
  const receipts = new Map<string, string[]>();
  for (const row of rows) {
    const cited: string[] = [];
    const items = provenanceFromRow(row.provenance_json);
    for (const item of items) if (item.url) cited.push(item.url);
    try {
      const listed = JSON.parse(row.source_urls || "[]") as unknown;
      if (Array.isArray(listed)) for (const u of listed) if (typeof u === "string") cited.push(u);
    } catch {
      /* ignore */
    }
    const keys = cited.map(canonicalOrNull).filter((key): key is string => key != null);
    // An article cites a URL even when it recorded no quote from it: the
    // capture is public, the excerpt is just the capture's opening.
    for (const key of keys) {
      urls.add(key);
      if (!receipts.has(key)) receipts.set(key, []);
    }
    for (const finding of parseFindings(row.found_note)) {
      const quote = finding.excerpt?.replace(/\s+/g, " ").trim();
      if (!quote) continue;
      for (const source of finding.source_urls) {
        const key = canonicalOrNull(source);
        // Only for a source this article's own citation list carries, the
        // same demand `resolvePublicFindings` makes of a printed finding.
        if (!key || !keys.includes(key)) continue;
        const list = receipts.get(key)!;
        if (!list.includes(quote)) list.push(quote);
      }
    }
  }
  return { urls, receipts };
}

function isPublicUrl(url: string, published: PublishedCitations): boolean {
  // Retrieval stores canonical URLs; an article may retain the source's
  // trailing slash or tracking parameters. Use the same identity as retrieval.
  const canonical = canonicalOrNull(url);
  return canonical != null && published.urls.has(canonical);
}

function receiptsFor(published: PublishedCitations, url: string): string[] {
  const canonical = canonicalOrNull(url);
  return canonical == null ? [] : published.receipts.get(canonical) ?? [];
}

async function blobForVersion(versionId: number | null): Promise<{
  byte_length: number | null;
} | null> {
  if (versionId == null) return null;
  try {
    const sql = await getSql();
    const b = await sql<{ byte_length: number }>`
      select byte_length from artifact_blobs
      where version_id = ${versionId} and newsroom_id = ${DEFAULT_NEWSROOM_ID} limit 1
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
  const canonical = canonicalPublicUrl(url);
  const events = await sql<CaptureRow>`
    select ce.id as capture_event_id, av.id as version_id, ce.observed_at::text as observed_at,
      ce.fetch_outcome, ce.disappearance, coalesce(ce.content_hash, av.content_hash) as content_hash,
      coalesce(av.title, '') as title, ce.source_url as url,
      av.full_text as full_text, av.content_hash as version_hash
    from capture_events ce
    left join artifact_versions av
      on av.id = ce.version_id
        and av.newsroom_id = ce.newsroom_id
        and av.url = ce.source_url
    where ce.newsroom_id = ${DEFAULT_NEWSROOM_ID} and ce.source_url in (${url}, ${canonical})
      and (ce.version_id is null or av.id is not null)
    order by ce.observed_at asc, ce.id asc
    limit 80
  `;
  if (events.length) return events;
  const versions = await sql<CaptureRow>`
    select av.id as capture_event_id, av.id as version_id, av.captured_at::text as observed_at,
      av.fetch_outcome, false as disappearance, av.content_hash as content_hash,
      av.title as title, av.url as url, av.full_text as full_text, av.content_hash as version_hash
    from artifact_versions av
    where av.newsroom_id = ${DEFAULT_NEWSROOM_ID} and av.url in (${url}, ${canonical})
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

/**
 * A public record and the capture behind it.
 *
 * The two travel together because a comparison diffs the captures themselves
 * -- that is what makes a comparison a comparison -- while everything that
 * leaves for a reader is the bounded `record`. `fullText` must never be
 * returned from a public server function.
 */
type LoadedEvidence = {
  record: PublicEvidence;
  fullText: string;
};

async function asPublicEvidence(
  row: CaptureRow,
  classified: ClassifiedCapture | undefined,
  timeline: TimelineEntry[],
  receipts: string[],
): Promise<LoadedEvidence> {
  const blob = await blobForVersion(row.version_id);
  const gone = classified?.disappeared ?? goneOutcome(row.fetch_outcome, row.disappearance);
  const fullText = row.full_text || "";
  return {
    fullText,
    record: {
      version_id: row.version_id,
      capture_event_id: row.capture_event_id,
      url: row.url,
      title: row.title || row.url,
      captured_at: row.observed_at,
      content_hash: row.version_hash || row.content_hash || "",
      fetch_outcome: row.fetch_outcome,
      disappeared: gone,
      excerpt: publicExcerpt(fullText, receipts),
      has_original_bytes: Boolean(blob?.byte_length),
      byte_length: blob?.byte_length ?? null,
      observation: classified?.observation ?? (gone ? "unavailable" : "captured"),
      previously_observed_at: classified?.previously_observed_at ?? null,
      content_label: classified?.content_label || (row.version_id != null ? `Content version ${row.version_id}` : ""),
      timeline,
    },
  };
}

async function loadPublicCaptureHistoryFull(url: string): Promise<LoadedEvidence[]> {
  const published = await publishedCitations();
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
  const out: LoadedEvidence[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    out.push(await asPublicEvidence(row, classified[i], timeline, receiptsFor(published, row.url)));
  }
  return out;
}

export async function listPublicCaptureHistory(url: string): Promise<PublicEvidence[]> {
  return (await loadPublicCaptureHistoryFull(url)).map((loaded) => loaded.record);
}

async function loadVersion(id: number): Promise<LoadedEvidence | null> {
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
    from artifact_versions
    where id = ${id} and newsroom_id = ${DEFAULT_NEWSROOM_ID} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const published = await publishedCitations();
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
  return asPublicEvidence(
    captureRow,
    idx >= 0 ? classified[idx] : undefined,
    timeline,
    receiptsFor(published, captureRow.url),
  );
}

/**
 * A capture, by id, for a reader.
 *
 * The id arrives from the URL, so it can be anything. `/evidence/NaN` used to
 * reach Postgres and the page printed what came back:
 *   invalid input syntax for type integer: "NaN"
 * -- a database error, as the body of a public page, on a paper whose whole
 * pitch is that readers can check the evidence. An audit filed it as UX-001.
 *
 * Anything that is not a positive whole number is simply not a capture that
 * exists, so it takes the same path as a capture that has been deleted: the
 * route's own not-in-this-edition page, which is what a reader should see.
 */
export async function loadPublicEvidence(id: number): Promise<PublicEvidence | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await loadVersion(id))?.record ?? null;
}

export async function comparePublishedEvidence(data: {
  url?: string;
  a?: number;
  b?: number;
}): Promise<{
  older: PublicEvidence;
  newer: PublicEvidence;
  changes: PublicVersionDiff;
  timeline: TimelineEntry[];
} | null> {
  if (data.a && data.b) {
    const left = await loadVersion(data.a);
    const right = await loadVersion(data.b);
    if (!left || !right) return null;
    const leftAt = left.record.captured_at ? Date.parse(left.record.captured_at) : 0;
    const rightAt = right.record.captured_at ? Date.parse(right.record.captured_at) : 0;
    const older = leftAt <= rightAt ? left : right;
    const newer = leftAt <= rightAt ? right : left;
    return {
      older: older.record,
      newer: newer.record,
      // The diff runs on the captures themselves; only the bounded summary
      // leaves this function.
      changes: publicVersionDiff(describeTextChanges(older.fullText, newer.fullText)),
      timeline: newer.record.timeline.length ? newer.record.timeline : older.record.timeline,
    };
  }
  if (!data.url) return null;
  const history = await loadPublicCaptureHistoryFull(data.url);
  if (!history.length) return null;
  const classified: ClassifiedCapture[] = history.map((h) => ({
    capture_event_id: h.record.capture_event_id ?? 0,
    observed_at: h.record.captured_at,
    version_id: h.record.version_id,
    content_hash: h.record.content_hash,
    fetch_outcome: h.record.fetch_outcome,
    disappeared: h.record.disappeared,
    title: h.record.title,
    observation: h.record.observation,
    content_label: h.record.content_label,
    previously_observed_at: h.record.previously_observed_at,
  }));
  const pair = selectComparePair(classified);
  if (!pair) {
    const only = history[history.length - 1]!;
    return {
      older: only.record,
      newer: only.record,
      changes: publicVersionDiff({ added: [], removed: [] }),
      timeline: only.record.timeline,
    };
  }
  const older =
    history.find((h) => h.record.capture_event_id === pair.older.capture_event_id) ??
    history.find((h) => h.record.version_id === pair.older.version_id);
  const newer =
    history.find((h) => h.record.capture_event_id === pair.newer.capture_event_id) ??
    history.find((h) => h.record.version_id === pair.newer.version_id);
  if (!older || !newer) return null;
  return {
    older: older.record,
    newer: newer.record,
    changes: publicVersionDiff(describeTextChanges(older.fullText, newer.fullText)),
    timeline: newer.record.timeline,
  };
}

export const getPublicEvidence = createServerFn({ method: "GET" })
  .validator((versionId: number) => rowId.parse(versionId))
  .handler(async ({ data: versionId }) => loadPublicEvidence(versionId));

export const listPublicHistory = createServerFn({ method: "GET" })
  .validator((url: string) => evidenceUrl.parse(url))
  .handler(async ({ data: url }) => listPublicCaptureHistory(url));

export const listPublicVersionsForUrl = createServerFn({ method: "GET" })
  .validator((url: string) => evidenceUrl.parse(url))
  .handler(async ({ data: url }) => listPublicCaptureHistory(url));

export const comparePublicEvidence = createServerFn({ method: "GET" })
  .validator((input: { url?: string; a?: number; b?: number }) => evidenceCompareInput.parse(input))
  .handler(async ({ data }) => comparePublishedEvidence(data));
