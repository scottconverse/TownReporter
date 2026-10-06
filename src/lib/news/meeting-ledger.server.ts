import { persistReportingActionLedger, reportingActionsToLedger } from "./reporting-ledger-adapter.ts";
import type { CoverageAction } from "./civic-reporting.ts";
import type { Sql } from "../db.ts";
import { storableText } from "./storable-text.ts";
import type { LedgerEvidence, LedgerItem, LedgerStatus, LedgerMotion, RunStats } from "./meeting-whole.ts";
import { parseImpactScore, type ImpactScore } from "./meeting-impact.ts";

/** jsonb arrives parsed on Neon and as a JSON string under PGLite; accept both. */
function parseEvidence(raw: unknown): LedgerEvidence[] {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      kind: String(entry.kind ?? ""),
      text: String(entry.text ?? ""),
      who: String(entry.who ?? ""),
      startSeconds: entry.startSeconds === null || entry.startSeconds === undefined
        ? null
        : Number(entry.startSeconds),
      packetPage: entry.packetPage === null || entry.packetPage === undefined
        ? null
        : Number(entry.packetPage),
      numbers: String(entry.numbers ?? ""),
      sourceExcerpt: String(entry.sourceExcerpt ?? ""),
      agenda: String(entry.agenda ?? ""),
      ...(entry.reportingAction ? { reportingAction: entry.reportingAction as CoverageAction } : {}),
    }));
}

/** The votes a ledger item holds, read from the `motions` jsonb column. */
function parseMotions(raw: unknown): LedgerMotion[] {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      result: String(entry.result ?? ""),
      tally: String(entry.tally ?? ""),
      unanimous: String(entry.unanimous ?? ""),
      seconds: entry.seconds === null || entry.seconds === undefined ? null : Number(entry.seconds),
      ...(entry.kind === "procedural" || entry.kind === "decision" ? { kind: entry.kind } : {}),
    }));
}

/** The editor's impact score, read from the `impact` jsonb column. Returns null
 * when the item was never scored or the stored score is missing/invalid, so an
 * unscored item stays unranked -- never a fabricated zero. */
function parseImpact(raw: unknown): ImpactScore | null {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  return parseImpactScore(value);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The reading half of WR1's screens: the accounting a whole-meeting run left on
 * a lead, and the two writes an editor makes against it.
 *
 * The pipeline (`meeting-whole.server.ts`) writes these rows once, at draft
 * time. Everything here is what happens AFTER -- an editor reads the ledger,
 * changes a status, marks a claim checked -- plus the read that feeds the story
 * page's Meeting ledger panel. Split out so the writes can be driven against a
 * migrated PGlite with no model and no network.
 *
 * Every write is scoped by `newsroom_id` and answers with the row count it
 * touched: a draft id or claim id from another newsroom matches nothing, so the
 * write is refused rather than silently landing in the caller's newsroom.
 */

/** The statuses an editor may set. `unread` is not one: it means "not read", and
 * the panel offers only the three decisions the editor actually makes. */
export const EDITOR_LEDGER_STATUSES: LedgerStatus[] = ["lead", "roundup", "excluded"];

export type LedgerItemRow = {
  id: number;
  draftId: number;
  itemNo: number;
  kind: string;
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
  packetPage: number | null;
  status: LedgerStatus;
  reason: string;
  /** The result phrase the tape recorded for this item, or "". */
  voteResult: string;
  /** The tally the tape recorded, normalized "N-N", or "". */
  voteTally: string;
  /** Every vote result the tape recorded under this item, in tape order. */
  motions: LedgerMotionRow[];
  /** Every raw inventory entry this item grouped, so the panel can show them. */
  evidence: LedgerEvidence[];
  /** The model's explained resident-impact score, or null when it was never
   * scored (or the stored score was invalid). Null means unranked. */
  impact: ImpactScore | null;
  reporting?: ReportingLedgerPin;
};

/** One recorded vote under a ledger item: its result, tally and moment. */
export type LedgerMotionRow = {
  result: string;
  tally: string;
  unanimous: string;
  seconds: number | null;
  kind?: "decision" | "procedural";
};

export type ClaimRow = {
  id: number;
  draftId: number;
  claim: string;
  sourceKind: string;
  sourceRef: string;
  checkStatus: "found" | "flagged";
  note: string;
  /** When an editor marked this checked, or null for not yet reviewed. */
  reviewedAt: string | null;
};

export type MeetingAccounting = {
  /** The draft the accounting belongs to, or null when this lead has none. */
  draftId: number | null;
  /** Every ledger item, unread rows first, then in the order the run numbered them. */
  ledger: LedgerItemRow[];
  /** Every checked claim, flagged rows first. */
  claims: ClaimRow[];
  /** The run's check results and cold-check mismatches, uncapped. */
  meetingNotes: string;
  runStats: RunStats | null;
};

/**
 * The accounting for the most recent draft of this lead that has ledger rows --
 * the run the panel describes. A lead whose draft predates WR1 has none, and
 * the panel is hidden rather than shown empty.
 */
export async function loadMeetingAccounting(
  sql: Sql,
  input: { newsroomId: number; leadId: number },
): Promise<MeetingAccounting> {
  const reporting = await loadReportingLedgerBinding(sql, input);
  const latest = await sql.query<{ draft_id: number }>(
    `select draft_id from meeting_ledger_items
      where newsroom_id=$1 and lead_id=$2 order by draft_id desc limit 1`,
    [input.newsroomId, input.leadId],
  );
  const draftId = reporting?.draftId ?? (latest[0] ? Number(latest[0].draft_id) : null);
  if (draftId === null) {
    return { draftId: null, ledger: [], claims: [], meetingNotes: "", runStats: null };
  }

  const ledgerRows = await sql.query<{
    id: number;
    draft_id: number;
    item_no: number;
    kind: string;
    text: string;
    start_seconds: number | string | null;
    end_seconds: number | string | null;
    packet_page: number | null;
    status: string;
    reason: string | null;
    vote_result: string | null;
    vote_tally: string | null;
    motions: unknown;
    evidence: unknown;
    impact: unknown;
  }>(
    // Unread first: the part of the tape nobody read is the part the editor most
    // needs to see, so it sorts above the decisions that are already made.
    `select id,draft_id,item_no,kind,text,start_seconds,end_seconds,packet_page,status,reason,
            vote_result,vote_tally,motions,evidence,impact
       from meeting_ledger_items where newsroom_id=$1 and draft_id=$2
      order by (status='unread') desc, item_no, id`,
    [input.newsroomId, draftId],
  );
  const claimRows = await sql.query<{
    id: number;
    draft_id: number;
    claim: string;
    source_kind: string;
    source_ref: string;
    check_status: string;
    note: string | null;
    reviewed_at: string | Date | null;
  }>(
    // Flagged first: a flagged claim is the one an editor has to look at.
    `select id,draft_id,claim,source_kind,source_ref,check_status,note,reviewed_at
       from draft_claims where newsroom_id=$1 and draft_id=$2
      order by (check_status='flagged') desc, id`,
    [input.newsroomId, draftId],
  );
  const draft = await sql.query<{ meeting_notes: string | null; run_stats: unknown }>(
    `select meeting_notes,run_stats from drafts where id=$1 and newsroom_id=$2`,
    [draftId, input.newsroomId],
  );

  return {
    draftId,
    ledger: ledgerRows.length ? ledgerRows.map((row) => ({
      id: Number(row.id),
      draftId: Number(row.draft_id),
      itemNo: Number(row.item_no),
      kind: row.kind,
      text: row.text,
      startSeconds: row.start_seconds === null ? null : Number(row.start_seconds),
      endSeconds: row.end_seconds === null ? null : Number(row.end_seconds),
      packetPage: row.packet_page === null ? null : Number(row.packet_page),
      status: row.status as LedgerStatus,
      reason: row.reason ?? "",
      voteResult: row.vote_result ?? "",
      voteTally: row.vote_tally ?? "",
      motions: parseMotions(row.motions),
      evidence: parseEvidence(row.evidence),
      impact: parseImpact(row.impact),
      ...(reporting ? { reporting: { ...reporting.pin, actionIndex: Number(row.item_no) - 1, actionId: reporting.actions[Number(row.item_no) - 1]?.actionId ?? "", actionSnapshot: JSON.stringify(reporting.actions[Number(row.item_no) - 1]) } } : {}),
    })) : reporting ? reportingActionsToLedger(reporting.actions).map((item, actionIndex) => ({
      ...item, id: -(actionIndex + 1), draftId, endSeconds: null, motions: [], impact: null,
      evidence: item.evidence ?? [], voteResult: item.voteResult ?? "", voteTally: item.voteTally ?? "",
      reporting: { ...reporting.pin, actionIndex, actionId: reporting.actions[actionIndex].actionId, actionSnapshot: JSON.stringify(reporting.actions[actionIndex]) },
    })) : [],
    claims: claimRows.map((row) => ({
      id: Number(row.id),
      draftId: Number(row.draft_id),
      claim: row.claim,
      sourceKind: row.source_kind,
      sourceRef: row.source_ref,
      checkStatus: row.check_status === "flagged" ? "flagged" : "found",
      note: row.note ?? "",
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    })),
    meetingNotes: draft[0]?.meeting_notes ?? "",
    runStats: parseRunStats(draft[0]?.run_stats),
  };
}

/**
 * The stored ledger for a rewrite, in the writer's own shape, carrying the
 * editor's statuses. Read from the latest ledgered draft of the lead -- the same
 * one the panel shows -- so "Rewrite from ledger" rewrites what the editor saw.
 */
export async function loadStoredLedgerForRewrite(
  sql: Sql,
  input: { newsroomId: number; leadId: number },
): Promise<LedgerItem[]> {
  const latest = await sql.query<{ draft_id: number }>(
    `select draft_id from meeting_ledger_items
      where newsroom_id=$1 and lead_id=$2 order by draft_id desc limit 1`,
    [input.newsroomId, input.leadId],
  );
  if (!latest[0]) return [];
  const rows = await sql.query<{
    item_no: number;
    kind: string;
    text: string;
    start_seconds: number | string | null;
    end_seconds: number | string | null;
    packet_page: number | null;
    status: string;
    reason: string | null;
    source_excerpt: string | null;
    vote_result: string | null;
    vote_tally: string | null;
    motions: unknown;
    evidence: unknown;
    impact: unknown;
  }>(
    `select item_no,kind,text,start_seconds,end_seconds,packet_page,status,reason,source_excerpt,
            vote_result,vote_tally,motions,evidence,impact
       from meeting_ledger_items where newsroom_id=$1 and draft_id=$2 order by item_no, id`,
    [input.newsroomId, Number(latest[0].draft_id)],
  );
  return rows.map((row) => ({
    itemNo: Number(row.item_no),
    kind: row.kind,
    text: row.text,
    startSeconds: row.start_seconds === null ? null : Number(row.start_seconds),
    endSeconds: row.end_seconds === null ? null : Number(row.end_seconds),
    packetPage: row.packet_page === null ? null : Number(row.packet_page),
    status: row.status as LedgerStatus,
    reason: row.reason ?? "",
    sourceExcerpt: row.source_excerpt ?? "",
    voteResult: row.vote_result ?? "",
    voteTally: row.vote_tally ?? "",
    motions: parseMotions(row.motions),
    evidence: parseEvidence(row.evidence),
    ...(parseImpact(row.impact) ? { impact: parseImpact(row.impact)! } : {}),
  }));
}

export type ReportingLedgerPin = {
  packageId: number; requestId: number; storyId: string; actionIndex: number; actionId: string; actionSnapshot: string;
};

function sameSnapshot(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => [key,canonical(entry)])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function jsonRecord(raw: unknown): Record<string, unknown> | null {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Exact saved draft/request/story binding. No newest-package fallback and no writes. */
async function loadReportingLedgerBinding(sql: Sql, input: { newsroomId: number; leadId: number }, lock = false) {
  const [draft] = await sql.query<{ id: number; research_json: unknown }>(
    `select id,research_json from drafts where newsroom_id=$1 and lead_id=$2
     order by updated_at desc,id desc limit 1${lock ? " for update" : ""}`, [input.newsroomId,input.leadId]);
  if (!draft) return null;
  const research = jsonRecord(draft.research_json);
  if (research?.civicReporting !== true || !Number.isSafeInteger(Number(research.requestId)) || typeof research.storyId !== "string") return null;
  const [row] = await sql.query<{ id: number; package: unknown }>(
    `select p.id,p.package from reporting_packages p join reporting_requests r
       on r.id=p.request_id and r.newsroom_id=p.newsroom_id
     where p.newsroom_id=$1 and p.request_id=$2`, [input.newsroomId,Number(research.requestId)]);
  const pkg = jsonRecord(row?.package);
  if (!row || !pkg || !Array.isArray(pkg.stories) || !pkg.stories.some((story) => jsonRecord(story)?.id === research.storyId)
      || !Array.isArray(pkg.actions)) return null;
  const fields = ["actionId","timestamp","agendaItem","motionOrAction","outcome","vote","policyStage","evidence","disposition"];
  if (!pkg.actions.every((action) => { const value = jsonRecord(action); return value && fields.every((key) => typeof value[key] === "string"); })) return null;
  if (research.reportedActions !== undefined && !sameSnapshot(research.reportedActions, pkg.actions)) return null;
  return { draftId: Number(draft.id), actions: pkg.actions as CoverageAction[],
    pin: { packageId: Number(row.id),requestId: Number(research.requestId),storyId: research.storyId } };
}

/** Materialize historical actions only on an editor's explicit save, in the endpoint transaction. */
export async function saveReportingLedgerItemStatus(sql: Sql, input: {
  newsroomId: number; draftId: number; itemNo: number; rowId?: number; reporting: ReportingLedgerPin;
  status: LedgerStatus; reason: string;
}): Promise<LedgerStatusSaveResult> {
  if (!EDITOR_LEDGER_STATUSES.includes(input.status)) return { ok: false, error: "That status is not one an editor can set." };
  const reason = storableText(input.reason ?? "").trim();
  if (input.status === "excluded" && !reason) return { ok: false, error: "A reason is required before an item can be excluded." };
  const [draft] = await sql.query<{ lead_id: number }>(`select lead_id from drafts where id=$1 and newsroom_id=$2`,[input.draftId,input.newsroomId]);
  if (!draft) return { ok: false, error: "That draft is not in this newsroom." };
  // Serialize first-save materialization and guard against a replacement draft.
  const [lead] = await sql.query<{ status: string }>(`select status from leads where id=$1 and newsroom_id=$2 for update`,[draft.lead_id,input.newsroomId]);
  if (!lead || lead.status === "published") return { ok: false,error: "This story is published or unavailable, so its ledger is read-only." };
  const binding = await loadReportingLedgerBinding(sql,{ newsroomId: input.newsroomId, leadId: Number(draft.lead_id) },true);
  const pin = input.reporting;
  if (!binding || binding.draftId !== input.draftId || binding.pin.packageId !== pin.packageId
    || binding.pin.requestId !== pin.requestId || binding.pin.storyId !== pin.storyId
    || !Number.isInteger(pin.actionIndex) || pin.actionIndex < 0 || input.itemNo !== pin.actionIndex + 1
    || binding.actions[pin.actionIndex]?.actionId !== pin.actionId
    || !sameSnapshot(safeParse(pin.actionSnapshot), binding.actions[pin.actionIndex]))
    return { ok: false,error: "The reporting draft or package changed. Reload before saving." };
  const existing = await sql.query<{ id: number; evidence: unknown }>(
    `select id,evidence from meeting_ledger_items where newsroom_id=$1 and draft_id=$2 and item_no=$3`,
    [input.newsroomId,input.draftId,input.itemNo]);
  if (existing.length > 1) return { ok: false,error: "The saved action is ambiguous. Reload before saving." };
  if (existing[0] && (input.rowId && input.rowId > 0 && Number(existing[0].id) !== input.rowId
    || !sameSnapshot(parseEvidence(existing[0].evidence)[0]?.reportingAction, binding.actions[pin.actionIndex])))
    return { ok: false,error: "The saved action changed. Reload before saving." };
  if (!existing.length) await persistReportingActionLedger(sql,{ newsroomId: input.newsroomId,leadId: Number(draft.lead_id),draftId: input.draftId,actions: binding.actions });
  const [item] = await sql.query<{ id: number }>(`select id from meeting_ledger_items where newsroom_id=$1 and draft_id=$2 and item_no=$3`,[input.newsroomId,input.draftId,input.itemNo]);
  if (!item) return { ok: false,error: "The reporting action is unavailable." };
  await sql.query(`update meeting_ledger_items set status=$1,reason=$2 where newsroom_id=$3 and draft_id=$4 and id=$5`,[input.status,reason,input.newsroomId,input.draftId,item.id]);
  return { ok: true };
}

export type LedgerStatusSaveResult = { ok: true } | { ok: false; error: string };

/**
 * Set one ledger item's status. `excluded` is a decision to leave something out
 * of the story, so it will not save without a reason -- the note explains to the
 * next reader why the meeting's own record is not in the draft.
 */
export async function saveLedgerItemStatus(
  sql: Sql,
  input: { newsroomId: number; draftId: number; itemNo: number; status: LedgerStatus; reason: string },
): Promise<LedgerStatusSaveResult> {
  if (!EDITOR_LEDGER_STATUSES.includes(input.status)) {
    return { ok: false, error: "That status is not one an editor can set." };
  }
  const reason = storableText(input.reason ?? "").trim();
  if (input.status === "excluded" && !reason) {
    return { ok: false, error: "A reason is required before an item can be excluded." };
  }
  const [draft] = await sql.query<{ research_json: unknown }>(`select research_json from drafts where newsroom_id=$1 and id=$2`,[input.newsroomId,input.draftId]);
  if (jsonRecord(draft?.research_json)?.civicReporting === true) return { ok: false,error: "Reload the reporting action before saving its editorial treatment." };
  const updated = await sql.query<{ id: number }>(
    `update meeting_ledger_items set status=$1, reason=$2
      where newsroom_id=$3 and draft_id=$4 and item_no=$5 returning id`,
    [input.status, reason, input.newsroomId, input.draftId, input.itemNo],
  );
  if (!updated.length) return { ok: false, error: "That ledger item is not in this newsroom." };
  return { ok: true };
}

/**
 * Mark a checked claim reviewed, or clear the mark. The presence of the
 * timestamp is the mark; clearing it sets the column back to NULL.
 */
export async function markClaimReviewed(
  sql: Sql,
  input: { newsroomId: number; claimId: number; reviewed: boolean },
): Promise<LedgerStatusSaveResult> {
  const updated = await sql.query<{ id: number }>(
    `update draft_claims set reviewed_at=$1 where newsroom_id=$2 and id=$3 returning id`,
    [input.reviewed ? new Date().toISOString() : null, input.newsroomId, input.claimId],
  );
  if (!updated.length) return { ok: false, error: "That claim is not in this newsroom." };
  return { ok: true };
}

function parseRunStats(raw: unknown): RunStats | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const number = (key: string): number => {
    const value = Number(record[key]);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    wallMs: number("wallMs"),
    modelCalls: number("modelCalls"),
    inputTokens: number("inputTokens"),
    outputTokens: number("outputTokens"),
  };
}
