import type { Sql } from "../db.ts";
import { storableText } from "./storable-text.ts";
import type { LedgerEvidence, LedgerItem, LedgerStatus, RunStats } from "./meeting-whole.ts";

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
    }));
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
  /** Every raw inventory entry this item grouped, so the panel can show them. */
  evidence: LedgerEvidence[];
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
  const latest = await sql.query<{ draft_id: number }>(
    `select draft_id from meeting_ledger_items
      where newsroom_id=$1 and lead_id=$2 order by draft_id desc limit 1`,
    [input.newsroomId, input.leadId],
  );
  const draftId = latest[0] ? Number(latest[0].draft_id) : null;
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
    evidence: unknown;
  }>(
    // Unread first: the part of the tape nobody read is the part the editor most
    // needs to see, so it sorts above the decisions that are already made.
    `select id,draft_id,item_no,kind,text,start_seconds,end_seconds,packet_page,status,reason,
            vote_result,vote_tally,evidence
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
    ledger: ledgerRows.map((row) => ({
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
      evidence: parseEvidence(row.evidence),
    })),
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
    evidence: unknown;
  }>(
    `select item_no,kind,text,start_seconds,end_seconds,packet_page,status,reason,source_excerpt,
            vote_result,vote_tally,evidence
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
    evidence: parseEvidence(row.evidence),
  }));
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
