import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
const reportingDocumentServer = createServerOnlyFn(() => import("./reporting-document-check.server.ts"));
import { getSql, type Sql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { parseFindings, type StoryFinding } from "./findings.ts";
import type { DraftGroundingRow } from "./draft-specifics.ts";
import { EVIDENCE_REVIEW_VERSION_KEY, evidenceReviewToken } from "./draft-evidence.ts";
import { sha256 } from "./url-guard.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import type { ProvenanceItem, StoryClaim } from "./report.ts";
import type { DraftRow } from "./types.ts";
import { reportingStoryReviewClaims, type ReportingReviewClaim } from "./reporting-evidence-adapter.ts";
import type { ReportingPackage } from "./civic-reporting.ts";
import type { CurrentReportingDocumentCheck } from "./reporting-document-check.ts";
import { reportingDocumentClaimIdentity } from "./reporting-document-check.ts";
import type { AiEvidenceReview, AiEvidenceJudgment } from "./evidence-ai.ts";
import { auditOverrides, checkOverride, isOverrideWarning, type OverrideWarning } from "./override.ts";

/**
 * Audit items 13, 14, 15, 16, 17: the keys a warned evidence decision must
 * carry back on its second call. The UI never hardcodes them -- it sends the
 * key it was given -- so this is the server's own vocabulary.
 */
export const EVIDENCE_OVERRIDE_KEYS = {
  supportsNoCapture: "evidence:supports-without-capture",
  contradictsNoReason: "evidence:contradicts-without-reason",
  contradictsNoCapture: "evidence:contradicts-without-capture",
  removeSentence: "evidence:remove-sentence",
  manualClaimLength: "manual-claim:length",
  manualClaimReferences: "manual-claim:references",
  manualClaimDuplicateReference: "manual-claim:duplicate-reference",
  manualClaimReferenceUrl: "manual-claim:reference-url",
  manualClaimCount: "manual-claim:count",
} as const;

/**
 * The prefix the editor's own note carries, so the record says what it is.
 * The LABEL printed beside such a judgment ("editor's judgment, no capture")
 * lives in `finding-evidence-display.ts`, next to the other judgment copy.
 */
export const NO_CAPTURE_EDITOR_NOTE_PREFIX = "I know this from outside the captures: ";


export const MANUAL_CLAIM_FACT_WARN = 400;
export const MANUAL_CLAIM_REFERENCES_WARN = 6;
export const MANUAL_CLAIM_REFERENCE_URL_WARN = 500;

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
  /**
   * Unit U11b: an owner took this capture's excerpt down at a publisher's
   * request, and `evidence-takedown.ts` purged its stored text. The row says so
   * instead of saying "no readable captured text", and the desk does not offer
   * the takedown press again -- there is no restore, and nothing left to
   * remove. A taken-down capture is no longer readable, exactly as it is for a
   * judgment that would need its text.
   */
  takenDown: boolean;
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

    noCapture?: boolean;
    ai?: AiEvidenceJudgment;
    acceptedBy?: string;
    acceptedAt?: string;
  };
};

export type ClaimEvidenceRow = {
  key: string;
  claim: ReportingReviewClaim;
  captures: FindingCaptureEvidence[];
  judgment: FindingEvidenceRow["judgment"];
  currentDocumentCheck?: CurrentReportingDocumentCheck;
};

export type ManualClaimReferenceRelation = "corroborating" | "contrary" | "context";
const MANUAL_CLAIM_RELATIONS = new Set<ManualClaimReferenceRelation>([
  "corroborating",
  "contrary",
  "context",
]);
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
  civicReporting: boolean;
  evidenceToken: string;
  contentToken: string;
  canonicalDraft: { headline: string; dek: string; body: string; topic: string };
  rows: FindingEvidenceRow[];
  claimRows: ClaimEvidenceRow[];
  manualClaimRows: ManualClaimEvidenceRow[];
  /**
   * Round 2, item 5: the specifics the body states that no source the check
   * could read carries. Not a row stack with judgments -- there is nothing to
   * judge and no record to open -- but plain text the pane lists as needing a
   * person. Read from the draft's stored `draftGrounding` (see `storedGrounding`)
   * and empty when the draft predates the measurement or its body has moved.
   */
  groundingRows: DraftGroundingRow[];
  manualClaimCaptureOptions: ManualClaimCaptureOption[];
};

export type FindingEvidenceResult =
  | { ok: true; review: FindingEvidenceReview }
  | {
      ok: false;
      code: "forbidden" | "not-found" | "conflict" | "invalid-input";
      error: string;
    }
  | OverrideWarning;

export type FindingEvidenceCaptureResult =
  | {
      ok: true;
      capture: {
        versionId: number;
        title: string | null;
        url: string;
        capturedAt: string | null;
        fullText: string;
        /**
         * Unit U11b: this capture's excerpt was taken down, so its text is
         * purged (which is why `fullText` is empty) and the pane says that
         * rather than offering the takedown press again.
         */
        takenDown: boolean;
        /**
         * When it came down and the reason the owner recorded, for the pane to
         * print back to them. Null -- for an editor's read of the same capture
         * as well as for a capture that has not come down -- because
         * `loadFindingEvidenceCapture` only selects them for the owner: the
         * reason is a desk note that may name a publisher or a complaint, and
         * it does not leave the server for anyone else.
         */
        takenDownAt: string | null;
        takenDownReason: string | null;
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
      /** Audit items 16 and 17: keys the warned first call returned. */
      override?: string[];
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
      override?: never;
    };

class ReviewError extends Error {
  readonly code: "forbidden" | "not-found" | "conflict" | "invalid-input";
  constructor(code: "forbidden" | "not-found" | "conflict" | "invalid-input", message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Is this the error a draft with UNREADABLE STORED FINDINGS raises -- the one
 * case where "there is no review to resolve" is the honest answer? (Unit U24b.)
 *
 * WHY THE DISTINCTION IS LOAD-BEARING. `unreviewedClaimCount` (desk.ts) is the
 * publish gate's counter, and it used to catch everything and answer 0: a
 * transient database error therefore read as "no claims outstanding" and
 * OPENED the gate. Only the invalid-input branch -- `assertReadableStoredFindings`
 * and the two stored-shape readers throwing on a draft whose memo will not
 * parse -- genuinely means there is nothing to count; the Checks pane shows
 * those very rows as unreadable, so a publish that hard-failed on them would be
 * a story nobody could print or fix.
 *
 * Everything else must propagate: `not-found` (the draft vanished mid-request),
 * `conflict`, and every infrastructure error. A gate that cannot tell "nothing
 * to count" from "I could not count" fails OPEN, and this is the difference.
 */
export function isUnreadableFindingsError(error: unknown): boolean {
  return error instanceof ReviewError && error.code === "invalid-input";
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
  /** Unit U11b: non-null when this capture's excerpt was taken down. */
  taken_down_at: string | Date | null;
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
  taken_down_at: string | Date | null;
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
  delete research.manualClaims;
  /*
    The style audit is not part of what the editor judges here. It is written
    on every save, and its note and rejection trail change without the text,
    the claims or the evidence changing -- so counting it would throw away
    judgments about a draft the editor never touched.
  */
  delete research.styleAudit;
  /*
    Unit ZC: the completed-check identity stamp is a derived receipt of the draft
    THIS version is, written by a reconciliation pass and by an edit that moves the
    draft on. Like the style audit, it carries nothing the editor judges here, and
    counting it would throw away carried judgments after every reconcile. It is
    excluded by name so judgments recorded against the content still travel.
  */
  delete research[EVIDENCE_REVIEW_VERSION_KEY];
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

/** Retained rows keep human dispositions; evidence bindings still invalidate changed records. */
export function carryReconciledEvidenceJudgments(previous: DraftRow, saved: DraftRow, explicitlyJudged: ReadonlySet<string>): string {
  const research = objectMemo(saved.research_json);
  for (const namespace of ["findingEvidenceReview", "claimEvidenceReview"] as const) {
    const review = storedReview(previous, namespace);
    if (review.contentToken !== findingEvidenceContentToken(previous)) continue;
    const judgments = Object.fromEntries(Object.entries(review.judgments ?? {}).filter(([key]) => !explicitlyJudged.has(key)));
    research[namespace] = { ...review, contentToken: findingEvidenceContentToken(saved), judgments };
  }
  return JSON.stringify(research);
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

function storedClaims(draft: DraftRow): ReportingReviewClaim[] {
  const claims = objectMemo(draft.research_json).reportedClaims;
  if (claims == null) return [];
  if (!claims || typeof claims !== "object" || Array.isArray(claims))
    throw new ReviewError("invalid-input", "Stored draft claims are incomplete or unreadable.");
  const value = claims as Partial<StoredReportedClaims>;
  if ((value as { version?: number }).version === 2 && Array.isArray(value.rows)) {
    return value.rows.map((raw) => {
      const row = raw as ReportingReviewClaim;
      const reporting = row?.reporting;
      // A reconciliation can append ordinary captured-source claims while
      // retaining the older reporting ledger and its exact claim identities.
      if (row && !reporting && typeof row.fact === "string" && row.fact.trim() && row.fact.length <= 400 &&
          typeof row.url === "string" && row.url.trim() && row.url.length <= 500 &&
          ["primary", "record", "news"].includes(row.kind)) return row;
      if (!row || typeof row.fact !== "string" || !row.fact.trim() || row.kind !== "record" ||
          typeof row.url !== "string" || !reporting || typeof reporting.id !== "string" ||
          !["VERIFIED", "CONTESTED", "UNVERIFIED"].includes(reporting.status) ||
          typeof reporting.nextCheck !== "string" || typeof reporting.item !== "string" ||
          !Array.isArray(reporting.missingSourceIds) || !reporting.missingSourceIds.every((id) => typeof id === "string") ||
          !Array.isArray(reporting.references) || reporting.references.some((ref) =>
            !ref || typeof ref.id !== "string" || typeof ref.url !== "string" ||
            typeof ref.locator !== "string" || typeof ref.title !== "string" ||
            typeof ref.offlineReference !== "string" || !["A", "B", "C"].includes(ref.tier) ||
            (ref.versionId !== null && (!Number.isInteger(ref.versionId) || ref.versionId < 1))))
        throw new ReviewError("invalid-input", "Stored reporting claims are incomplete or unreadable.");
      return row;
    });
  }
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
  if (value.version !== 1 || !Array.isArray(value.rows))
    throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
  return value.rows.map((claim) => {
    if (
      !claim ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claim.id) ||
      typeof claim.fact !== "string" ||
      !claim.fact.trim() ||
      !["primary", "record", "news"].includes(claim.kind) ||
      !Array.isArray(claim.references)
    )
      throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
    const references = claim.references.map((reference) => {
      if (
        !reference ||
        !Number.isInteger(reference.versionId) ||
        reference.versionId < 1 ||
        typeof reference.url !== "string" ||
        !reference.url.trim() ||
        !["corroborating", "contrary", "context"].includes(reference.relation)
      )
        throw new ReviewError("invalid-input", "Stored manual claims are incomplete or unreadable.");
      return {
        versionId: reference.versionId,
        url: reference.url,
        relation: reference.relation,
      } as StoredManualClaimReference;
    });
    return { id: claim.id, fact: claim.fact, kind: claim.kind, references };
  });
}

function manualClaimKey(claim: StoredManualClaim) {
  return `manual-claim:${claim.id}`;
}

/**
 * Round 2, item 5: the ungrounded specifics stored with this draft, or none.
 *
 * Tolerant on purpose, unlike `storedClaims`/`storedManualClaims`. Those two
 * throw `invalid-input` on a shape they cannot read -- which the publish gate
 * treats as "there is nothing to count" (`isUnreadableFindingsError`) -- and a
 * grounding block the writer never produced (an older draft) or wrote badly
 * must not open or close a gate it has nothing to say about. A missing block
 * means "not measured"; a present block whose `checkedText` no longer matches
 * the body is STALE -- an editor edited the text after the measurement -- and is
 * dropped rather than listed, because its rows would name text nobody can see.
 */
export function storedGrounding(draft: Partial<DraftRow>): DraftGroundingRow[] {
  const stored = objectMemo(draft.research_json).draftGrounding;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return [];
  const value = stored as Record<string, unknown>;
  if (value.version !== 1 || typeof value.checkedText !== "string" || !Array.isArray(value.rows)) return [];
  if (normalizedText(value.checkedText) !== normalizedText(draft.body ?? "")) return [];
  const kinds = new Set<DraftGroundingRow["kind"]>(["address", "amount", "date", "identifier", "name", "vote"]);
  const rows: DraftGroundingRow[] = [];
  for (const raw of value.rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.kind !== "string" || !kinds.has(row.kind as DraftGroundingRow["kind"])) continue;
    if (typeof row.text !== "string" || !row.text.trim()) continue;
    rows.push({ kind: row.kind as DraftGroundingRow["kind"], text: row.text });
    if (rows.length >= 24) break;
  }
  return rows;
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

function sameCaptureUrl(left: string | null | undefined, right: string): boolean {
  if (!left) return false;
  try {
    // Capture storage uses this same identity normalization, including trailing
    // slashes and tracking parameters. Never guess redirects or drop document queries.
    return canonicalPublicUrl(left) === canonicalPublicUrl(right);
  } catch {
    return false;
  }
}

function provenanceForClaim(draft: DraftRow, claim: ReportingReviewClaim): StoryFinding {
  if (claim.reporting) return {
    text: claim.fact,
    source_urls: claim.reporting.references.flatMap((ref) => ref.url ? [ref.url] : []),
    artifact_version_ids: claim.reporting.references.flatMap((ref) => ref.versionId == null ? [] : [ref.versionId]),
    capture_event_ids: [],
    locators: claim.reporting.references.map((ref) => ref.locator).filter(Boolean),
  };
  let provenance: unknown = [];
  try {
    provenance = JSON.parse(draft.provenance_json || "[]");
  } catch {
    throw new ReviewError("invalid-input", "Stored draft provenance is incomplete or unreadable.");
  }
  const rows = Array.isArray(provenance) ? provenance : [];
  const matches = rows.filter(
    (item): item is Partial<ProvenanceItem> =>
      Boolean(item && typeof item === "object" && sameCaptureUrl((item as Partial<ProvenanceItem>).url, claim.url)),
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

async function claimKey(index: number, claim: ReportingReviewClaim) {
  return `claim:${index}:${await sha256(JSON.stringify([claim.fact, claim.url, claim.kind, ...(claim.reporting ? [claim.reporting] : [])]))}`;
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
        ...(judgment.noCapture === true ? { noCapture: true } : {}),
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
  const memo = objectMemo(draft.research_json);
  if (memo.civicReporting === true && memo.reportedClaims == null &&
      Number.isInteger(memo.requestId) && typeof memo.storyId === "string") {
    const [stored] = await sql.query<{ package: ReportingPackage; created_at: string | Date }>(
      `select package,created_at from reporting_packages where newsroom_id=$1 and request_id=$2`,
      [newsroomId, memo.requestId],
    );
    const pack = typeof stored?.package === "string" ? JSON.parse(stored.package) : stored?.package;
    const story = pack?.stories?.find((row: { id: string }) => row.id === memo.storyId);
    if (story) {
      memo.reportedClaims = await reportingStoryReviewClaims(sql, newsroomId, story, new Date(stored.created_at).toISOString());
      // Read-only compatibility hydration. The existing judgment save persists
      // this snapshot in the draft memo; another request never replaces it.
      draft.research_json = JSON.stringify(memo);
    } else throw new ReviewError("not-found", "The reporting ledger for this draft is unavailable. Reload after filing completes or restore its saved package before reviewing claims.");
  }
  return draft;
}

type EvidenceSnapshot = {
  versions: Array<VersionRow & { text_fingerprint: string }>;
  captures: CaptureRow[];
};

async function findingReferenceBinding(
  sql: Sql,
  newsroomId: number,
  finding: StoryFinding,
  lock = false,
  snapshot?: EvidenceSnapshot,
): Promise<string> {
  const versionIds = [...new Set(finding.artifact_version_ids)];
  const captureIds = [...new Set(finding.capture_event_ids)];
  const captures = snapshot
    ? snapshot.captures.filter(row => captureIds.includes(row.id)).sort((a,b) => a.id-b.id)
      .map(({ id, version_id, source_url, content_hash }) => ({ id, version_id, source_url, content_hash }))
    : captureIds.length
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
  const versions = snapshot
    ? snapshot.versions.filter(row => allVersionIds.includes(row.id)).sort((a,b) => a.id-b.id)
      .map(({ id, url, content_hash, text_fingerprint }) => ({ id, url, content_hash, text_fingerprint }))
    : allVersionIds.length
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

async function manualClaimBinding(
  sql: Sql,
  newsroomId: number,
  claim: StoredManualClaim,
  lock = false,
  snapshot?: EvidenceSnapshot,
): Promise<string> {
  return JSON.stringify({
    claim: {
      id: claim.id,
      fact: claim.fact,
      kind: claim.kind,
      references: claim.references.map(({ versionId, url, relation }) => ({ versionId, url, relation })),
    },
    captured: JSON.parse(
      await findingReferenceBinding(sql, newsroomId, referenceForManualClaim(claim), lock, snapshot),
    ),
  });
}

async function fullReviewToken(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  findings: StoryFinding[],
  claims: ReportingReviewClaim[],
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
        manualClaimBinding(sql, newsroomId, claim, lock),
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
  evidenceBinding?: string,
  snapshot?: EvidenceSnapshot,
): Promise<FindingEvidenceRow> {
  const versionIds = [...new Set(finding.artifact_version_ids)];
  const captureIds = [...new Set(finding.capture_event_ids)];
  const versions = snapshot ? snapshot.versions.filter(row => versionIds.includes(row.id)) : versionIds.length
    ? await sql.query<VersionRow>(
        "select id,url,title,full_text,content_hash,captured_at,taken_down_at from artifact_versions where newsroom_id=$1 and id=any($2::int[])",
        [newsroomId, versionIds],
      )
    : [];
  const captures = snapshot ? snapshot.captures.filter(row => captureIds.includes(row.id)) : captureIds.length
    ? await sql.query<CaptureRow>(
        `select ce.id,ce.version_id,ce.source_url,ce.observed_at,ce.content_hash,
                av.title,av.full_text,av.content_hash as version_content_hash,
                av.captured_at as version_captured_at,av.taken_down_at
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
            taken_down_at: capture.taken_down_at,
          }
        : undefined);
    const url = availableVersion?.url ?? capture?.source_url ?? null;
    const [newer] = url && !snapshot
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
      takenDown: Boolean(availableVersion?.taken_down_at),
      excerptState: excerptState(finding.excerpt, availableVersion?.full_text ?? null),
      newerCapture: newer
        ? { versionId: newer.id, capturedAt: newer.captured_at ? String(newer.captured_at) : null }
        : null,
      viewHref: availableVersion ? `/evidence/${availableVersion.id}` : null,
    });
  }
  let judgment = judgmentFor(draft, key, namespace);
  const currentBinding = evidenceBinding ?? (await findingReferenceBinding(sql, newsroomId, finding, false, snapshot));
  const readableVersions = new Set(
    resolved
      .filter((capture) => capture.available && capture.readable)
      .map((capture) => capture.versionId),
  );

  const bindingMoved = judgment.value !== "unreviewed" && judgment.evidenceBinding !== currentBinding;
  const supportsUnreadable =
    judgment.value === "supports" && !judgment.noCapture && readableVersions.size === 0;
  const contradictsUnreadable =
    judgment.value === "contradicts" &&
    !judgment.noCapture &&
      (!judgment.reason ||
        judgment.contraryVersionId == null ||
      !readableVersions.has(judgment.contraryVersionId));
  if (bindingMoved || supportsUnreadable || contradictsUnreadable)
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
      ...(judgment.noCapture ? { noCapture: true } : {}),
    },
  };
}

async function resolveClaim(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  claim: ReportingReviewClaim,
  index: number,
  snapshot?: EvidenceSnapshot,
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
    undefined,
    snapshot,
  );
  const captures = resolved.captures.map((capture) =>
    (claim.reporting ? claim.reporting.references.some((ref) =>
      ref.versionId === capture.versionId && sameCaptureUrl(capture.url, ref.url)) : sameCaptureUrl(capture.url, claim.url))
      ? capture
      : {
          versionId: capture.versionId,
          captureEventId: capture.captureEventId,
          url: null,
          title: null,
          capturedAt: null,
          available: false,
          readable: false,
          takenDown: false,
          excerptState: "no-excerpt" as const,
          newerCapture: null,
          viewHref: null,
        },
  );
  const readableVersionIds = new Set(
    captures.filter((capture) => capture.available && capture.readable).map((capture) => capture.versionId),
  );
  const judgment =
    (resolved.judgment.value === "supports" &&
      !resolved.judgment.noCapture &&
      readableVersionIds.size === 0) ||
    (resolved.judgment.value === "contradicts" &&
      !resolved.judgment.noCapture &&
      (!resolved.judgment.reason ||
        resolved.judgment.contraryVersionId == null ||
        !readableVersionIds.has(resolved.judgment.contraryVersionId)))
      ? { value: "unreviewed" as const, reason: "", contraryVersionId: null }
      : resolved.judgment;
  const transcript = claim.reporting?.transcriptEvidence;
  const record = claim.reporting?.recordEvidence;
  const closest = claim.reporting?.closestEvidence;
  const recordQuote = transcript?.quote.trim() || record?.quote.trim() || "";
  const recordUrl = transcript?.videoUrl || record?.url || "";
  const recordSeconds = transcript?.startSeconds ?? record?.startSeconds;
  const hasTranscriptSupport = claim.reporting?.status === "VERIFIED" && Boolean(
    recordQuote && recordUrl && (recordSeconds === undefined || (Number.isFinite(recordSeconds) && recordSeconds >= 0)),
  );
  if (hasTranscriptSupport && recordQuote) {
    const seconds = recordSeconds === undefined ? null : Math.floor(recordSeconds);
    const joiner = recordUrl.includes("?") ? "&" : "?";
    captures.push({
      versionId: null,
      captureEventId: null,
      url: recordUrl,
      title: recordQuote,
      capturedAt: null,
      available: true,
      readable: true,
      takenDown: false,
      excerptState: "found",
      newerCapture: null,
      viewHref: seconds === null ? recordUrl : `${recordUrl}${joiner}t=${seconds}s`,
    });
  }
  if (claim.reporting?.status !== "VERIFIED" && closest) {
    const seconds = closest.startSeconds === undefined ? null : Math.floor(closest.startSeconds);
    captures.push({
      versionId: null,
      captureEventId: null,
      url: closest.url,
      title: closest.quote,
      capturedAt: null,
      available: true,
      readable: true,
      takenDown: false,
      excerptState: "found",
      newerCapture: null,
      viewHref: seconds === null ? closest.url : `${closest.url}${closest.url.includes("?") ? "&" : "?"}t=${seconds}s`,
    });
  }
  return {
    key,
    claim,
    captures,
    judgment: hasTranscriptSupport ? { value: "supports", reason: "", contraryVersionId: null } : judgment,
  };
}

async function resolveManualClaim(
  sql: Sql,
  newsroomId: number,
  draft: DraftRow,
  claim: StoredManualClaim,
  snapshot?: EvidenceSnapshot,
): Promise<ManualClaimEvidenceRow> {
  const key = manualClaimKey(claim);
  const evidenceBinding = await manualClaimBinding(sql, newsroomId, claim, false, snapshot);
  const resolved = await resolveFinding(
    sql,
    newsroomId,
    draft,
    referenceForManualClaim(claim),
    0,
    key,
    "claimEvidenceReview",
    evidenceBinding,
    snapshot,
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
        takenDown: false,
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
  let judgment =
    (resolved.judgment.value === "supports" &&
      !resolved.judgment.noCapture &&
      readableVersions.size === 0) ||
    (resolved.judgment.value === "contradicts" &&
      !resolved.judgment.noCapture &&
      (!resolved.judgment.reason ||
        resolved.judgment.contraryVersionId == null ||
        !readableVersions.has(resolved.judgment.contraryVersionId)))
      ? { value: "unreviewed" as const, reason: "", contraryVersionId: null }
      : resolved.judgment;
  if (
    judgment.value !== "unreviewed" &&
    judgmentFor(draft, manualClaimKey(claim), "claimEvidenceReview").evidenceBinding !==
      evidenceBinding
  )
    judgment = { value: "unreviewed", reason: "", contraryVersionId: null };
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

/** A desk count uses one bounded snapshot, with the same judgment resolver as Checks.
 * No review tokens, newer-capture lookups, capture options or per-draft SQL. */
export async function loadDeskClaimCounts(sql: Sql, newsroomId: number, draftIds: number[]) {
  const result = new Map<number, { outstanding: number; accepted: number }>();
  if (!draftIds.length) return result;
  const [snapshot] = await sql.query<{
    drafts: Array<DraftRow & { notes_json: string }>;
    versions: EvidenceSnapshot["versions"];
    captures: CaptureRow[];
  }>(`
    with selected as (
      select d.*, l.notes_json from drafts d
      join leads l on l.id=d.lead_id and l.newsroom_id=d.newsroom_id
      where d.newsroom_id=$1 and d.id=any($2::int[])
        and l.notes_json like '%unreviewedClaimsConfirmation%'
    ), material as (
      select jsonb_build_array(case when found_note is json then found_note::jsonb else '[]'::jsonb end,
        case when provenance_json is json then provenance_json::jsonb else '[]'::jsonb end,
        case when research_json is json then research_json::jsonb else '{}'::jsonb end) as doc from selected
    ), version_ids as (
      select distinct case when (v #>> '{}') ~ '^[0-9]+$'
        and (v #>> '{}')::numeric between 1 and 2147483647 then (v #>> '{}')::int end as id from material,
      lateral (
        select jsonb_path_query(doc, '$.**.artifact_version_ids[*]') as v
        union all select jsonb_path_query(doc, '$.**.version_id')
        union all select jsonb_path_query(doc, '$.**.versionId')
      ) refs where jsonb_typeof(v)='number'
    ), capture_ids as (
      select distinct case when (v #>> '{}') ~ '^[0-9]+$'
        and (v #>> '{}')::numeric between 1 and 2147483647 then (v #>> '{}')::int end as id from material,
      lateral (select jsonb_path_query(doc, '$.**.capture_event_ids[*]') as v) refs
      where jsonb_typeof(v)='number'
    ), captures as (
      select ce.id,ce.version_id,ce.source_url,ce.observed_at,ce.content_hash,
        av.title,av.full_text,av.content_hash as version_content_hash,
        av.captured_at as version_captured_at,av.taken_down_at
      from capture_events ce left join artifact_versions av
        on av.id=ce.version_id and av.newsroom_id=ce.newsroom_id
      where ce.newsroom_id=$1 and ce.id in (select id from capture_ids)
    ), versions as (
      select av.*,md5(av.full_text) as text_fingerprint from artifact_versions av
      where av.newsroom_id=$1 and (av.id in (select id from version_ids)
        or av.id in (select version_id from captures))
    ) select
      coalesce((select jsonb_agg(to_jsonb(d)) from selected d),'[]'::jsonb) as drafts,
      coalesce((select jsonb_agg(to_jsonb(v)) from versions v),'[]'::jsonb) as versions,
      coalesce((select jsonb_agg(to_jsonb(c)) from captures c),'[]'::jsonb) as captures
  `, [newsroomId, draftIds]);
  const { claimsNeedingReview } = await import("./evidence-check-state.ts");
  const { parseNotes } = await import("./notes.ts");
  const { evidenceConfirmationMatches } = await import("./draft-evidence.ts");
  for (const draft of snapshot?.drafts ?? []) {
    const acceptance = parseNotes(draft.notes_json).unreviewedClaimsConfirmation;
    if (!acceptance || !evidenceConfirmationMatches(acceptance.token, draft)) continue;
    // Legacy unhydrated ledgers cannot be promoted from a memo-only count.
    const memo = objectMemo(draft.research_json);
    if (memo.civicReporting === true && memo.reportedClaims == null) continue;
    try {
      assertReadableStoredFindings(draft.found_note);
      const review: FindingEvidenceReview = {
        leadId: draft.lead_id, draftId: draft.id, civicReporting: memo.civicReporting === true,
        evidenceToken: "", contentToken: "", canonicalDraft: draft,
        rows: await Promise.all(parseFindings(draft.found_note).map((finding,index) =>
          resolveFinding(sql, newsroomId, draft, finding, index, undefined, undefined, undefined, snapshot))),
        claimRows: await Promise.all(storedClaims(draft).map((claim,index) =>
          resolveClaim(sql, newsroomId, draft, claim, index, snapshot))),
        manualClaimRows: await Promise.all(storedManualClaims(draft).map(claim =>
          resolveManualClaim(sql, newsroomId, draft, claim, snapshot))),
        groundingRows: storedGrounding(draft), manualClaimCaptureOptions: [],
      };
      await applyAiReview(sql, newsroomId, draft, review, snapshot);
      result.set(draft.id, { outstanding: claimsNeedingReview(review.rows, review.claimRows,
        review.manualClaimRows, review.groundingRows), accepted: acceptance.count });
    } catch (error) {
      if (!isUnreadableFindingsError(error)) throw error;
    }
  }
  return result;
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
  const reporting = objectMemo(draft.research_json);
  const currentDocumentChecks = reporting.civicReporting === true && Number.isSafeInteger(reporting.requestId)
    ? await (await reportingDocumentServer()).loadCurrentReportingDocumentChecks(sql, newsroomId, Number(reporting.requestId))
    : {};
  const storyChecks = typeof reporting.storyId === "string" ? currentDocumentChecks[reporting.storyId] : undefined;
  const review: FindingEvidenceReview = {
    leadId,
    draftId: draft.id,
    civicReporting: reporting.civicReporting === true,
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
      claims.map(async (claim, index) => {
        const row = await resolveClaim(sql, newsroomId, draft, claim, index);
        if (!claim.reporting) return row;
        const check = storyChecks?.[claim.reporting.id];
        const sameClaim = !check?.filedClaimIdentity || check.filedClaimIdentity === reportingDocumentClaimIdentity(
          claim.reporting.id, claim.fact, claim.reporting.item, claim.reporting.references);
        return { ...row, currentDocumentCheck: check && sameClaim ? check : {
          state: "unavailable" as const, status: null,
          note: "The retained package does not match this draft claim's text and references, or its current check is unavailable.",
          references: [], checkedAt: new Date().toISOString(), inputFingerprint: "",
        } };
      }),
    ),
    manualClaimRows: await Promise.all(
      manualClaims.map((claim) => resolveManualClaim(sql, newsroomId, draft, claim)),
    ),
    groundingRows: storedGrounding(draft),
    manualClaimCaptureOptions: await manualClaimCaptureOptions(sql, newsroomId, draft),
  };
  return applyAiReview(sql, newsroomId, draft, review);
}

async function applyAiReview(sql: Sql, newsroomId: number, draft: DraftRow, review: FindingEvidenceReview, snapshot?: EvidenceSnapshot): Promise<FindingEvidenceReview> {
  const reporting = objectMemo(draft.research_json);
  const ai = reporting.aiEvidenceReview as AiEvidenceReview | undefined;
  if (ai?.checkedText === draft.body && Array.isArray(ai.rows)) {
    for (const row of [...review.rows, ...review.claimRows]) {
      const text = "finding" in row ? row.finding.text : row.claim.fact;
      const saved = ai.rows.find((judgment) => judgment.text === text);
      if (!saved) continue;
      const namespace = "finding" in row ? "findingEvidenceReview" : "claimEvidenceReview";
      const human = judgmentFor(draft, row.key, namespace);
      if (human.value !== "unreviewed") {
        const stored = storedReview(draft, namespace).judgments?.[row.key];
        if (row.judgment.value === "supports" && stored?.acceptedBy && saved.verdict === "Supported")
          row.judgment = { ...row.judgment, ai: saved, acceptedBy: stored.acceptedBy, acceptedAt: stored.acceptedAt };
        continue;
      }
      const matches = row.captures.filter(
        (capture) => capture.url === saved.sourceUrl && capture.readable && !capture.takenDown,
      );
      let grounded = false;
      for (const capture of matches) {
        if (capture.versionId != null) {
          const [retained] = snapshot ? snapshot.versions.filter(version => version.id === capture.versionId && !version.taken_down_at) : await sql.query<{ full_text: string }>(
            "select full_text from artifact_versions where id=$1 and newsroom_id=$2 and taken_down_at is null",
            [capture.versionId, newsroomId],
          );
          grounded ||= Boolean(
            retained &&
            saved.quote &&
            (await sha256(retained.full_text)) === saved.sourceHash &&
            normalizedText(retained.full_text).includes(normalizedText(saved.quote)),
          );
        } else if ("claim" in row && row.claim.reporting?.recordEvidence?.kind === "transcript") {
          grounded ||= row.claim.reporting.recordEvidence.quote === saved.quote;
        }
      }
      row.judgment = {
        value:
          grounded && saved.verdict === "Supported"
            ? "supports"
            : grounded && saved.verdict === "Not supported"
              ? "does-not-support"
              : "needs-reporting",
        reason: saved.reason,
        contraryVersionId: null,
        ai:
          grounded || saved.verdict === "Needs a human"
            ? saved
            : {
                ...saved,
                verdict: "Needs a human",
                reason: "The retained passage changed or is unavailable.",
              },
      };
    }
  }
  return review;
}

/**
 * The capture, for the desk's pane -- including, for the OWNER only, when it
 * was taken down and why.
 *
 * `role` is not an access check on the capture (every editor may read a
 * captured record for a draft they can see); it decides whether the takedown's
 * own note travels. The reason may name a publisher, a lawyer or a complaint,
 * so an editor's read carries `null` for both fields rather than the note --
 * the boundary is here, on the server, and not a rendering choice in the pane.
 */
export const loadFindingEvidenceCapture = createServerOnlyFn(
  async function loadFindingEvidenceCapture(
    sql: Sql,
    newsroomId: number,
    leadId: number,
    draftId: number,
    versionId: number,
    role: string = "editor",
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
      taken_down_at: string | Date | null;
      taken_down_reason: string | null;
    }>(
      "select id,title,url,captured_at,full_text,taken_down_at,taken_down_reason from artifact_versions where newsroom_id=$1 and id=$2",
      [newsroomId, versionId],
    );
    if (!version)
      return { ok: false, code: "not-found", error: "That captured version is no longer available." };
    const owner = role === "owner";
    return {
      ok: true,
      capture: {
        versionId: version.id,
        title: version.title || null,
        url: version.url,
        capturedAt: version.captured_at ? String(version.captured_at) : null,
        fullText: version.full_text ?? "",
        takenDown: Boolean(version.taken_down_at),
        takenDownAt:
          owner && version.taken_down_at ? String(version.taken_down_at) : null,
        takenDownReason: owner ? version.taken_down_reason : null,
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
  /** Audit items 13/14: keys a warned first call returned. */
  override?: string[];
  /** The editor's own note, required when recording a judgment with no capture. */
  editorNote?: string;
};

type AiEvidenceDecisionInput = { leadId: number; draftId: number; evidenceToken: string;
  action: "accept-supported" | "mark-checked" | "remove-sentence"; findingKey?: string;
  /** Audit item 15: the key a warned `remove-sentence` call returned. */
  override?: string[] };


function removeTextOccurrence(body: string, text: string): string {
  const needle = text.trim();
  if (!needle) return body;
  const index = body.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return body;
  const before = body.slice(0, index).replace(/\s+$/, "");
  const after = body.slice(index + needle.length).replace(/^\s+/, "");
  return before && after ? `${before} ${after}` : before || after;
}

/** One atomic save, fenced to the draft and retained evidence the editor saw. */
export const persistAiEvidenceDecision = createServerOnlyFn(async function persistAiEvidenceDecision(
  context: { newsroomId: number; userId: string }, input: AiEvidenceDecisionInput,
): Promise<FindingEvidenceReview | OverrideWarning> {
  const { withLeadDraftLock } = await import("./draft-order.server.ts");
  const outcome = await withLeadDraftLock<OverrideWarning | { warnings: string[] }>(context, input.leadId, async (sql) => {
    const draft = await currentDraft(sql, context.newsroomId, input.leadId);
    const findings = parseFindings(draft.found_note), claims = storedClaims(draft), manual = storedManualClaims(draft);
    if (draft.id !== input.draftId || input.evidenceToken !== await fullReviewToken(sql, context.newsroomId, draft, findings, claims, manual, true))
      throw new ReviewError("conflict", "The draft or retained evidence changed. Reload before deciding.");
    const review = await loadFindingEvidenceReview(sql, context.newsroomId, input.leadId);
    const rows = [...review.rows, ...review.claimRows].filter((row) => input.action === "accept-supported"
      ? row.judgment.ai?.verdict === "Supported" && row.judgment.value === "supports"
      : row.key === input.findingKey && row.judgment.ai?.verdict === "Not supported");
    if (!rows.length) throw new ReviewError("conflict", "There are no matching AI judgments to save.");
    const memo = objectMemo(draft.research_json);
    const [editor] = await sql.query<{ name: string }>('select name from "user" where id=$1', [context.userId]);
    const acceptedBy = editor?.name || context.userId, acceptedAt = new Date().toISOString();
    const warnings: string[] = [];
    if (input.action === "remove-sentence") {
      const row = rows[0], text = "finding" in row ? row.finding.text : row.claim.fact;
      const sentences = draft.body.split(/(?<=[.!?])\s+/);
      const exact = sentences.findIndex((sentence) => normalizedText(sentence) === normalizedText(text));
      let removalIndex = exact;
      if (exact < 0) {

        const warning = checkOverride(
          input,
          EVIDENCE_OVERRIDE_KEYS.removeSentence,
          "This claim is not a whole sentence in the draft, so it cannot be removed exactly. Remove it anyway as a coherent edit?",
        );
        if (warning) return warning;
        warnings.push(EVIDENCE_OVERRIDE_KEYS.removeSentence);
        removalIndex = sentences.findIndex((sentence) =>
          normalizedText(sentence).includes(normalizedText(text)),
        );
      }
      const nextBody =
        removalIndex >= 0
          ? sentences.filter((_, index) => index !== removalIndex).join(" ")
          : removeTextOccurrence(draft.body, text);
      if (!nextBody.trim())
        throw new ReviewError(
          "invalid-input",
          "Removing this claim would leave the draft with no body. Edit the draft or mark it checked.",
        );
      draft.body = nextBody;
      draft.found_note = JSON.stringify(findings.filter((finding) => finding.text !== text));
      const reported = memo.reportedClaims as { rows?: ReportingReviewClaim[] } | undefined;
      if (reported?.rows) reported.rows = reported.rows.filter((claim) => claim.fact !== text);
      const ai = memo.aiEvidenceReview as AiEvidenceReview;
      ai.checkedText = draft.body;
      ai.rows = ai.rows.filter((judgment) => judgment.text !== text);
      memo.aiEvidenceRemoval = { text, acceptedBy, acceptedAt };
    } else {
      for (const row of rows) {
        const isFinding = "finding" in row;
        const namespace: ReviewNamespace = isFinding ? "findingEvidenceReview" : "claimEvidenceReview";
        const index = isFinding ? findings.findIndex((finding) => finding.text === row.finding.text) :
          claims.findIndex((claim, index) => row.key.startsWith(`claim:${index}:`) && claim.fact === row.claim.fact);
        const previous = (memo[namespace] as ReviewMemo | undefined) ?? {};
        const judgments = previous.contentToken === findingEvidenceContentToken(draft) ? { ...previous.judgments } : {};
        judgments[row.key] = { value: input.action === "accept-supported" ? "supports" : "does-not-support",
          reason: input.action === "accept-supported" ? "Accepted the AI's grounded support." : "Editor checked despite the AI's unsupported verdict.",
          contraryVersionId: null, acceptedBy, acceptedAt,
          evidenceBinding: await findingReferenceBinding(sql, context.newsroomId, isFinding ? findings[index] : provenanceForClaim(draft, claims[index]), true) };
        memo[namespace] = { contentToken: findingEvidenceContentToken(draft), judgments };
      }
    }
    await sql.query("update drafts set body=$1,found_note=$2,research_json=$3,updated_at=now() where id=$4 and newsroom_id=$5",
      [draft.body, draft.found_note, JSON.stringify(memo), draft.id, context.newsroomId]);
    return { warnings: input.action === "remove-sentence" ? warnings : [] };
  });
  if (isOverrideWarning(outcome)) return outcome;
  /*
    Only after the mutation committed: one `override` audit row per accepted
    key. A warned-but-not-accepted call returned above and writes nothing.
  */
  if (outcome.warnings.length)
    await auditOverrides(
      { userId: context.userId, newsroomId: context.newsroomId },
      outcome.warnings,
      { kind: "draft", id: input.draftId },
    );
  return loadFindingEvidenceReview(await getSql(), context.newsroomId, input.leadId);
});

export const decideAiEvidence = createServerFn({ method: "POST" }).middleware([deskMiddleware])
  .validator((input: AiEvidenceDecisionInput) => {
    if (!input || !Number.isSafeInteger(input.leadId) || input.leadId < 1 ||
      !Number.isSafeInteger(input.draftId) || input.draftId < 1 || typeof input.evidenceToken !== "string" ||
      !["accept-supported", "mark-checked", "remove-sentence"].includes(input.action)) throw new Error("Invalid evidence decision.");
    return input;
  }).handler(async ({ context, data }): Promise<FindingEvidenceResult> => {
    try {
      const result = await persistAiEvidenceDecision(context, data);
      return isOverrideWarning(result) ? result : { ok: true, review: result };
    }
    catch (error) { return { ok: false, code: error instanceof ReviewError ? error.code : "invalid-input",
      error: error instanceof Error ? error.message : "The evidence decision could not be saved." }; }
  });

export const persistFindingEvidenceJudgment = createServerOnlyFn(
  async function persistFindingEvidenceJudgment(
    context: { newsroomId: number; userId?: string },
    input: SaveFindingJudgmentInput,
  ): Promise<FindingEvidenceReview | OverrideWarning> {
    if (!JUDGMENTS.has(input.judgment))
      throw new ReviewError("invalid-input", "Choose a valid evidence judgment.");
    if (input.reason.length > 2000)
      throw new ReviewError(
        "invalid-input",
        "The evidence-review reason must be 2,000 characters or fewer.",
      );
    const reason = input.reason.trim();
    /*
      Audit item 13: a contradiction still needs a REASON (its own substance),
      but a cited contrary capture is now a warn/override limit, so it is not
      refused here.
    */
    const { withLeadDraftLock } = await import("./draft-order.server.ts");
    const outcome = await withLeadDraftLock<OverrideWarning | { warnings: string[] }>(context, input.leadId, async (sql) => {
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

      const warnings: string[] = [];
      let noCapture = false;
      if (input.judgment === "contradicts" && !(isManualClaim ? contraryVersionIds : citedVersionIds).has(input.contraryVersionId!)) {
        const warning = checkOverride(
          input,
          EVIDENCE_OVERRIDE_KEYS.contradictsNoCapture,
          isManualClaim
            ? "This manual claim has no readable record explicitly marked contrary. Record it as your own judgment, outside the captures?"
            : "This item has no readable cited contrary captured record. Record it as your own judgment, outside the captures?",
        );
        if (warning) return warning;
        noCapture = true;
        warnings.push(EVIDENCE_OVERRIDE_KEYS.contradictsNoCapture);
      }
      if (input.judgment === "supports" && (isManualClaim ? supportVersionIds : citedVersionIds).size === 0) {
        const warning = checkOverride(
          input,
          EVIDENCE_OVERRIDE_KEYS.supportsNoCapture,
          isManualClaim
            ? "This manual claim has no readable corroborating record. Save it as your own judgment, outside the captures?"
            : "This item has no readable cited captured record. Save it as your own judgment, outside the captures?",
        );
        if (warning) return warning;
        noCapture = true;
        warnings.push(EVIDENCE_OVERRIDE_KEYS.supportsNoCapture);
      }
      if (!noCapture && input.judgment === "contradicts" && !reason) {
        const warning = checkOverride(input, EVIDENCE_OVERRIDE_KEYS.contradictsNoReason,
          "This contradiction has no explanation. Save your judgment anyway?");
        if (warning) return warning;
        warnings.push(EVIDENCE_OVERRIDE_KEYS.contradictsNoReason);
      }
      let storedReason = reason;
      if (noCapture) {
        const note = (input.editorNote ?? "").trim();
        storedReason = !note ? "Editor judgment outside the captures; no explanation supplied." : note.toLowerCase().startsWith(NO_CAPTURE_EDITOR_NOTE_PREFIX.toLowerCase())
          ? note
          : `${NO_CAPTURE_EDITOR_NOTE_PREFIX}${note}`;
      }
      const memo = objectMemo(draft.research_json);
      const previous = storedReview(draft, namespace);
      const judgments =
        previous.contentToken === contentToken && previous.judgments ? previous.judgments : {};
      const evidenceBinding = isManualClaim
        ? await manualClaimBinding(sql, context.newsroomId, manualClaim!, true)
        : await findingReferenceBinding(sql, context.newsroomId, reference, true);
      judgments[input.findingKey] = {
        value: input.judgment,
        reason: storedReason,
        contraryVersionId: input.judgment === "contradicts" && !noCapture ? input.contraryVersionId : null,
        evidenceBinding,
        ...(noCapture ? { noCapture: true } : {}),
      };
      memo[namespace] = { contentToken, judgments };
      await sql.query(
        "update drafts set research_json=$1,updated_at=now() where id=$2 and newsroom_id=$3",
        [JSON.stringify(memo), draft.id, context.newsroomId],
      );
      return { warnings };
    });
    if (isOverrideWarning(outcome)) return outcome;
    if (outcome.warnings.length)
      await auditOverrides(
        { userId: context.userId ?? "", newsroomId: context.newsroomId },
        outcome.warnings,
        { kind: "draft", id: input.draftId },
      );
    const sql = await getSql();
    return loadFindingEvidenceReview(sql, context.newsroomId, input.leadId);
  },
);

async function resolvedManualReferences(
  sql: Sql,
  newsroomId: number,
  references: Array<{ versionId: number; relation: ManualClaimReferenceRelation }>,
): Promise<StoredManualClaimReference[]> {

  if (references.some((reference) => !Number.isInteger(reference.versionId) || reference.versionId < 1))
    throw new ReviewError("invalid-input", "Choose valid captured records.");
  if (references.some((reference) => !MANUAL_CLAIM_RELATIONS.has(reference.relation)))
    throw new ReviewError("invalid-input", "Choose a valid relationship for every captured record.");
  const uniqueIds = [...new Set(references.map((reference) => reference.versionId))];
  const versions = await sql.query<{ id: number; url: string }>(
    "select id,url from artifact_versions where newsroom_id=$1 and id=any($2::int[])",
    [newsroomId, uniqueIds],
  );
  if (versions.length !== uniqueIds.length)
    throw new ReviewError("invalid-input", "Every selected captured record must still belong to this newsroom.");
  const urls = new Map(versions.map((version) => [version.id, version.url]));
  return references.map((reference) => ({ ...reference, url: urls.get(reference.versionId)! }));
}

export const persistManualClaim = createServerOnlyFn(
  async function persistManualClaim(
    context: { newsroomId: number; userId?: string },
    input: SaveManualClaimInput,
  ): Promise<FindingEvidenceReview | OverrideWarning> {
    const { withLeadDraftLock } = await import("./draft-order.server.ts");
    const outcome = await withLeadDraftLock<OverrideWarning | { warnings: string[] }>(context, input.leadId, async (sql) => {
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
        if (!input.fact.trim() || !["primary", "record", "news"].includes(input.kind))
          throw new ReviewError("invalid-input", "Provide a claim and a valid kind.");
        /*
          Audit item 16: an over-length claim warns and is then stored WHOLE
          under override, with the complete claim retained.
        */
        const warnings: string[] = [];
        if (input.fact.length > MANUAL_CLAIM_FACT_WARN) {
          const warning = checkOverride(
            input,
            EVIDENCE_OVERRIDE_KEYS.manualClaimLength,
            `This claim is longer than ${MANUAL_CLAIM_FACT_WARN} characters. Save it anyway?`,
          );
          if (warning) return warning;
          warnings.push(EVIDENCE_OVERRIDE_KEYS.manualClaimLength);
        }
        /*
          Audit item 17: the reference count, a repeated record and an over-long
          address warn. The newsroom boundary itself stays hard, below.
        */
        if (input.references.length === 0 || input.references.length > MANUAL_CLAIM_REFERENCES_WARN) {
          const warning = checkOverride(
            input,
            EVIDENCE_OVERRIDE_KEYS.manualClaimReferences,
            input.references.length === 0 ? "This claim has no captured record. Save it as an editor’s claim?" : `A manual claim usually cites up to ${MANUAL_CLAIM_REFERENCES_WARN} captured records. Save it with this many anyway?`,
          );
          if (warning) return warning;
          warnings.push(EVIDENCE_OVERRIDE_KEYS.manualClaimReferences);
        }
        if (
          input.references.length > 0 &&
          new Set(input.references.map((reference) => reference.versionId)).size !== input.references.length
        ) {
          const warning = checkOverride(
            input,
            EVIDENCE_OVERRIDE_KEYS.manualClaimDuplicateReference,
            "The same captured record is chosen more than once. Save it anyway?",
          );
          if (warning) return warning;
          warnings.push(EVIDENCE_OVERRIDE_KEYS.manualClaimDuplicateReference);
        }
        const references = await resolvedManualReferences(sql, context.newsroomId, input.references);
        if (references.some((reference) => reference.url.length > MANUAL_CLAIM_REFERENCE_URL_WARN)) {
          const warning = checkOverride(
            input,
            EVIDENCE_OVERRIDE_KEYS.manualClaimReferenceUrl,
            "A chosen captured record has an unusually long address. Save it anyway?",
          );
          if (warning) return warning;
          warnings.push(EVIDENCE_OVERRIDE_KEYS.manualClaimReferenceUrl);
        }
        const id = input.id ?? globalThis.crypto.randomUUID();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
          throw new ReviewError("invalid-input", "Invalid manual claim identifier.");
        const next: StoredManualClaim = { id, fact: input.fact, kind: input.kind, references };
        const index = manualClaims.findIndex((claim) => claim.id === id);
        if (index < 0) {
          if (manualClaims.length >= 16) {
            const warning = checkOverride(input, EVIDENCE_OVERRIDE_KEYS.manualClaimCount,
              "This draft already has 16 manual claims. Add another claim?");
            if (warning) return warning;
            warnings.push(EVIDENCE_OVERRIDE_KEYS.manualClaimCount);
          }
          manualClaims.push(next);
        } else {
          manualClaims[index] = next;
      }
      memo.manualClaims = { version: 1, rows: manualClaims } satisfies StoredManualClaims;
      if (input.id) {
        const claimReview = storedReview(draft, "claimEvidenceReview");
        if (claimReview.judgments) {
          delete claimReview.judgments[`manual-claim:${input.id}`];
          memo.claimEvidenceReview = claimReview;
        }
      }
      await sql.query(
        "update drafts set research_json=$1,updated_at=now() where id=$2 and newsroom_id=$3",
        [JSON.stringify(memo), draft.id, context.newsroomId],
      );
        return { warnings };
      }
      memo.manualClaims = { version: 1, rows: manualClaims } satisfies StoredManualClaims;
      await sql.query(
        "update drafts set research_json=$1,updated_at=now() where id=$2 and newsroom_id=$3",
        [JSON.stringify(memo), draft.id, context.newsroomId],
      );
      return { warnings: [] };
    });
    if (isOverrideWarning(outcome)) return outcome;
    if (outcome.warnings.length)
      await auditOverrides(
        { userId: context.userId ?? "", newsroomId: context.newsroomId },
        outcome.warnings,
        { kind: "draft", id: input.draftId },
      );
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
    override: cleanOverride(value.override),
    editorNote: typeof value.editorNote === "string" ? value.editorNote : "",
  };
}

/** The override keys a client sends back, kept to plain strings. */
function cleanOverride(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string") : [];
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
    override: cleanOverride(value.override),
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
        context.role,
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
      const result = await persistFindingEvidenceJudgment(context, data);
      return isOverrideWarning(result) ? result : { ok: true, review: result };
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
      const result = await persistManualClaim(context, data);
      return isOverrideWarning(result) ? result : { ok: true, review: result };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof ReviewError ? error.code : "invalid-input",
        error: error instanceof Error ? error.message : "Manual claim could not be saved.",
      };
    }
  });

