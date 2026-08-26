import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import type { ProvenanceItem } from "./report.ts";
import { describeTextChanges, type VersionDiff } from "./retrieve.ts";

export type PublicEvidence = {
  version_id: number;
  url: string;
  title: string;
  captured_at: string | null;
  content_hash: string;
  fetch_outcome: string;
  disappeared: boolean;
  extraction_text: string;
  has_original_bytes: boolean;
  byte_length: number | null;
};

function provenanceFromRow(raw: string | null | undefined): ProvenanceItem[] {
  try {
    const v = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(v) ? (v as ProvenanceItem[]) : [];
  } catch {
    return [];
  }
}

async function publishedIndex(): Promise<{ urls: Set<string>; versionIds: Set<number> }> {
  const sql = await getSql();
  const rows = await sql<{ provenance_json: string | null; source_urls: string }>`
    select provenance_json, source_urls from articles where status = 'published'
  `;
  const urls = new Set<string>();
  const versionIds = new Set<number>();
  for (const row of rows) {
    const items = provenanceFromRow(row.provenance_json);
    for (const item of items) {
      if (item.url) urls.add(item.url);
      if (item.version_id != null) versionIds.add(item.version_id);
    }
    try {
      const listed = JSON.parse(row.source_urls || "[]") as unknown;
      if (Array.isArray(listed)) for (const u of listed) if (typeof u === "string") urls.add(u);
    } catch {
      /* ignore */
    }
  }
  return { urls, versionIds };
}

function isPublicVersion(
  row: { id: number; url: string },
  index: { urls: Set<string>; versionIds: Set<number> },
): boolean {
  return index.versionIds.has(row.id) || index.urls.has(row.url);
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
  const index = await publishedIndex();
  if (!isPublicVersion(row, index)) return null;
  let blob: { byte_length: number | null } | undefined;
  try {
    const b = await sql<{ byte_length: number }>`
      select byte_length from artifact_blobs where version_id = ${id} limit 1
    `;
    blob = b[0];
  } catch {
    blob = undefined;
  }
  const gone = /removed|not-found|soft-404|disappeared/i.test(row.fetch_outcome);
  return {
    version_id: row.id,
    url: row.url,
    title: row.title,
    captured_at: row.captured_at,
    content_hash: row.content_hash,
    fetch_outcome: row.fetch_outcome,
    disappeared: gone,
    extraction_text: row.full_text.slice(0, 80_000),
    has_original_bytes: Boolean(blob?.byte_length),
    byte_length: blob?.byte_length ?? null,
  };
}

export async function loadPublicEvidence(id: number): Promise<PublicEvidence | null> {
  return loadVersion(id);
}

export async function comparePublishedEvidence(data: {
  url?: string;
  a?: number;
  b?: number;
}): Promise<{ older: PublicEvidence; newer: PublicEvidence; changes: VersionDiff } | null> {
  let left: PublicEvidence | null = null;
  let right: PublicEvidence | null = null;
  if (data.a && data.b) {
    left = await loadVersion(data.a);
    right = await loadVersion(data.b);
  } else if (data.url) {
    const sql = await getSql();
    const index = await publishedIndex();
    if (!index.urls.has(data.url)) return null;
    const rows = await sql<{ id: number }>`
      select id from artifact_versions where url = ${data.url} order by id asc
    `;
    if (rows.length < 2) {
      const only = rows[0] ? await loadVersion(rows[0].id) : null;
      return only
        ? { older: only, newer: only, changes: { added: [], removed: [] } as VersionDiff }
        : null;
    }
    left = await loadVersion(rows[0]!.id);
    right = await loadVersion(rows[rows.length - 1]!.id);
  }
  if (!left || !right) return null;
  return {
    older: left,
    newer: right,
    changes: describeTextChanges(left.extraction_text, right.extraction_text),
  };
}

export const getPublicEvidence = createServerFn({ method: "GET" })
  .validator((versionId: number) => versionId)
  .handler(async ({ data: versionId }) => loadPublicEvidence(versionId));

export const listPublicVersionsForUrl = createServerFn({ method: "GET" })
  .validator((url: string) => url)
  .handler(async ({ data: url }) => {
    const index = await publishedIndex();
    if (!index.urls.has(url)) return [] as PublicEvidence[];
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
      from artifact_versions where url = ${url} order by id asc limit 12
    `;
    return rows.map((row) => {
      const gone = /removed|not-found|soft-404|disappeared/i.test(row.fetch_outcome);
      return {
        version_id: row.id,
        url: row.url,
        title: row.title,
        captured_at: row.captured_at,
        content_hash: row.content_hash,
        fetch_outcome: row.fetch_outcome,
        disappeared: gone,
        extraction_text: row.full_text.slice(0, 20_000),
        has_original_bytes: false,
        byte_length: null,
      } satisfies PublicEvidence;
    });
  });

export const comparePublicEvidence = createServerFn({ method: "GET" })
  .validator((input: { url?: string; a?: number; b?: number }) => input)
  .handler(async ({ data }) => comparePublishedEvidence(data));
