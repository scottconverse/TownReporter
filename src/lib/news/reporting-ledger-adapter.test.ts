import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { reportingActionsToLedger, actionClockSeconds, persistReportingActionLedger } from "./reporting-ledger-adapter.ts";
import { loadMeetingAccounting, saveLedgerItemStatus, saveReportingLedgerItemStatus } from "./meeting-ledger.server.ts";
import type { CoverageAction } from "./civic-reporting.ts";

const actions: CoverageAction[] = [
  { actionId: "duplicate",timestamp: "unknown",agendaItem: "7",motionOrAction: "Withdraw fee motion",outcome: "withdrawn",vote: "unverified",policyStage: "first reading",evidence: "https://example.test/record section 7",disposition: "held" },
  { actionId: "duplicate",timestamp: "01:02:03",agendaItem: "8",motionOrAction: "Extend meeting",outcome: "carried",vote: "6-1",policyStage: "procedural",evidence: "https://example.test/record 01:02:03",disposition: "procedural" },
];

it("preserves raw actions with independent editorial treatment and no invented motions or scores", () => {
  const ledger = reportingActionsToLedger(actions);
  assert.deepEqual(ledger.map((row) => row.itemNo), [1,2]);
  assert.deepEqual(ledger.map((row) => row.status), ["unread","unread"]);
  assert.equal(ledger[0].startSeconds,null);
  assert.equal(ledger[1].startSeconds,3723);
  assert.equal(ledger[0].kind,"reporting-action");
  assert.equal(ledger[1].kind,"procedural");
  assert.equal(ledger[0].sourceExcerpt,"");
  assert.deepEqual(ledger[0].motions,[]);
  assert.deepEqual(ledger[0].evidence?.[0].reportingAction,actions[0]);
  assert.equal(actionClockSeconds("lines 5-20"),null);
  assert.equal(actionClockSeconds("01:99:00"),null);
});

await applyMigrationsToTestPglite();

describe("reporting actions in existing WR1 ledger", () => {
  it("hydrates exact historical package without writes; saves by immutable index then reloads row ID", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms(id,name) values(983,'Reporting ledger room')`);
    const [lead] = await sql.query<{id:number}>(`insert into leads(user_id,newsroom_id,headline,why,topic,source_urls) values('ledger-editor',983,'Council','why','council','[]') returning id`);
    const [request] = await sql.query<{id:number}>(`insert into reporting_requests(user_id,newsroom_id,lead_id,method_version) values('ledger-editor',983,$1,'2.6.0') returning id`,[lead.id]);
    const [draft] = await sql.query<{id:number}>(`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,research_json) values('ledger-editor',983,$1,'Council','','body','council',$2) returning id`,[lead.id,JSON.stringify({civicReporting:true,requestId:Number(request.id),storyId:'story'})]);
    await sql.query(`insert into reporting_packages(newsroom_id,request_id,lead_id,draft_id,package) values(983,$1,$2,$3,$4::jsonb)`,[request.id,lead.id,draft.id,JSON.stringify({stories:[{id:'story'}],actions})]);
    const read = await loadMeetingAccounting(sql,{newsroomId:983,leadId:Number(lead.id)});
    assert.equal(read.draftId,Number(draft.id));
    assert.equal(read.ledger.length,2);
    assert.equal(read.ledger[0].id,-1);
    assert.deepEqual(read.ledger[0].evidence[0].reportingAction,actions[0]);
    const [{count}] = await sql.query<{count:number}>(`select count(*) as count from meeting_ledger_items where draft_id=$1`,[draft.id]);
    assert.equal(Number(count),0,"read must not materialize historical rows");
    const input = {newsroomId:983,draftId:Number(draft.id),itemNo:2,rowId:-2,reporting:read.ledger[1].reporting!,status:'roundup' as const,reason:'procedure belongs in roundup'};
    assert.equal((await saveReportingLedgerItemStatus(sql,{...input,reporting:{...input.reporting,actionId:'wrong'}})).ok,false);
    assert.equal((await saveReportingLedgerItemStatus(sql,{...input,newsroomId:984})).ok,false);
    assert.deepEqual(await saveReportingLedgerItemStatus(sql,input),{ok:true});
    const saved = await loadMeetingAccounting(sql,{newsroomId:983,leadId:Number(lead.id)});
    assert.equal(saved.ledger.find((row) => row.itemNo === 1)?.status,'unread');
    const second = saved.ledger.find((row) => row.itemNo === 2)!;
    assert.equal(second.status,'roundup');
    assert.ok(second.id > 0);
    assert.equal(second.voteTally,'6-1');
    assert.equal(second.evidence[0].reportingAction?.disposition,'procedural');
    assert.deepEqual(await saveReportingLedgerItemStatus(sql,{...input,rowId:second.id,status:'lead'}),{ok:true});
    assert.equal((await saveReportingLedgerItemStatus(sql,{...input,rowId:second.id+100,status:'lead'})).ok,false);
    assert.equal((await saveLedgerItemStatus(sql,{ newsroomId:983,draftId:Number(draft.id),itemNo:2,status:'lead',reason:'' })).ok,false,'omitting the reporting pin cannot bypass stale guards');
    assert.equal((await saveReportingLedgerItemStatus(sql,{...input,reporting:{...input.reporting,packageId:input.reporting.packageId+100}})).ok,false);
    assert.equal((await saveReportingLedgerItemStatus(sql,{...input,reporting:{...input.reporting,actionSnapshot:JSON.stringify({...actions[1],outcome:'different'})}})).ok,false,'same ID with changed action content is stale');
    await sql.query(`update leads set status='published' where id=$1`,[lead.id]);
    assert.equal((await saveReportingLedgerItemStatus(sql,input)).ok,false,'published story must be read-only');
    await sql.query(`update leads set status='drafted' where id=$1`,[lead.id]);
    await sql.query(`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic) values('ledger-editor',983,$1,'New','','new body','council')`,[lead.id]);
    assert.equal((await saveReportingLedgerItemStatus(sql,{...input,rowId:second.id})).ok,false,'superseded draft must refuse saves');
  });
  it("persists a new filing snapshot into the same ledger schema without fabricated facts", async () => {
    const sql = await getSql();
    const [lead] = await sql.query<{id:number}>(`insert into leads(user_id,newsroom_id,headline,why,topic,source_urls) values('ledger-editor',983,'New filing','why','council','[]') returning id`);
    const [draft] = await sql.query<{id:number}>(`insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic) values('ledger-editor',983,$1,'New','','body','council') returning id`,[lead.id]);
    await persistReportingActionLedger(sql,{newsroomId:983,leadId:Number(lead.id),draftId:Number(draft.id),actions});
    const read = await loadMeetingAccounting(sql,{newsroomId:983,leadId:Number(lead.id)});
    assert.equal(read.ledger.length,2);
    assert.equal(read.ledger[0].startSeconds,null);
    assert.equal(read.ledger[0].impact,null);
    assert.deepEqual(read.ledger[0].motions,[]);
    assert.deepEqual(read.ledger[0].evidence[0].reportingAction,actions[0]);
  });
});
