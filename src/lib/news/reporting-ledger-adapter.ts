import type { Sql } from "../db.ts";
import type { CoverageAction } from "./civic-reporting.ts";
import type { LedgerItem } from "./meeting-whole.ts";

/** Only an explicit recording clock is converted. Line ranges and unresolved clocks stay null. */
export function actionClockSeconds(raw: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match || Number(match[3]) > 59 || (match[1] !== undefined && Number(match[2]) > 59)) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Array position, not actionId, is the immutable identity: action IDs may repeat. */
export function reportingActionsToLedger(actions: CoverageAction[]): LedgerItem[] {
  return actions.map((action, index) => ({
    itemNo: index + 1,
    kind: /\b(procedural|procedure|routine|ceremonial)\b/i.test(`${action.policyStage} ${action.disposition}`)
      ? "procedural" : "reporting-action",
    text: action.motionOrAction,
    startSeconds: actionClockSeconds(action.timestamp), endSeconds: null, packetPage: null,
    status: "unread", reason: "", sourceExcerpt: "",
    voteResult: action.outcome, voteTally: action.vote, motions: [],
    evidence: [{ kind: "reporting-reference", text: action.evidence, who: "",
      startSeconds: actionClockSeconds(action.timestamp), packetPage: null, numbers: "",
      sourceExcerpt: "", agenda: action.agendaItem, reportingAction: action }],
  }));
}

/** Called during filing or the first explicit editorial save, never during a read. */
export async function persistReportingActionLedger(sql: Sql, input: {
  newsroomId: number; leadId: number; draftId: number; actions: CoverageAction[];
}): Promise<void> {
  for (const item of reportingActionsToLedger(input.actions)) {
    await sql.query(`insert into meeting_ledger_items
      (newsroom_id,lead_id,draft_id,item_no,kind,text,start_seconds,end_seconds,packet_page,status,reason,
       source_excerpt,vote_result,vote_tally,motions,evidence,impact)
      select $1,$2,$3,$4,$5,$6,$7,null,null,'unread','','',$8,$9,'[]'::jsonb,$10::jsonb,null
      where not exists (select 1 from meeting_ledger_items where newsroom_id=$1 and draft_id=$3 and item_no=$4)`,
      [input.newsroomId,input.leadId,input.draftId,item.itemNo,item.kind,item.text,item.startSeconds,
        item.voteResult,item.voteTally,JSON.stringify(item.evidence)]);
  }
}
