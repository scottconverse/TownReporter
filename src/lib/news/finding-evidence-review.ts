import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getSql, type Sql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { parseFindings, type StoryFinding } from "./findings.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import { sha256 } from "./url-guard.ts";
import type { ProvenanceItem, StoryClaim } from "./report.ts";
import type { DraftRow } from "./types.ts";

export type FindingJudgment =
  "unreviewed" | "supports" | "does-not-support" | "contradicts" | "needs-reporting";

export type FindingCaptureEvidence = {
  versionId: number | null;
  captureEventId: number | null;
  url: string | null;
  title: string | null;
  capturedAt: string | null;
  available: boolean;
  readable: boolean;
  excerptState: "found" | "not-found" | "no-excerpt";
  newerCapture: { versionId: number; capturedAt: string | null } | null;
  viewHref: string | null;
};

export type FindingEvidenceRow = {
  key: string;
  finding: {
    text: string;
    sourceUrls: string[];
    locators: string[];
    excerpt: string | null;
  };
  captures: FindingCaptureEvidence[];
  judgment: {
    value: FindingJudgment;
    reason: string;
    contraryVersionId: number | null;
  };
};

export type ClaimEvidenceRow = {
  key: string;
  claim: StoryClaim;
  captures: FindingCaptureEvidence[];
  judgment: FindingEvidenceRow["judgment"];
};

export type ManualClaimReferenceRelation = "corroborating" | "contrary" | "context";
type StoredManualClaimReference = {
  versionId: number;
  url: string;
  relation: ManualClaimReferenceRelation;
};
type StoredManualClaim = {
  id: string;
  fact: string;
  kind: StoryClaim["kind"];
  references: StoredManualClaimReference[];
};
type StoredManualClaims = { version: 1; rows: StoredManualClaim[] };

export type ManualClaimEvidenceRow = {
  key: string;
  claim: Pick<StoredManualClaim, "id" | "fact" | "kind">;
  captures: Array<FindingCaptureEvidence & { relation: ManualClaimReferenceRelation }>;
  judgment: FindingEvidenceRow["judgment"];
};

export type ManualClaimCaptureOption = {
  versionId: number;
  title: string | null;
  url: string;
  capturedAt: string | null;
  readable: boolean;
};

export type FindingEvidenceReview = {
  leadId: number;
  draftId: number;
  evidenceToken: string;
  contentToken: string;
  canonicalDraft: { headline: string; dek: string; body: string; topic: string };
  rows: FindingEvidenceRow[];
  claimRows: ClaimEvidenceRow[];
  manualClaimRows: ManualClaimEvidenceRow[];
  manualClaimCaptureOptions: ManualClaimCaptureOption[];
};

export type FindingEvidenceResult =
  | { ok: true; review: FindingEvidenceReview }
  | {
      ok: false;
      code: "forbidden" | "not-found" | "conflict" | "invalid-input";
      error: string;
    };

export type FindingEvidenceCaptureResult =
  | {
      ok: true;
      capture: {
        versionId: number;
        title: string | null;
        url: string;
        capturedAt: string | null;
        fullText: string;
      };
    }
  | { ok: false; code: "forbidden" | "not-found" | "invalid-input"; error: string };

export type SaveManualClaimInput =
  | {
      leadId: number;
      draftId: number;
      evidenceToken: string;
      action: "upsert";
      id: string | null;
      fact: string;
      kind: StoryClaim["kind"];
      references: Array<{ versionId: number; relation: ManualClaimReferenceRelation }>;
    }
  | {
      leadId: number;
      draftId: number;
      evidenceToken: string;
      action: "remove";
      id: string;
      fact?: never;
      kind?: never;
      references?: never;
    };

class ReviewError extends Error {
  readonly code: "forbidden" | "not-found" | "conflict" | "invalid-input";
  constructor(code: "forbidden" | "not-found" | "conflict" | "invalid-input", message: string) {
    super(message);
    this.code = code;
  }
}

type StoredJudgment = FindingEvidenceRow["judgment"] & { evidenceBinding?: string };
type ReviewMemo = {
  contentToken?: string;
  judgments?: Record<string, StoredJudgment>;
};

type StoredReportedClaims = { version: 1; rows: StoryClaim[] };
type ReviewNamespace = "findingEvidenceReview" | "claimEvidenceReview";

type VersionRow = {
  id: number;
  url: string;
  title: string;
  full_text: string;
  content_hash: string;
  captured_at: string | Date;
};
type CaptureRow = {
  id: number;
  version_id: number | null;
  source_url: string;
  observed_at: string | Date;
  title: string | null;
  full_text: string | null;
  version_captured_at: string | Date | null;
  content_hash: string | null;
  version_content_hash: string | null;
};

const JUDGMENTS = new Set<FindingJudgment>([
  "unreviewed",
  "supports",
  "does-not-support",
  "contradicts",
  "needs-reporting",
]);

function objectMemo(raw: string | null | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function findingEvidenceContentToken(draft: Partial<DraftRow>): string {
  const research = objectMemo(draft.research_json);
  delete research.findingEvidenceReview;
  delete research.claimEvidenceReview;
  return JSON.stringify([
    draft.id ?? null,
    draft.headline ?? "",
    draft.dek ?? "",
    draft.body ?? "",
    draft.topic ?? "",
    draft.provenance_json ?? "[]",
    draft.found_note ?? "",
    draft.source_urls ?? "[]",
    draft.unanswered ?? "[]",
    research,
  ]);
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function assertReadableStoredFindings(raw: unknown): void {
  if (typeof raw !== "string") return;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return;
  try {
    JSON.parse(trimmed);
  } catch {
    throw new ReviewError(
      "invalid-input",
      "Stored findings are incomplete or unreadable. Review the original material or generate a replacement before recording judgments.",
    );
  }
}

function storedClaims(draft: DraftRow): StoryClaim[] {
  const claims = objectMemo(draft.research_json).reportedClaims;
  if (claims == null) return [];
  if (!claims || typeof claims !== "object" || Array.isArray(claims))
    throw new ReviewError("invalid-input", "Stored draft claims are incomplete or unreadable.");
  const value = claims as Partial<StoredReportedClaims>;
  if (value.version !== 1 || !Array.isArray(value.rows) || value.rows.length > 16)
    throw new ReviewError("invalid-input", "Stored draft claims are incomplete or unreadable.");
  return value.rows.map((row) => {
    if (
      !row ||
      typeof row.fact !== "string" ||
      !row.fact.trim() ||
      row.fact.length > 400 ||
      typeof row.url !== "string" ||
      !row.url.trim() ||
      row.url.length > 500 ||
      !["primary", "record", "news"].includes(row.kind)
    )
      throw new ReviewError("invalid-input", "Stored draft claims are incomplete or unreadable.");
    return { fact: row.fact, url: row.url, kind: row.kind };
  });
}

function storedManualClaims(draft: DraftRow): StoredManualClaim[] {
  const claims = objectMemo(draft.research_json).manualClaims;
  if (claims == null) return [];
  if (!claims || typeof claims !== "object" || Array.isArray(claims))
    throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
  const value = claims as Partial<StoredManualClaims>;
  if (value.version !== 1 || !Array.isArray(value.rows) || value.rows.length > 16)
    throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
  return value.rows.map((claim) => {
    if (
      !claim ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claim.id) ||
      typeof claim.fact !== "string" ||
      !claim.fact.trim() ||
      claim.fact.length > 400 ||
      !["primary", "record", "news"].includes(claim.kind) ||
      !Array.isArray(claim.references) ||
      claim.references.length === 0 ||
      claim.references.length > 6
    )
      throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
    const references = claim.references.map((reference) => {
      if (
        !reference ||
        !Number.isInteger(reference.versionId) ||
        reference.versionId < 1 ||
        typeof reference.url !== "string" ||
        !reference.url.trim() ||
        reference.url.length > 500 ||
        !["corroborating", "contrary", "context"].includes(reference.relation)
      )
        throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
      return {
        versionId: reference.versionId,
        url: reference.url,
        relation: reference.relation,
      } as StoredManualClaimReference;
    });
    if (new Set(references.map((reference) => reference.versionId)).size !== references.length)
      throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
    return { id: claim.id, fact: claim.fact, kind: claim.kind, references };
  });
}

function manualClaimKey(claim: StoredManualClaim) {
  return `manual-claim:${claim.id}`;
}

function referenceForManualClaim(claim: StoredManualClaim): StoryFinding {
  return {
    text: claim.fact,
    source_urls: claim.references.map((reference) => reference.url),
    artifact_version_ids: claim.references.map((reference) => reference.versionId),
    capture_event_ids: [],
    locators: [],
  };
}

function provenanceForClaim(draft: DraftRow, claim: StoryClaim): StoryFinding {
  let provenance: unknown = [];
  try {
    provenance = JSON.parse(draft.provenance_json || "[]");
  } catch {
    throw new ReviewError("invalid-input", "Stored draft provenance is incomplete or unreadable.");
  }
  const rows = Array.isArray(provenance) ? provenance : [];
  const matches = rows.filter(
    (item): item is Partial<ProvenanceItem> =>
      Boolean(item && typeof item === "object" && (item as Partial<ProvenanceItem>).url === claim.url),
  );
  return {
    text: claim.fact,
    source_urls: [claim.url],
    artifact_version_ids: matches.flatMap((item) =>
      Number.isInteger(item.version_id) && (item.version_id ?? 0) > 0 ? [item.version_id!] : [],
    ),
    capture_event_ids: matches.flatMap((item) =>
      Number.isInteger(item.capture_event_id) && (item.capture_event_id ?? 0) > 0
        ? [item.capture_event_id!]
        : [],
    ),
    locators: [],
  };
}

async function claimKey(index: number, claim: StoryClaim) {
  return `claim:${index}:${await sha256(JSON.stringify([claim.fact, claim.url, claim.kind]))}`;
}

function excerptState(excerpt: string | undefined, fullText: string | null) {
  if (!excerpt?.trim()) return "no-excerpt" as const;
  if (fullText == null) return "not-found" as const;
  return normalizedText(fullText).includes(normalizedText(excerpt))
    ? ("found" as const)
    : ("not-found" as const);
}

function storedReview(draft: DraftRow, namespace: ReviewNamespace): ReviewMemo {
  const memo = objectMemo(draft.research_json);
  const review = memo[namespace];
  return review && typeof review === "object" && !Array.isArray(review)
    ? (review as ReviewMemo)
    : {};
}

function judgmentFor(draft: DraftRow, key: string, namespace: ReviewNamespace): StoredJudgment {
  const review = storedReview(draft, namespace);
  if (review.contentToken !== findingEvidenceContentToken(draft))
    return { value: "unreviewed", reason: "", contraryVersionId: null };
  const judgment = review.judgments?.[key];
  return judgment && JUDGMENTS.has(judgment.value)
    ? {
        value: judgment.value,
        reason: typeof judgment.reason === "string" ? judgment.reason : "",
        contraryVersionId: Number.isInteger(judgment.contraryVersionId)
          ? judgment.contraryVersionId
          : null,
        evidenceBinding:
          typeof judgment.evidenceBinding === "string" ? judgment.evidenceBinding : undefined,
      }
    : { value: "unreviewed", reason: "", contraryVersionId: null };
}

async function currentDraft(sql: Sql, newsroomId: number, leadId: number): Promise<DraftRow> {
  const [draft] = await sql.query<DraftRow>(
    "select * from drafts where lead_id=$1 and newsroom_id=$2 order by updated_at desc,id desc limit 1",
    [leadId, newsroomId],
  );
  if (!draft) throw new ReviewError("not-found", "Draft not found.");
  return draft;
}

async function findingReferenceBinding(
  sql: Sql,
  newsroomId: number,
  finding: StoryFinding,
  lock = false,
): Promise<string> {
  const versionIds = [...new Set(finding.artifact_version_ids)];
  const captureIds = [...new Set(finding.capture_event_ids)];
  const captures = captureIds.length
    ? await sql.query<{
        id: number;
        version_id: number | null;
        source_url: string;
        content_hash: string | null;
      }>(
        `select ce.id,ce.version_id,ce.source_url,ce.content_hash
           from capture_events ce
          where ce.newsroom_id=$1 and ce.id=any($2::int[])
          order by ce.id${lock ? " for share" : ""}`,
        [newsroomId, captureIds],
      )
    : [];
  const allVersionIds = [
    ...new Set([
      ...versionIds,
      ...captures.flatMap((capture) => (capture.version_id == null ? [] : [capture.version_id])),
    ]),
  ];
  const versions = allVersionIds.length
    ? await sql.query<{
        id: number;
        url: string;
        content_hash: string;
        text_fingerprint: string;
      }>(
        `select id,url,content_hash,md5(full_text) as text_fingerprint
           from artifact_versions
          where newsroom_id=$1 and id=any($2::int[]) order by id${lock ? " for share" : ""}`,
        [newsroomId, allVersionIds],
      )
    : [];
  return JSON.stringify({ versionIds, captureIds, versions, captures });
}

async function fullReviewToken(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  findings: StoryFinding[],
  claims: StoryClaim[],
  manualClaims: StoredManualClaim[],
  lock = false,
): Promise<string> {
  return JSON.stringify([
    evidenceReviewToken(draft),
    await Promise.all(
      findings.map((finding) => findingReferenceBinding(sql, newsroomId, finding, lock)),
    ),
    await Promise.all([
      ...claims.map((claim) =>
        findingReferenceBinding(sql, newsroomId, provenanceForClaim(draft, claim), lock),
      ),
      ...manualClaims.map((claim) =>
        findingReferenceBinding(sql, newsroomId, referenceForManualClaim(claim), lock),
      ),
    ]),
  ]);
}

async function resolveFinding(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  finding: StoryFinding,
  index: number,
  key = `finding:${index}`,
  namespace: ReviewNamespace = "findingEvidenceReview",
): Promise<FindingEvidenceRow> {
  const versionIds = [...new Set(finding.artifact_version_ids)];
  const captureIds = [...new Set(finding.capture_event_ids)];
  const versions = versionIds.length
    ? await sql.query<VersionRow>(
        "select id,url,title,full_text,content_hash,captured_at from artifact_versions where newsroom_id=$1 and id=any($2::int[])",
        [newsroomId, versionIds],
      )
    : [];
  const captures = captureIds.length
    ? await sql.query<CaptureRow>(
        `select ce.id,ce.version_id,ce.source_url,ce.observed_at,ce.content_hash,
                av.title,av.full_text,av.content_hash as version_content_hash,
                av.captured_at as version_captured_at
           from capture_events ce
           left join artifact_versions av on av.id=ce.version_id and av.newsroom_id=ce.newsroom_id
          where ce.newsroom_id=$1 and ce.id=any($2::int[])`,
        [newsroomId, captureIds],
      )
    : [];
  const byVersion = new Map(versions.map((row) => [row.id, row]));
  const byCapture = new Map(captures.map((row) => [row.id, row]));
  const refs: Array<{ versionId: number | null; captureEventId: number | null }> = [
    ...versionIds.map((versionId) => ({ versionId, captureEventId: null })),
    ...captureIds.map((captureEventId) => ({ versionId: null, captureEventId })),
  ];
  const resolved: FindingCaptureEvidence[] = [];
  for (const ref of refs) {
    const capture = ref.captureEventId == null ? undefined : byCapture.get(ref.captureEventId);
    const versionId = ref.versionId ?? capture?.version_id ?? null;
    const version = versionId == null ? undefined : byVersion.get(versionId);
    const availableVersion =
      version ??
      (capture?.version_id != null && capture.full_text != null
        ? {
            id: capture.version_id,
            url: capture.source_url,
            title: capture.title ?? "",
            full_text: capture.full_text,
            content_hash: capture.version_content_hash ?? capture.content_hash ?? "",
            captured_at: capture.version_captured_at ?? capture.observed_at,
          }
        : undefined);
    const url = availableVersion?.url ?? capture?.source_url ?? null;
    const [newer] = url
      ? await sql.query<{ id: number; captured_at: string | Date }>(
          `select id,captured_at from artifact_versions
            where newsroom_id=$1 and url=$2 and ($3::int is null or id<>$3)
              and captured_at>coalesce($4::timestamptz,'epoch'::timestamptz)
            order by captured_at desc,id desc limit 1`,
          [
            newsroomId,
            url,
            availableVersion?.id ?? null,
            availableVersion?.captured_at ?? capture?.observed_at ?? null,
          ],
        )
      : [];
    resolved.push({
      versionId,
      captureEventId: ref.captureEventId,
      url,
      title: availableVersion?.title || null,
      capturedAt: availableVersion?.captured_at
        ? String(availableVersion.captured_at)
        : capture?.observed_at
          ? String(capture.observed_at)
          : null,
      available: Boolean(availableVersion),
      readable: Boolean(availableVersion?.full_text.trim()),
      excerptState: excerptState(finding.excerpt, availableVersion?.full_text ?? null),
      newerCapture: newer
        ? { versionId: newer.id, capturedAt: newer.captured_at ? String(newer.captured_at) : null }
        : null,
      viewHref: availableVersion ? `/evidence/${availableVersion.id}` : null,
    });
  }
  let judgment = judgmentFor(draft, key, namespace);
  const currentBinding = await findingReferenceBinding(sql, newsroomId, finding);
  const readableVersions = new Set(
    resolved
      .filter((capture) => capture.available && capture.readable)
      .map((capture) => capture.versionId),
  );
  if (
    (judgment.value !== "unreviewed" && judgment.evidenceBinding !== currentBinding) ||
    (judgment.value === "supports" && readableVersions.size === 0) ||
    (judgment.value === "contradicts" &&
      (!judgment.reason ||
        judgment.contraryVersionId == null ||
        !readableVersions.has(judgment.contraryVersionId)))
  )
    judgment = { value: "unreviewed", reason: "", contraryVersionId: null };
  return {
    key,
    finding: {
      text: finding.text,
      sourceUrls: finding.source_urls,
      locators: finding.locators,
      excerpt: finding.excerpt ?? null,
    },
    captures: resolved,
    judgment: {
      value: judgment.value,
      reason: judgment.reason,
      contraryVersionId: judgment.contraryVersionId,
    },
  };
}

async function resolveClaim(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  claim: StoryClaim,
  index: number,
): Promise<ClaimEvidenceRow> {
  const key = await claimKey(index, claim);
  const resolved = await resolveFinding(
    sql,
    newsroomId,
    draft,
    provenanceForClaim(draft, claim),
    index,
    key,
    "claimEvidenceReview",
  );
  const captures = resolved.captures.map((capture) =>
    capture.url === claim.url
      ? capture
      : {
          versionId: capture.versionId,
          captureEventId: capture.captureEventId,
          url: null,
          title: null,
          capturedAt: null,
          available: false,
          readable: false,
          excerptState: "no-excerpt" as const,
          newerCapture: null,
          viewHref: null,
        },
  );
  const readableVersionIds = new Set(
    captures.filter((capture) => capture.available && capture.readable).map((capture) => capture.versionId),
  );
  const judgment =
    (resolved.judgment.value === "supports" && readableVersionIds.size === 0) ||
    (resolved.judgment.value === "contradicts" &&
      (!resolved.judgment.reason ||
        resolved.judgment.contraryVersionId == null ||
        !readableVersionIds.has(resolved.judgment.contraryVersionId)))
      ? { value: "unreviewed" as const, reason: "", contraryVersionId: null }
      : resolved.judgment;
  return {
    key,
    claim,
    captures,
    judgment,
  };
}

async function resolveManualClaim(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  claim: StoredManualClaim,
): Promise<ManualClaimEvidenceRow> {
  const key = manualClaimKey(claim);
  const resolved = await resolveFinding(
    sql,
    newsroomId,
    draft,
    referenceForManualClaim(claim),
    0,
    key,
    "claimEvidenceReview",
  );
  const captures = resolved.captures.map((capture) => {
    const reference = claim.references.find((candidate) => candidate.versionId === capture.versionId);
    if (!reference || capture.url !== reference.url) {
      return {
        versionId: capture.versionId,
        captureEventId: capture.captureEventId,
        url: null,
        title: null,
        capturedAt: null,
        available: false,
        readable: false,
        excerptState: "no-excerpt" as const,
        newerCapture: null,
        viewHref: null,
        relation: reference?.relation ?? "context" as ManualClaimReferenceRelation,
      };
    }
    return { ...capture, relation: reference.relation };
  });
  const readableVersions = new Set(
    captures.filter((capture) => capture.available && capture.readable).map((capture) => capture.versionId),
  );
  const judgment =
    (resolved.judgment.value === "supports" && readableVersions.size === 0) ||
    (resolved.judgment.value === "contradicts" &&
      (!resolved.judgment.reason ||
        resolved.judgment.contraryVersionId == null ||
        !readableVersions.has(resolved.judgment.contraryVersionId)))
      ? { value: "unreviewed" as const, reason: "", contraryVersionId: null }
      : resolved.judgment;
  return {
    key,
    claim: { id: claim.id, fact: claim.fact, kind: claim.kind },
    captures,
    judgment,
  };
}

async function manualClaimCaptureOptions(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
): Promise<ManualClaimCaptureOption[]> {
  let provenance: unknown = [];
  try {
    provenance = JSON.parse(draft.provenance_json || "[]");
  } catch {
    throw new ReviewError("invalid-input", "Stored draft provenance is incomplete or unreadable.");
  }
  const exactVersionIds = Array.isArray(provenance)
    ? provenance.flatMap((item) =>
        item && typeof item === "object" && Number.isInteger((item as Partial<ProvenanceItem>).version_id)
          ? [(item as ProvenanceItem).version_id]
          : [],
      )
    : [];
  const rows = await sql.query<{
    id: number;
    title: string | null;
    url: string;
    captured_at: string | Date | null;
    full_text: string | null;
  }>(
    `select id,title,url,captured_at,full_text
       from artifact_versions
      where newsroom_id=$1
      order by case when id=any($2::int[]) then 0 else 1 end,captured_at desc,id desc
      limit 32`,
    [newsroomId, exactVersionIds],
  );
  return rows.map((row) => ({
    versionId: row.id,
    title: row.title || null,
    url: row.url,
    capturedAt: row.captured_at ? String(row.captured_at) : null,
    readable: Boolean(row.full_text?.trim()),
  }));
}

export async function loadFindingEvidenceReview(
  sql: Sql,
  newsroomId: number,
  leadId: number,
): Promise<FindingEvidenceReview> {
  const draft = await currentDraft(sql, newsroomId, leadId);
  assertReadableStoredFindings(draft.found_note);
  const findings = parseFindings(draft.found_note);
  const claims = storedClaims(draft);
  const manualClaims = storedManualClaims(draft);
  return {
    leadId,
    draftId: draft.id,
    evidenceToken: await fullReviewToken(sql, newsroomId, draft, findings, claims, manualClaims),
    contentToken: findingEvidenceContentToken(draft),
    canonicalDraft: {
      headline: draft.headline,
      dek: draft.dek,
      body: draft.body,
      topic: draft.topic,
    },
    rows: await Promise.all(
      findings.map((finding, index) => resolveFinding(sql, newsroomId, draft, finding, index)),
    ),
    claimRows: await Promise.all(
      claims.map((claim, index) => resolveClaim(sql, newsroomId, draft, claim, index)),
    ),
    manualClaimRows: await Promise.all(
      manualClaims.map((claim) => resolveManualClaim(sql, newsroomId, draft, claim)),
    ),
    manualClaimCaptureOptions: await manualClaimCaptureOptions(sql, newsroomId, draft),
  };
}

export const loadFindingEvidenceCapture = createServerOnlyFn(
  async function loadFindingEvidenceCapture(
    sql: Sql,
    newsroomId: number,
    leadId: number,
    draftId: number,
    versionId: number,
  ): Promise<FindingEvidenceCaptureResult> {
    const review = await loadFindingEvidenceReview(sql, newsroomId, leadId);
    if (review.draftId !== draftId)
      return { ok: false, code: "not-found", error: "That draft is no longer current." };
    const allowed = new Set<number>();
    for (const row of review.rows) {
      for (const capture of row.captures) {
        if (capture.available && capture.versionId != null) allowed.add(capture.versionId);
        if (capture.newerCapture) allowed.add(capture.newerCapture.versionId);
      }
    }
    for (const row of review.claimRows) {
      for (const capture of row.captures) {
        if (capture.available && capture.versionId != null) allowed.add(capture.versionId);
      }
    }
    for (const row of review.manualClaimRows) {
      for (const capture of row.captures) {
        if (capture.available && capture.versionId != null) allowed.add(capture.versionId);
      }
    }
    if (!allowed.has(versionId))
      return { ok: false, code: "not-found", error: "That captured version is not available for this draft." };
    const [version] = await sql.query<{
      id: number;
      title: string | null;
      url: string;
      captured_at: string | Date | null;
      full_text: string | null;
    }>(
      "select id,title,url,captured_at,full_text from artifact_versions where newsroom_id=$1 and id=$2",
      [newsroomId, versionId],
    );
    if (!version)
      return { ok: false, code: "not-found", error: "That captured version is no longer available." };
    return {
      ok: true,
      capture: {
        versionId: version.id,
        title: version.title || null,
        url: version.url,
        capturedAt: version.captured_at ? String(version.captured_at) : null,
        fullText: version.full_text ?? "",
      },
    };
  },
);

export type SaveFindingJudgmentInput = {
  leadId: number;
  draftId: number;
  findingKey: string;
  judgment: FindingJudgment;
  reason: string;
  contraryVersionId: number | null;
  evidenceToken: string;
};

export const persistFindingEvidenceJudgment = createServerOnlyFn(
  async function persistFindingEvidenceJudgment(
    context: { newsroomId: number },
    input: SaveFindingJudgmentInput,
  ): Promise<FindingEvidenceReview> {
    if (!JUDGMENTS.has(input.judgment))
      throw new ReviewError("invalid-input", "Choose a valid evidence judgment.");
    if (input.reason.length > 2000)
      throw new ReviewError(
        "invalid-input",
        "The evidence-review reason must be 2,000 characters or fewer.",
      );
    const reason = input.reason.trim();
    if (input.judgment === "contradicts" && (!reason || !input.contraryVersionId))
      throw new ReviewError(
        "invalid-input",
        "A contradiction needs cited contrary captured evidence and a reason.",
      );
    const { withLeadDraftLock } = await import("./draft-order.server.ts");
    await withLeadDraftLock(context, input.leadId, async (sql) => {
      const draft = await currentDraft(sql, context.newsroomId, input.leadId);
      const contentToken = findingEvidenceContentToken(draft);
      assertReadableStoredFindings(draft.found_note);
      const findings = parseFindings(draft.found_note);
      const claims = storedClaims(draft);
      const manualClaims = storedManualClaims(draft);
      if (
        draft.id !== input.draftId ||
        input.evidenceToken !==
          (await fullReviewToken(sql, context.newsroomId, draft, findings, claims, manualClaims, true))
      )
        throw new ReviewError(
          "conflict",
          "The draft or its evidence review changed. Reload the current evidence review.",
        );
      const findingMatch = /^finding:(0|[1-9]\d*)$/.exec(input.findingKey);
      const claimMatch = /^claim:(0|[1-9]\d*):[a-f0-9]{64}$/.exec(input.findingKey);
      const manualClaimMatch = /^manual-claim:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(input.findingKey);
      const index = Number(findingMatch?.[1] ?? claimMatch?.[1] ?? Number.NaN);
      const isClaim = Boolean(claimMatch);
      const isManualClaim = Boolean(manualClaimMatch);
      const manualClaim = isManualClaim
        ? manualClaims.find((claim) => claim.id === manualClaimMatch![1])
        : undefined;
      if (
        (!isManualClaim && (!Number.isInteger(index) || index < 0 || (isClaim ? index >= claims.length : index >= findings.length))) ||
        (isManualClaim && !manualClaim)
      )
        throw new ReviewError("conflict", "That evidence item is no longer in the current draft.");
      if (isClaim && input.findingKey !== (await claimKey(index, claims[index])))
        throw new ReviewError("conflict", "That claim identity changed. Reload the current evidence review.");
      const namespace: ReviewNamespace = isClaim || isManualClaim ? "claimEvidenceReview" : "findingEvidenceReview";
      const reference = isManualClaim
        ? referenceForManualClaim(manualClaim!)
        : isClaim ? provenanceForClaim(draft, claims[index]) : findings[index];
      const resolved = isManualClaim
        ? await resolveManualClaim(sql, context.newsroomId, draft, manualClaim!)
        : isClaim
        ? await resolveClaim(sql, context.newsroomId, draft, claims[index], index)
        : await resolveFinding(
            sql,
            context.newsroomId,
            draft,
            reference,
            index,
            input.findingKey,
            namespace,
          );
      const citedVersionIds = new Set(
        resolved.captures
          .filter((capture) => capture.available && capture.readable && capture.versionId != null)
          .map((capture) => capture.versionId!),
      );
      const supportVersionIds = new Set(
        resolved.captures
          .filter((capture) => capture.available && capture.readable && (!isManualClaim || ("relation" in capture && capture.relation === "corroborating")) && capture.versionId != null)
          .map((capture) => capture.versionId!),
      );
      const contraryVersionIds = new Set(
        resolved.captures
          .filter((capture) => capture.available && capture.readable && (!isManualClaim || ("relation" in capture && capture.relation === "contrary")) && capture.versionId != null)
          .map((capture) => capture.versionId!),
      );
      if (input.judgment === "contradicts" && !(isManualClaim ? contraryVersionIds : citedVersionIds).has(input.contraryVersionId!))
        throw new ReviewError(
          "invalid-input",
          isManualClaim
            ? "The contrary evidence must be a readable record explicitly marked contrary for this manual claim."
            : isClaim
            ? "The contrary evidence must be a readable captured version cited by this claim."
            : "The contrary evidence must be a readable captured version cited by this finding.",
        );
      if (input.judgment === "supports" && (isManualClaim ? supportVersionIds : citedVersionIds).size === 0)
        throw new ReviewError(
          "invalid-input",
          isManualClaim
            ? "Supporting evidence requires a readable record explicitly marked corroborating for this manual claim."
            : "Supporting evidence requires a readable captured record cited by this evidence item.",
        );
      const memo = objectMemo(draft.research_json);
      const previous = storedReview(draft, namespace);
      const judgments =
        previous.contentToken === contentToken && previous.judgments ? previous.judgments : {};
      judgments[input.findingKey] = {
        value: input.judgment,
        reason,
        contraryVersionId: input.judgment === "contradicts" ? input.contraryVersionId : null,
        evidenceBinding: await findingReferenceBinding(
          sql,
          context.newsroomId,
          reference,
          true,
        ),
      };
      memo[namespace] = { contentToken, judgments };
      await sql.query(
        "update drafts set research_json=$1,updated_at=now() where id=$2 and newsroom_id=$3",
        [JSON.stringify(memo), draft.id, context.newsroomId],
      );
    });
    const sql = await getSql();
    return loadFindingEvidenceReview(sql, context.newsroomId, input.leadId);
  },
);

async function resolvedManualReferences(
  sql: Sql,
  newsroomId: number,
  references: Array<{ versionId: number; relation: ManualClaimReferenceRelation }>,
): Promise<StoredManualClaimReference[]> {
  if (references.length === 0 || references.length > 6)
    throw new ReviewError("invalid-input", "Choose from one to six already captured records.");
  if (new Set(references.map((reference) => reference.versionId)).size !== references.length)
    throw new ReviewError("invalid-input", "Choose each captured record only once.");
  if (references.some((reference) => !Number.isInteger(reference.versionId) || reference.versionId < 1))
    throw new ReviewError("invalid-input", "Choose valid captured records.");
  const versions = await sql.query<{ id: number; url: string }>(
    "select id,url from artifact_versions where newsroom_id=$1 and id=any($2::int[])",
    [newsroomId, references.map((reference) => reference.versionId)],
  );
  if (versions.length !== references.length)
    throw new ReviewError("invalid-input", "Every selected captured record must still belong to this newsroom.");
  const urls = new Map(versions.map((version) => [version.id, version.url]));
  return references.map((reference) => {
    if (!urls.get(reference.versionId) || urls.get(reference.versionId)!.length > 500)
      throw new ReviewError("invalid-input", "A selected captured record has an invalid URL.");
    return { ...reference, url: urls.get(reference.versionId)! };
  });
}

export const persistManualClaim = createServerOnlyFn(
  async function persistManualClaim(
    context: { newsroomId: number },
    input: SaveManualClaimInput,
  ): Promise<FindingEvidenceReview> {
    const { withLeadDraftLock } = await import("./draft-order.server.ts");
    await withLeadDraftLock(context, input.leadId, async (sql) => {
      const draft = await currentDraft(sql, context.newsroomId, input.leadId);
      assertReadableStoredFindings(draft.found_note);
      const findings = parseFindings(draft.found_note);
      const claims = storedClaims(draft);
      const manualClaims = storedManualClaims(draft);
      if (
        draft.id !== input.draftId ||
        input.evidenceToken !==
          (await fullReviewToken(sql, context.newsroomId, draft, findings, claims, manualClaims, true))
      )
        throw new ReviewError(
          "conflict",
          "The draft or its evidence review changed. Reload the current evidence review.",
        );
      const memo = objectMemo(draft.research_json);
      if (input.action === "remove") {
        const index = manualClaims.findIndex((claim) => claim.id === input.id);
        if (index < 0) throw new ReviewError("conflict", "That manual claim is no longer current.");
        manualClaims.splice(index, 1);
      } else {
        if (
          !input.fact.trim() ||
          input.fact.length > 400 ||
          !["primary", "record", "news"].includes(input.kind)
        ) throw new ReviewError("invalid-input", "Provide a claim of 400 characters or fewer and a valid kind.");
        const references = await resolvedManualReferences(sql, context.newsroomId, input.references);
        const id = input.id ?? globalThis.crypto.randomUUID();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
          throw new ReviewError("invalid-input", "Invalid manual claim identifier.");
        const next: StoredManualClaim = { id, fact: input.fact, kind: input.kind, references };
        const index = manualClaims.findIndex((claim) => claim.id === id);
        if (index < 0) {
          if (manualClaims.length >= 16)
            throw new ReviewError("invalid-input", "This draft can hold at most 16 manual claims.");
          manualClaims.push(next);
        } else {
          manualClaims[index] = next;
        }
      }
      memo.manualClaims = { version: 1, rows: manualClaims } satisfies StoredManualClaims;
      await sql.query(
        "update drafts set research_json=$1,updated_at=now() where id=$2 and newsroom_id=$3",
        [JSON.stringify(memo), draft.id, context.newsroomId],
      );
    });
    return loadFindingEvidenceReview(await getSql(), context.newsroomId, input.leadId);
  },
);

function cleanLeadInput(raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { leadId: typeof value.leadId === "number" ? value.leadId : Number.NaN };
}

function cleanSaveInput(raw: unknown): SaveFindingJudgmentInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    leadId: typeof value.leadId === "number" ? value.leadId : Number.NaN,
    draftId: typeof value.draftId === "number" ? value.draftId : Number.NaN,
    findingKey: typeof value.findingKey === "string" ? value.findingKey : "",
    judgment:
      typeof value.judgment === "string"
        ? (value.judgment as FindingJudgment)
        : ("" as FindingJudgment),
    reason: typeof value.reason === "string" ? value.reason : "",
    contraryVersionId:
      value.contraryVersionId === null
        ? null
        : typeof value.contraryVersionId === "number"
          ? value.contraryVersionId
          : Number.NaN,
    evidenceToken: typeof value.evidenceToken === "string" ? value.evidenceToken : "",
  };
}

function cleanCaptureInput(raw: unknown) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    leadId: typeof value.leadId === "number" ? value.leadId : Number.NaN,
    draftId: typeof value.draftId === "number" ? value.draftId : Number.NaN,
    versionId: typeof value.versionId === "number" ? value.versionId : Number.NaN,
  };
}

function cleanManualClaimInput(raw: unknown): SaveManualClaimInput {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const common = {
    leadId: typeof value.leadId === "number" ? value.leadId : Number.NaN,
    draftId: typeof value.draftId === "number" ? value.draftId : Number.NaN,
    evidenceToken: typeof value.evidenceToken === "string" ? value.evidenceToken : "",
  };
  if (value.action === "remove") {
    return { ...common, action: "remove", id: typeof value.id === "string" ? value.id : "" };
  }
  return {
    ...common,
    action: "upsert",
    id: value.id === null ? null : typeof value.id === "string" ? value.id : null,
    fact: typeof value.fact === "string" ? value.fact : "",
    kind: typeof value.kind === "string" ? value.kind as StoryClaim["kind"] : "news",
    references: Array.isArray(value.references)
      ? value.references.map((reference) => {
          const item = reference && typeof reference === "object" ? reference as Record<string, unknown> : {};
          return {
            versionId: typeof item.versionId === "number" ? item.versionId : Number.NaN,
            relation: typeof item.relation === "string" ? item.relation as ManualClaimReferenceRelation : "context",
          };
        })
      : [],
  };
}

export const getFindingEvidenceCapture = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(cleanCaptureInput)
  .handler(async ({ context, data }): Promise<FindingEvidenceCaptureResult> => {
    if (
      !Number.isInteger(data.leadId) || data.leadId < 1 ||
      !Number.isInteger(data.draftId) || data.draftId < 1 ||
      !Number.isInteger(data.versionId) || data.versionId < 1
    ) return { ok: false, code: "invalid-input", error: "Invalid captured version." };
    try {
      return await loadFindingEvidenceCapture(
        await getSql(), context.newsroomId, data.leadId, data.draftId, data.versionId,
      );
    } catch {
      return { ok: false, code: "not-found", error: "That captured version is not available for this draft." };
    }
  });

export const getFindingEvidenceReview = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator(cleanLeadInput)
  .handler(async ({ context, data }): Promise<FindingEvidenceResult> => {
    try {
      if (!Number.isInteger(data.leadId) || data.leadId < 1) throw new Error("Invalid lead.");
      return {
        ok: true,
        review: await loadFindingEvidenceReview(await getSql(), context.newsroomId, data.leadId),
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof ReviewError ? error.code : "not-found",
        error: error instanceof Error ? error.message : "Evidence review failed.",
      };
    }
  });

export const saveFindingEvidenceJudgment = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(cleanSaveInput)
  .handler(async ({ context, data }): Promise<FindingEvidenceResult> => {
    try {
      if (
        !Number.isInteger(data.leadId) ||
        data.leadId < 1 ||
        !Number.isInteger(data.draftId) ||
        data.draftId < 1 ||
        !data.findingKey
      )
        throw new ReviewError("invalid-input", "Invalid evidence judgment.");
      return {
        ok: true,
        review: await persistFindingEvidenceJudgment(context, data),
      };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof ReviewError ? error.code : "invalid-input",
        error: error instanceof Error ? error.message : "Evidence review failed.",
      };
    }
  });

export const saveManualClaim = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator(cleanManualClaimInput)
  .handler(async ({ context, data }): Promise<FindingEvidenceResult> => {
    try {
      if (
        !Number.isInteger(data.leadId) || data.leadId < 1 ||
        !Number.isInteger(data.draftId) || data.draftId < 1 ||
        !data.evidenceToken
      ) throw new ReviewError("invalid-input", "Invalid manual claim.");
      return { ok: true, review: await persistManualClaim(context, data) };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof ReviewError ? error.code : "invalid-input",
        error: error instanceof Error ? error.message : "Manual claim could not be saved.",
      };
    }
  });
