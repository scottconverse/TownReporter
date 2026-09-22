export type CaptureDisposition = "provisional" | "final";
export type RevisionSignal = "hash" | "revision-timestamp" | "duration" | null;

const PROVISIONAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROVISIONAL_CEILING_MS = 48 * 60 * 60 * 1000;
const MIN_GAP_MS = 60 * 60 * 1000;

export function captureDisposition(input: { endedAt: string | null; now: Date }): CaptureDisposition {
  if (!input.endedAt) return "final";
  const ended = Date.parse(input.endedAt);
  if (!Number.isFinite(ended)) return "final";
  return input.now.getTime() - ended <= PROVISIONAL_WINDOW_MS ? "provisional" : "final";
}

export function detectRevision(input: {
  priorSha256: string | null;
  nextSha256: string | null;
  priorRevisionTimestamp: number | null;
  nextRevisionTimestamp: number | null;
  priorDuration: number | null;
  nextDuration: number | null;
}): RevisionSignal {
  if (input.priorSha256 && input.nextSha256 && input.priorSha256 !== input.nextSha256) return "hash";
  if (
    input.priorRevisionTimestamp != null &&
    input.nextRevisionTimestamp != null &&
    input.priorRevisionTimestamp !== input.nextRevisionTimestamp
  ) return "revision-timestamp";
  if (input.priorDuration != null && input.nextDuration != null && input.priorDuration !== input.nextDuration) return "duration";
  return null;
}

export type CheckStateInput = {
  status: CaptureDisposition;
  consecutiveUnchanged: number;
  lastCheckedAt: string | null;
  firstCapturedAt: string;
  now: Date;
  changed: boolean;
};

export type CheckStateResult = {
  status: CaptureDisposition;
  consecutiveUnchanged: number;
  settled: boolean;
  settledUnderChurn: boolean;
  revisionRecorded: boolean;
};

export function nextCheckState(input: CheckStateInput): CheckStateResult {
  const firstCaptured = Date.parse(input.firstCapturedAt);
  const atCeiling =
    input.status === "provisional" &&
    Number.isFinite(firstCaptured) &&
    input.now.getTime() - firstCaptured >= PROVISIONAL_CEILING_MS;

  if (input.status === "final") {
    return {
      status: "final",
      consecutiveUnchanged: input.consecutiveUnchanged,
      settled: false,
      settledUnderChurn: false,
      revisionRecorded: input.changed,
    };
  }

  if (input.changed) {
    if (atCeiling) {
      return {
        status: "final",
        consecutiveUnchanged: 0,
        settled: true,
        settledUnderChurn: true,
        revisionRecorded: true,
      };
    }
    return {
      status: "provisional",
      consecutiveUnchanged: 0,
      settled: false,
      settledUnderChurn: false,
      revisionRecorded: true,
    };
  }

  const last = input.lastCheckedAt ? Date.parse(input.lastCheckedAt) : null;
  const gapOk = last == null || input.now.getTime() - last >= MIN_GAP_MS;
  const consecutiveUnchanged = gapOk ? input.consecutiveUnchanged + 1 : input.consecutiveUnchanged;

  if (atCeiling) {
    return {
      status: "final",
      consecutiveUnchanged,
      settled: true,
      settledUnderChurn: false,
      revisionRecorded: false,
    };
  }
  if (consecutiveUnchanged >= 2) {
    return {
      status: "final",
      consecutiveUnchanged,
      settled: true,
      settledUnderChurn: false,
      revisionRecorded: false,
    };
  }
  return {
    status: "provisional",
    consecutiveUnchanged,
    settled: false,
    settledUnderChurn: false,
    revisionRecorded: false,
  };
}

export function planRevisionStorage(input: {
  priorPath: string;
  newPath: string;
  revisionCount: number;
}): { keepPrior: true; archivedPriorPath: string; newPath: string; revisionCount: number } {
  const dot = input.priorPath.lastIndexOf(".");
  const stem = dot > 0 ? input.priorPath.slice(0, dot) : input.priorPath;
  const ext = dot > 0 ? input.priorPath.slice(dot) : "";
  return {
    keepPrior: true,
    archivedPriorPath: `${stem}.rev${input.revisionCount + 1}${ext}`,
    newPath: input.newPath,
    revisionCount: input.revisionCount + 1,
  };
}

export type AffectedClaim = {
  artifactId: number;
  segmentIndex: number;
  reason: "caption-hash-changed";
};

export function affectedClaims(input: {
  previousSha256: string;
  nextSha256: string;
  citations: { artifactId: number; segmentIndex: number; captionSha256: string }[];
}): AffectedClaim[] {
  if (input.previousSha256 === input.nextSha256) return [];
  return input.citations
    .filter((c) => c.captionSha256 === input.previousSha256)
    .map((c) => ({ artifactId: c.artifactId, segmentIndex: c.segmentIndex, reason: "caption-hash-changed" as const }));
}

const RECHECK_CADENCE_MS = 3 * 60 * 60 * 1000;

export function dueForRecheck(input: {
  status: CaptureDisposition;
  lastCheckedAt: string | null;
  now: Date;
}): boolean {
  if (input.status !== "provisional") return false;
  if (!input.lastCheckedAt) return true;
  const last = Date.parse(input.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return input.now.getTime() - last >= RECHECK_CADENCE_MS;
}

export type DraftRevisionResult = {
  draftsUpdated: number;
  affected: AffectedClaim[];
};

export async function applyDraftRevision(
  sql: import("../db.ts").Sql,
  input: { newsroomId: number; videoId: string; previousSha256: string; nextSha256: string },
): Promise<DraftRevisionResult> {
  if (input.previousSha256 === input.nextSha256) return { draftsUpdated: 0, affected: [] };
  const links = await sql.query<{ draft_id: number; artifact_id: number; citation_snapshot: string }>(
    "select draft_id,artifact_id,citation_snapshot from meeting_draft_transcript_links where newsroom_id=$1 and revision_notice is null",
    [input.newsroomId],
  );
  let draftsUpdated = 0;
  const affected: AffectedClaim[] = [];
  for (const link of links) {
    let citations: { artifactId: number; segmentIndex: number; captionSha256: string }[] = [];
    try {
      const parsed = JSON.parse(link.citation_snapshot) as unknown;
      if (Array.isArray(parsed)) citations = parsed as typeof citations;
    } catch {
      citations = [];
    }
    const hit = affectedClaims({ previousSha256: input.previousSha256, nextSha256: input.nextSha256, citations });
    if (!hit.length) continue;
    affected.push(...hit);
    const notice = `The transcript this draft cites was revised. Affected claims: ${hit.map((h) => `segment ${h.segmentIndex}`).join(", ")}.`;
    await sql.query(
      "update meeting_draft_transcript_links set revision_notice=$1, updated_at=now() where newsroom_id=$2 and draft_id=$3 and artifact_id=$4",
      [notice, input.newsroomId, link.draft_id, link.artifact_id],
    );
    /*
      Keep the citations, do not clear them.

      This wrote `transcriptCitations: []`, discarding the very list parsed
      eight lines up and used to decide which claims the revision affects. A
      draft that cites the tape would lose every citation at exactly the moment
      the machinery decided those citations mattered -- and the evidence token
      covers transcriptCitations, so the guard would then be checking an empty
      list while the draft still quoted the transcript.

      The parsed citations are written back, so the snapshot and the draft
      agree and the review token still changes when a citation moves.
    */
    await sql.query(
      "update drafts set research_json = coalesce(research_json,'{}') || $1, updated_at=now() where id=$2 and newsroom_id=$3",
      [JSON.stringify({ transcriptRevisionNotice: notice, transcriptCitations: citations }), link.draft_id, input.newsroomId],
    );
    draftsUpdated += 1;
  }
  return { draftsUpdated, affected };
}
