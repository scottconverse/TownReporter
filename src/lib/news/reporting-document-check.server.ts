import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import type { Sql } from "../db.ts";
import { parseReportingPackage, type PackageSource, type PackageStory } from "./civic-reporting.ts";
import { bindStoryClaimsToEvidence, buildStoryFromReply, type DocumentRead } from "./civic-reporting-run.server.ts";
import type { WholeRecord } from "./civic-reporting-meeting.server.ts";
import type { CurrentReportingDocumentCheck, CurrentReportingDocumentChecks } from "./reporting-document-check.ts";
import { reportingDocumentClaimIdentity } from "./reporting-document-check.ts";

const DOCUMENT_ONLY_RECORD: WholeRecord = {
  identity: { videoId: "", artifactId: null, title: "", date: null, videoUrl: "", source: "none", reason: "Document-only recheck" },
  segments: [], windows: [], agenda: [], votes: [], totalChars: 0, coverageLedger: "", gaps: [], complete: false,
};
const NO_MEETING_ACTIONS = { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 };

function sameSource(left: PackageSource, right: PackageSource) {
  return left.id === right.id && left.url === right.url && left.title === right.title &&
    left.tier === right.tier && left.locator === right.locator && left.offlineReference === right.offlineReference;
}

function unavailable(note: string, checkedAt: string, inputFingerprint: string): CurrentReportingDocumentCheck {
  return { state: "unavailable", status: null, note, references: [], checkedAt, inputFingerprint };
}

/** Uses only retained documents; no network, models, meeting reads, or writes. */
export function checkRetainedDocumentaryStory(input: {
  filed: PackageStory;
  accepted: PackageStory;
  documents: DocumentRead[];
  checkedAt?: string;
}): Record<string, CurrentReportingDocumentCheck> {
  const { filed, accepted, documents } = input;
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const inputFingerprint = createHash("sha256").update(JSON.stringify([filed, accepted, documents])).digest("hex");
  const result: Record<string, CurrentReportingDocumentCheck> = {};
  const exactStory = filed.id === accepted.id && filed.draft === accepted.draft &&
    filed.claims.length === accepted.claims.length && new Set(accepted.claims.map((claim) => claim.id)).size === accepted.claims.length &&
    filed.claims.every((claim) => accepted.claims.some((original) => original.id === claim.id && original.text === claim.text && (original.item ?? "") === (claim.item ?? "")));
  if (!exactStory) return Object.fromEntries(filed.claims.map((claim) => [claim.id,
    unavailable("The retained writer story does not exactly match this filed story and claim inventory.", checkedAt, inputFingerprint)]));
  const bound = bindStoryClaimsToEvidence(accepted, NO_MEETING_ACTIONS, DOCUMENT_ONLY_RECORD, documents);
  for (const claim of filed.claims) {
    const original = accepted.claims.find((row) => row.id === claim.id)!;
    const checked = bound.claims.find((row) => row.id === claim.id)!;
    const filedRefs = claim.sourceIds.map((id) => filed.sources.find((source) => source.id === id));
    const originalRefs = original.sourceIds.map((id) => accepted.sources.find((source) => source.id === id));
    const checkedRefs = checked.sourceIds.map((id) => bound.sources.find((source) => source.id === id));
    // Filing may replace combined locators with validator-produced precise
    // refs. Require an exact original or deterministic precise identity.
    const exactSources = filedRefs.length > 0 && filedRefs.every((ref) => ref &&
      [...originalRefs, ...checkedRefs].some((candidate) => candidate && sameSource(ref, candidate))) &&
      originalRefs.every((ref) => ref && filedRefs.some((candidate) => candidate && candidate.url === ref.url));
    if (!exactSources) {
      result[claim.id] = unavailable("The filed source identities or precise locators do not match the retained writer evidence.", checkedAt, inputFingerprint);
      continue;
    }
    const documentOnly = originalRefs.length > 0 && originalRefs.every((ref) => ref?.tier === "A" && ref.url &&
      documents.some((doc) => doc.ok && doc.url === ref.url)) &&
      !/\b(?:voted|approved|adopted|enacted|passed|motion|unanimous|tally)\b/i.test(claim.text);
    if (!documentOnly) {
      result[claim.id] = unavailable("This claim needs meeting or other evidence; the saved-document recheck does not certify it.", checkedAt, inputFingerprint);
      continue;
    }
    const resolved = checkedRefs.length > 0 && checkedRefs.every((ref) => ref &&
      !original.sourceIds.includes(ref.id) && documents.some((doc) => doc.ok && doc.url === ref.url));
    const status = claim.status === "CONTESTED" || original.status === "CONTESTED"
      ? "CONTESTED"
      : resolved && checked.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
    result[claim.id] = {
      state: "checked", status,
      note: status === "CONTESTED" ? "The recorded dispute remains; documentary matching does not resolve contrary evidence."
        : status === "VERIFIED" ? "The current validator binds this claim to the retained documentary references. This is separate from your evidence judgment."
          : checked.nextCheck || "Precise documentary support remains unresolved; no bulk upgrade was applied.",
      references: checkedRefs.filter((ref): ref is PackageSource => Boolean(ref)), checkedAt, inputFingerprint,
      filedClaimIdentity: reportingDocumentClaimIdentity(claim.id, claim.text, claim.item ?? "", filedRefs.filter((ref): ref is PackageSource => Boolean(ref))),
    };
  }
  return result;
}

function writerStories(text: string): PackageStory[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const parsed: unknown = JSON.parse(fenced);
  const rows = parsed && typeof parsed === "object" ? (parsed as { stories?: unknown }).stories : null;
  return Array.isArray(rows) ? rows.flatMap((row, index) => row && typeof row === "object"
    ? [buildStoryFromReply(row as Record<string, unknown>, index, "")] : []) : [];
}

export async function loadCurrentReportingDocumentChecks(
  sql: Sql, newsroomId: number, requestId: number,
): Promise<CurrentReportingDocumentChecks> {
  const [row] = await sql.query<{ package: unknown; workspace_dir: string }>(
    `select rp.package,rr.workspace_dir from reporting_packages rp
      join reporting_requests rr on rr.id=rp.request_id and rr.newsroom_id=rp.newsroom_id
      where rp.newsroom_id=$1 and rp.request_id=$2`, [newsroomId, requestId],
  );
  const pack = parseReportingPackage(row?.package);
  if (!pack) return {};
  const checkedAt = new Date().toISOString();
  const fail = (note: string): CurrentReportingDocumentChecks => Object.fromEntries(pack.stories.map((story) =>
    [story.id, Object.fromEntries(story.claims.map((claim) => [claim.id, unavailable(note, checkedAt, "")]))]));
  if (!row.workspace_dir || basename(row.workspace_dir) !== `request-${requestId}`)
    return fail("The exact retained workspace for this reporting request is unavailable.");
  try {
    const documents: DocumentRead[] = JSON.parse(await readFile(join(row.workspace_dir, "all-documents.json"), "utf8"));
    if (!Array.isArray(documents)) return fail("The retained documentary evidence cannot be read.");
    const candidates: PackageStory[] = [];
    for (const name of ["writer-length-revision.txt", "writer-citation-revision.txt", "writer-format-repair.txt", "writer-raw.txt"]) {
      try { candidates.push(...writerStories(await readFile(join(row.workspace_dir, name), "utf8"))); } catch { /* Absent or unsuccessful attempt, never an invented replacement. */ }
    }
    return Object.fromEntries(pack.stories.map((story) => {
      // Match the filed copy exactly; a superseded writer attempt cannot seed
      // upgrades for a later story that merely reused a claim id.
      const matches = candidates.filter((candidate) => candidate.id === story.id && candidate.draft === story.draft);
      const unique = new Map(matches.map((candidate) => [JSON.stringify(candidate), candidate]));
      const checks = unique.size === 1 ? checkRetainedDocumentaryStory({ filed: story, accepted: [...unique.values()][0], documents, checkedAt })
        : Object.fromEntries(story.claims.map((claim) => [claim.id, unavailable("A unique accepted writer story matching the filed copy is unavailable.", checkedAt, "")]));
      return [story.id, checks];
    }));
  } catch {
    return fail("The retained run documents are unavailable or unreadable; no model run or recapture was attempted.");
  }
}
