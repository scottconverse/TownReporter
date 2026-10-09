import type { Sql } from "../db.ts";
import type { PackageStory, PackageSource, PackageClaimStatus, PackageClaim } from "./civic-reporting.ts";
import type { StoryClaim } from "./report.ts";
import { sha256 } from "./url-guard.ts";
import type { PdfPage } from "./ingest.ts";

/** Retain already-read sources before checking; this never fetches or starts a watch. */
export async function retainReportingEvidence(sql: Sql, context: { newsroomId: number; userId: string }, documents: { url: string; title: string; text: string; ok: boolean; pages?: PdfPage[] }[]): Promise<void> {
  const { rememberCapture } = await import("./investigate.ts");
  for (const document of documents.filter((document) => document.ok && document.text.trim() && document.url)) {
    const saved = await rememberCapture({ sql, userId: context.userId, newsroomId: context.newsroomId,
      investigationId: null, url: document.url, title: document.title || document.url,
      text: document.text, hash: await sha256(document.text), status: 200, outcome: "fetched",
      triggerKind: "reporting", pages: document.pages, autoWatch: false });
    const [retained] = await sql.query<{ full_text: string }>("select full_text from artifact_versions where id=$1 and newsroom_id=$2 and taken_down_at is null", [saved.versionId, context.newsroomId]);
    // The judge must read exactly what was retained, including archive caps and takedowns.
    document.text = retained?.full_text || "";
  }
}

/** WR1 claim review, with the complete reporting ledger and pinned captures. */
export type ReportingReviewClaim = StoryClaim & {
  reporting?: {
    id: string;
    status: PackageClaimStatus;
    nextCheck: string;
    item: string;
    missingSourceIds: string[];
    references: Array<PackageSource & { versionId: number | null }>;
    transcriptEvidence?: { quote: string; startSeconds: number; videoUrl: string };
    recordEvidence?: NonNullable<PackageClaim["recordEvidence"]>;
    closestEvidence?: NonNullable<PackageClaim["closestEvidence"]>;
    checkReason?: string;
    closestQuote?: string;
  };
};

export async function reportingStoryReviewClaims(
  sql: Sql,
  newsroomId: number,
  story: PackageStory,
  capturedBefore?: string,
): Promise<{ version: 2; rows: ReportingReviewClaim[] }> {
  const references = new Map<string, PackageSource & { versionId: number | null }>();
  for (const source of story.sources) {
    // An exact saved URL is required. Do not substitute a landing page, a
    // different document query, or a later capture for the filed evidence.
    const [version] = source.url ? await sql.query<{ id: number }>(
      `select id from artifact_versions where newsroom_id=$1 and url=$2
       and ($3::timestamptz is null or captured_at<=$3::timestamptz)
       order by captured_at desc,id desc limit 1`,
      [newsroomId, source.url, capturedBefore ?? null],
    ) : [];
    references.set(source.id, { ...source, versionId: version?.id ?? null });
  }
  return {
    version: 2,
    rows: await Promise.all(story.claims.map(async (claim) => {
      const ownReferences = await Promise.all(claim.sourceIds.flatMap((id) => references.has(id) ? [references.get(id)!] : []).map(async (reference) => {
        const ai = story.aiEvidenceReview?.rows.find(row => row.text === claim.text && row.sourceUrl === reference.url && row.quote.trim());
        const quote = [ai && { url: ai.sourceUrl, quote: ai.quote }, claim.recordEvidence, claim.transcriptEvidence && { url: claim.transcriptEvidence.videoUrl, quote: claim.transcriptEvidence.quote }, claim.closestEvidence]
          .find((evidence) => evidence?.url === reference.url)?.quote;
        if (!quote?.trim()) return reference;
        const versions = await sql.query<{ id: number; full_text: string }>(
          `select id,full_text from artifact_versions where newsroom_id=$1 and url=$2 and taken_down_at is null
           and ($3::timestamptz is null or captured_at<=$3::timestamptz) order by captured_at desc,id desc limit 64`,
          [newsroomId, reference.url, capturedBefore ?? null]);
        const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
        const match = versions.find((version) => quote.trim().length >= 8 && normalized(version.full_text).includes(normalized(quote)));
        return { ...reference, versionId: match?.id ?? null };
      }));
      return {
      fact: claim.text,
      url: references.get(claim.sourceIds[0])?.url ?? "",
      kind: "record",
      reporting: {
        id: claim.id, status: claim.status, nextCheck: claim.nextCheck,
        item: claim.item ?? "",
        missingSourceIds: claim.sourceIds.filter((id) => !references.has(id)),
        references: ownReferences,
        ...(claim.transcriptEvidence ? { transcriptEvidence: claim.transcriptEvidence } : {}),
        ...(claim.recordEvidence ? { recordEvidence: claim.recordEvidence } : {}),
        ...(claim.closestEvidence ? { closestEvidence: claim.closestEvidence } : {}),
        ...(claim.checkReason ? { checkReason: claim.checkReason } : {}),
        ...(claim.closestQuote ? { closestQuote: claim.closestQuote } : {}),
      },
    }; })),
  };
}
