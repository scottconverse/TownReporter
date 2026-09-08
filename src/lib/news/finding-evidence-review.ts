import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getSql, type Sql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { parseFindings, type StoryFinding } from "./findings.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
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

export type FindingEvidenceReview = {
  leadId: number;
  draftId: number;
  evidenceToken: string;
  contentToken: string;
  canonicalDraft: { headline: string; dek: string; body: string; topic: string };
  rows: FindingEvidenceRow[];
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

function excerptState(excerpt: string | undefined, fullText: string | null) {
  if (!excerpt?.trim()) return "no-excerpt" as const;
  if (fullText == null) return "not-found" as const;
  return normalizedText(fullText).includes(normalizedText(excerpt))
    ? ("found" as const)
    : ("not-found" as const);
}

function storedReview(draft: DraftRow): ReviewMemo {
  const memo = objectMemo(draft.research_json);
  const review = memo.findingEvidenceReview;
  return review && typeof review === "object" && !Array.isArray(review)
    ? (review as ReviewMemo)
    : {};
}

function judgmentFor(draft: DraftRow, key: string): StoredJudgment {
  const review = storedReview(draft);
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
  lock = false,
): Promise<string> {
  return JSON.stringify([
    evidenceReviewToken(draft),
    await Promise.all(
      findings.map((finding) => findingReferenceBinding(sql, newsroomId, finding, lock)),
    ),
  ]);
}

async function resolveFinding(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  finding: StoryFinding,
  index: number,
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
  const key = `finding:${index}`;
  let judgment = judgmentFor(draft, key);
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

export async function loadFindingEvidenceReview(
  sql: Sql,
  newsroomId: number,
  leadId: number,
): Promise<FindingEvidenceReview> {
  const draft = await currentDraft(sql, newsroomId, leadId);
  assertReadableStoredFindings(draft.found_note);
  const findings = parseFindings(draft.found_note);
  return {
    leadId,
    draftId: draft.id,
    evidenceToken: await fullReviewToken(sql, newsroomId, draft, findings),
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
      if (
        draft.id !== input.draftId ||
        input.evidenceToken !==
          (await fullReviewToken(sql, context.newsroomId, draft, findings, true))
      )
        throw new ReviewError(
          "conflict",
          "The draft or its evidence review changed. Reload the current evidence review.",
        );
      const keyMatch = /^finding:(0|[1-9]\d*)$/.exec(input.findingKey);
      const index = keyMatch ? Number(keyMatch[1]) : Number.NaN;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= findings.length ||
        input.findingKey !== `finding:${index}`
      )
        throw new ReviewError("conflict", "That finding is no longer in the current draft.");
      if (input.judgment === "contradicts") {
        const citedVersionIds = new Set(findings[index].artifact_version_ids);
        if (findings[index].capture_event_ids.length) {
          const citedCaptures = await sql.query<{ version_id: number | null }>(
            "select version_id from capture_events where newsroom_id=$1 and id=any($2::int[])",
            [context.newsroomId, findings[index].capture_event_ids],
          );
          for (const capture of citedCaptures)
            if (capture.version_id != null) citedVersionIds.add(capture.version_id);
        }
        const [contrary] = await sql.query<{ full_text: string }>(
          "select full_text from artifact_versions where newsroom_id=$1 and id=$2",
          [context.newsroomId, input.contraryVersionId],
        );
        if (!contrary?.full_text.trim() || !citedVersionIds.has(input.contraryVersionId!))
          throw new ReviewError(
            "invalid-input",
            "The contrary evidence must be a readable captured version cited by this finding.",
          );
      }
      if (input.judgment === "supports") {
        const resolved = await resolveFinding(
          sql,
          context.newsroomId,
          draft,
          findings[index],
          index,
        );
        if (!resolved.captures.some((capture) => capture.available && capture.readable))
          throw new ReviewError(
            "invalid-input",
            "Supporting evidence requires a readable captured record cited by this finding.",
          );
      }
      const memo = objectMemo(draft.research_json);
      const previous = storedReview(draft);
      const judgments =
        previous.contentToken === contentToken && previous.judgments ? previous.judgments : {};
      judgments[input.findingKey] = {
        value: input.judgment,
        reason,
        contraryVersionId: input.judgment === "contradicts" ? input.contraryVersionId : null,
        evidenceBinding: await findingReferenceBinding(
          sql,
          context.newsroomId,
          findings[index],
          true,
        ),
      };
      memo.findingEvidenceReview = { contentToken, judgments };
      await sql.query(
        "update drafts set research_json=$1,updated_at=now() where id=$2 and newsroom_id=$3",
        [JSON.stringify(memo), draft.id, context.newsroomId],
      );
    });
    const sql = await getSql();
    return loadFindingEvidenceReview(sql, context.newsroomId, input.leadId);
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
