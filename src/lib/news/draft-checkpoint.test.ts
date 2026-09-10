import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let withClaimedLeadDraftCheckpointLock: typeof import("./draft-order.server.ts").withClaimedLeadDraftCheckpointLock;

before(async () => {
  vite=await createServer({configFile:false,cacheDir:join(tmpdir(),`townreporter-draft-checkpoint-${process.pid}`),server:{middlewareMode:true,hmr:{port:0}},resolve:{alias:{"@":join(process.cwd(),"src")}}});
  ({getSql}=await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ensureJobsSchema}=await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({performDraftWork}=await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({withClaimedLeadDraftCheckpointLock}=await vite.ssrLoadModule("/src/lib/news/draft-order.server.ts"));
});
after(async()=>vite?.close());

test("persists a writer checkpoint without completing the job when later reporting fails", async()=>{
  await ensureJobsSchema();
  const sql=await getSql(), room=88401, user="checkpoint-editor";
  await sql.query("insert into newsrooms(id,name) values($1,'Checkpoint room') on conflict(id) do nothing",[room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')",[user,room]);
  const [lead]=await sql.query<{id:number}>("insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Checkpoint lead','Why','council','new','[]','',1,'{}') returning id",[user,room]);
  await sql.query("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls) values($1,$2,$3,'Earlier saved draft','','Original saved data','council','[]')",[user,room,lead.id]);
  const [jobRow]=await sql.query<{id:number}>("insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'draft',$3,'local-model','editor','public','default','running','Writing','checkpoint-claim') returning id",[user,room,lead.id]);
  const job={id:jobRow.id,user_id:user,newsroom_id:room,kind:"draft",subject_id:lead.id,model_choice:"local-model",model_choice_source:"editor",research_scope:"public",lane:"default",status:"running",stage:"Writing",claim_token:"checkpoint-claim"} as DeskJob;
  await assert.rejects(performDraftWork(job,{setJobStage:async()=>{},reportAndDraft:async(_input,deps)=>{
    await deps.onWriterDraft?.({headline:"Saved writer",dek:"Saved dek",body:"Expensive writer output",topic:"council",source_urls:["https://records.example/item"],integrity_notes:"Prior warning",form:"brief",found:null,unanswered:[],claims:[],reporting_trail:[],captures:[{url:"https://records.example/item",title:"Record",version_id:44,capture_event_id:55}]});
    return {error:"Later gate failed"};
  }}),/Later gate failed/);
  const drafts=await sql.query<{headline:string;body:string;provenance_json:string;integrity_notes:string;research_json:string}>("select headline,body,provenance_json,integrity_notes,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by id",[room,lead.id]);
  assert.equal(drafts.length,2);
  assert.equal(drafts[0].body,"Original saved data");
  assert.equal(drafts[1].body,"Expensive writer output");
  assert.deepEqual(JSON.parse(drafts[1].provenance_json),[{url:"https://records.example/item",title:"Record",version_id:44,capture_event_id:55,role:"followed"}]);
  assert.match(drafts[1].integrity_notes,/Prior warning/);
  assert.match(drafts[1].integrity_notes,/Evidence reconciliation not completed/);
  assert.deepEqual(JSON.parse(drafts[1].research_json).writerCheckpoint,{version:1,jobId:job.id,evidenceCheckIncomplete:true});
  const [storedJob]=await sql.query<{status:string;result_json:string}>("select status,result_json from desk_jobs where id=$1",[job.id]);
  assert.equal(storedJob.status,"running");
  assert.equal(JSON.parse(storedJob.result_json).checkpointDraftId>0,true);
  const [storedLead]=await sql.query<{status:string}>("select status from leads where id=$1",[lead.id]);
  assert.equal(storedLead.status,"new");
  await sql.query("update desk_jobs set claim_token='replacement' where id=$1",[job.id]);
  await assert.rejects(withClaimedLeadDraftCheckpointLock(job,lead.id,async()=>assert.fail("stale lease entered checkpoint write")),/lease was lost/i);
  await sql.query("update desk_jobs set claim_token='checkpoint-claim' where id=$1",[job.id]);
  await sql.query("delete from newsroom_members where newsroom_id=$1 and user_id=$2",[room,user]);
  await assert.rejects(withClaimedLeadDraftCheckpointLock(job,lead.id,async()=>assert.fail("withdrawn editor entered checkpoint write")),/permission was withdrawn/i);
});

test("a later writer checkpoint cannot supersede an intervening editor draft",async()=>{
  await ensureJobsSchema();
  const sql=await getSql(),room=88402,user="checkpoint-race-editor";
  await sql.query("insert into newsrooms(id,name) values($1,'Checkpoint race room') on conflict(id) do nothing",[room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')",[user,room]);
  const [lead]=await sql.query<{id:number}>("insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Race lead','Why','council','new','[]','',1,'{}') returning id",[user,room]);
  const [jobRow]=await sql.query<{id:number}>("insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token) values($1,$2,'draft',$3,'local-model','editor','public','default','running','Writing','race-claim') returning id",[user,room,lead.id]);
  const job={id:jobRow.id,user_id:user,newsroom_id:room,kind:"draft",subject_id:lead.id,model_choice:"local-model",model_choice_source:"editor",research_scope:"public",lane:"default",status:"running",stage:"Writing",claim_token:"race-claim"} as DeskJob;
  const checkpoint={headline:"Writer one",dek:"",body:"Writer one body",topic:"council",source_urls:[],integrity_notes:"",form:"brief",found:null,unanswered:[],claims:[],reporting_trail:[],captures:[]};
  await assert.rejects(performDraftWork(job,{setJobStage:async()=>{},reportAndDraft:async(_input,deps)=>{
    await deps.onWriterDraft?.(checkpoint);
    await sql.query("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls) values($1,$2,$3,'Editor saved','','Editor newer body','council','[]')",[user,room,lead.id]);
    await deps.onWriterDraft?.({...checkpoint,headline:"Writer two",body:"Writer two body"});
    return {error:"unreachable"};
  }}),/draft changed/i);
  const rows=await sql.query<{headline:string}>("select headline from drafts where newsroom_id=$1 and lead_id=$2 order by id",[room,lead.id]);
  assert.deepEqual(rows.map(row=>row.headline),["Writer one","Editor saved"]);
});
