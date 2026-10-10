import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { saveDailyCapForEditor, planDailySourceRotation, cleanDailyScanPolicyInput, persistDailyScanPolicy } from "./daily-scan.ts";
import { commitDraftBatchForAuthenticatedEditor } from "./draft-batch.server.ts";
import { runManualMeetingForEditor } from "./meeting-policy.server.ts";
import { runMeetingAwareness } from "./meeting-capture.ts";
import type { Sql } from "../db.ts";
import { enqueueJob } from "./jobs.ts";

const context = { userId: "remaining-editor", newsroomId: 1, role: "owner" as const };
async function audited(key: string) {
  const rows = await (await getSql()).query<{detail:string;created_at:unknown}>("select detail,created_at from audit_events where user_id=$1 and action='override'", [context.userId]);
  assert.ok(rows.some(r => JSON.parse(r.detail).key === key && JSON.parse(r.detail).target && r.created_at));
}
it("daily limit warns then saves 13 and the planner uses the approved budget", async () => {
  const data = cleanDailyScanPolicyInput({ enabled:false,localTime:"08:00",runtime:"auto",sourceCap:13,everyDaySourceCount:0,selectedSourceIds:[],expectedRevision:0 });
  const save = () => persistDailyScanPolicy(awaitSql,1,context.userId,data,[]);
  const awaitSql = await getSql();
  const first = await saveDailyCapForEditor(context,data,save);
  assert.equal(first.ok,false); assert.equal("warning" in first && first.warning.key,"daily-source-cap");
  const approved = await saveDailyCapForEditor(context,{...data,override:["daily-source-cap"]},save);
  assert.equal(approved.ok,true);
  const [row] = await awaitSql.query<{source_cap:number}>("select source_cap from daily_scan_policies where newsroom_id=1");
  assert.equal(row.source_cap,13); await audited("daily-source-cap");
  assert.equal(planDailySourceRotation({ facts:[], selectedSourceIds:[],cap:13 }).budget,13);
});
it("six batch leads warn then all six queue with an audit; missing records still refuse", async () => {
  const sql = await getSql();
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,1,'editor')",[context.userId]);
  const items = [];
  for(let i=0;i<6;i++) { const [r] = await sql.query<{id:number}>("insert into leads(user_id,headline,why,newsroom_id) values($1,'A batch fixture lead','Why this matters',1) returning id",[context.userId]); items.push({leadId:r.id}); }
  const input = {context,items,runtimeSnapshot:{runtime:"claude-sonnet",modelChoice:"claude-sonnet",model:"fixture",transport:"claude-code"}};
  const first = await commitDraftBatchForAuthenticatedEditor(input,{kick:false,accountRate:false});
  assert.equal("warning" in first && first.warning?.key,"draft-batch-size");
  const result = await commitDraftBatchForAuthenticatedEditor({...input,override:["draft-batch-size"]},{kick:false,accountRate:false});
  assert.equal(result.ok,true); if(result.ok) assert.equal(result.batch.items.length,6);
  await audited("draft-batch-size");
  const empty = await commitDraftBatchForAuthenticatedEditor({...input,items:[]},{kick:false,accountRate:false});
  assert.equal("warning" in empty && empty.warning?.key,"draft-batch-size");
  const approvedEmpty = await commitDraftBatchForAuthenticatedEditor({...input,items:[],override:["draft-batch-size"]},{kick:false,accountRate:false});
  assert.equal(approvedEmpty.ok,true); if(approvedEmpty.ok) assert.equal(approvedEmpty.batch.items.length,0);
  const missing = await commitDraftBatchForAuthenticatedEditor({...input,items:[{leadId:2147483000}],override:["draft-batch-size"]},{kick:false,accountRate:false});
  assert.equal(missing.ok,false);
});
it("batch drafting a killed lead requires an audited override and carries the worker receipt", async () => {
  const sql = await getSql();
  const [lead] = await sql.query<{id:number}>("insert into leads(user_id,headline,why,newsroom_id,status) values($1,'A killed batch lead','Why it matters',1,'killed') returning id", [context.userId]);
  const input = {context,items:[{leadId:lead.id}],runtimeSnapshot:{runtime:"claude-sonnet",modelChoice:"claude-sonnet",model:"fixture",transport:"claude-code"}};
  const first = await commitDraftBatchForAuthenticatedEditor(input,{kick:false,accountRate:false});
  assert.equal("warning" in first && first.warning?.key,"lead-killed-draft");
  const approved = await commitDraftBatchForAuthenticatedEditor({...input,override:["lead-killed-draft"]},{kick:false,accountRate:false});
  assert.equal(approved.ok,true);
  const [job] = await sql.query<{result_json:string}>("select result_json from desk_jobs where subject_id=$1 and kind='draft' and status='queued'",[lead.id]);
  assert.equal(JSON.parse(job.result_json).allowKilledLead,true); await audited("lead-killed-draft");
});
it("batch model changes warn before cancelling, then clear the old lease; identical jobs stay hard", async () => {
  const sql = await getSql();
  const [lead] = await sql.query<{id:number}>("insert into leads(user_id,headline,why,newsroom_id) values($1,'A restarting batch lead','Why it matters',1) returning id",[context.userId]);
  const old = await enqueueJob({userId:context.userId,newsroomId:1,kind:"draft",subjectId:lead.id,modelChoice:"codex-frontier",kick:false});
  await sql.query("update desk_jobs set claim_token='old-batch-lease' where id=$1",[old.id]);
  const input = {context,items:[{leadId:lead.id}],runtimeSnapshot:{runtime:"claude-sonnet",modelChoice:"claude-sonnet",model:"fixture",transport:"claude-code"}};
  const first = await commitDraftBatchForAuthenticatedEditor(input,{kick:false,accountRate:false});
  assert.equal("warning" in first && first.warning?.key,"model-change-running");
  const [before] = await sql.query<{status:string}>("select status from desk_jobs where id=$1",[old.id]); assert.equal(before.status,"queued");
  const result = await commitDraftBatchForAuthenticatedEditor({...input,override:["model-change-running"]},{kick:false,accountRate:false}); assert.equal(result.ok,true);
  const [after] = await sql.query<{status:string;claim_token:string|null;cancel_requested:boolean}>("select status,claim_token,cancel_requested from desk_jobs where id=$1",[old.id]);
  assert.equal(after.status,"failed"); assert.equal(after.claim_token,null); assert.equal(after.cancel_requested,true); await audited("model-change-running");
  const identical = await commitDraftBatchForAuthenticatedEditor({...input,override:["model-change-running"]},{kick:false,accountRate:false}); assert.equal(identical.ok,false); assert.equal("warning" in identical,false);
});
it("owner can run disabled meeting capture once; editors cannot and running passes remain hard", async () => {
  const sql = await getSql();
  await sql.query("insert into meeting_capture_settings(newsroom_id,enabled) values(1,false) on conflict(newsroom_id) do update set enabled=false");
  let runs=0;
  const work=async(forceEnabled:boolean)=>{ assert.equal(forceEnabled,true); runs++; return {ok:true as const}; };
  const first=await runManualMeetingForEditor(context,undefined,false,work);
  assert.equal("warning" in first && first.warning.key,"meeting-capture-disabled"); assert.equal(runs,0);
  const result=await runManualMeetingForEditor(context,["meeting-capture-disabled"],false,work);
  assert.equal(result.ok,true); assert.equal(runs,1); await audited("meeting-capture-disabled");
  const [settings]=await sql.query<{enabled:boolean}>("select enabled from meeting_capture_settings where newsroom_id=1"); assert.equal(settings.enabled,false);
  assert.equal((await runManualMeetingForEditor({...context,role:"editor"},["meeting-capture-disabled"],false,work)).ok,false);
  assert.equal((await runManualMeetingForEditor(context,["meeting-capture-disabled"],true,work)).ok,false);
});
it("the real capture engine respects the saved switch and honors only the one-run force flag", async () => {
  let listed=0;
  const sql=(async()=>[]) as unknown as Sql;
  sql.query=async <T>(text:string)=>{
    if (/select enabled/.test(text)) return [{enabled:false}] as T[];
    if (/from meeting_channel_priority/.test(text)) return [{channel_url:"https://youtube.com/@fixture",position:0}] as T[];
    return [] as T[];
  };
  const deps={listChannelVideos:async()=>{listed++;return [];},scheduleYoutubeRetry:()=>{}};
  await runMeetingAwareness(sql,88091,deps);assert.equal(listed,0);
  await runMeetingAwareness(sql,88091,{...deps,forceEnabled:true});assert.ok(listed>0);
});
