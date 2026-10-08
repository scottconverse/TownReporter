import type { Sql } from "../db.ts";
import type { PackageStory, PackageSource, PackageClaimStatus } from "./civic-reporting.ts";
import type { StoryClaim } from "./report.ts";

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
    rows: story.claims.map((claim) => ({
      fact: claim.text,
      url: references.get(claim.sourceIds[0])?.url ?? "",
      kind: "record",
      reporting: {
        id: claim.id, status: claim.status, nextCheck: claim.nextCheck,
        item: claim.item ?? "",
        missingSourceIds: claim.sourceIds.filter((id) => !references.has(id)),
        references: claim.sourceIds.flatMap((id) => references.has(id) ? [references.get(id)!] : []),
        ...(claim.transcriptEvidence ? { transcriptEvidence: claim.transcriptEvidence } : {}),
      },
    })),
  };
}
