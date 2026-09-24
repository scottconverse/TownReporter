import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { ReportedDraftResult } from "./desk-model-run.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let ensureStoryDocuments: typeof import("./story-documents.server.ts").ensureStoryDocuments;
let readStoryDocuments: typeof import("./story-documents.server.ts").readStoryDocuments;
let withClaimedLeadDraftCheckpointLock: typeof import("./draft-order.server.ts").withClaimedLeadDraftCheckpointLock;
let withClaimedLeadDraftLock: typeof import("./draft-order.server.ts").withClaimedLeadDraftLock;

before(async () => {
  vite=await createServer({configFile:false,cacheDir:join(tmpdir(),`townreporter-draft-checkpoint-${process.pid}`),server:{middlewareMode:true,hmr:{port:0}},resolve:{alias:{"@":join(process.cwd(),"src")}}});
  ({getSql}=await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ensureJobsSchema}=await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({performDraftWork}=await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ensureStoryDocuments,readStoryDocuments}=await vite.ssrLoadModule("/src/lib/news/story-documents.server.ts"));
  ({withClaimedLeadDraftCheckpointLock,withClaimedLeadDraftLock}=await vite.ssrLoadModule("/src/lib/news/draft-order.server.ts"));
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
    await deps!.onWriterDraft?.({headline:"Saved writer",dek:"Saved dek",body:"Expensive writer output",topic:"council",source_urls:["https://records.example/item"],integrity_notes:"Prior warning",form:"brief",found:null,unanswered:[],claims:[],reporting_trail:[],captures:[{url:"https://records.example/item",title:"Record",version_id:44,capture_event_id:55}]});
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

test("document reading retries only the failed chunk and keeps completed chunks", async () => {
  await ensureJobsSchema();
  const sql = await getSql(), room = 88404, user = "document-failover-editor";
  await ensureStoryDocuments(sql);
  await sql.query("insert into newsrooms(id,name) values($1,'Document failover room') on conflict(id) do nothing", [room]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Packet lead','Uploaded packet','council','new','[]','',1,'{}') returning id",
    [user, room],
  );
  // Exactly two model-sized chunks: one completes on the requested provider,
  // then only the second chunk is retried after the technical switch.
  const text = `${"First completed section. ".repeat(850)}${"Second failed section. ".repeat(850)}`;
  await sql.query(
    "insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original) values($1,$2,$3,$4,'packet.txt','text/plain',$5)",
    [`checkpoint-${Date.now()}`, room, user, lead.id, Buffer.from(text)],
  );
  const calls: Array<{ choice: string; marker: string }> = [];
  const switches: string[] = [];
  const evidence = await readStoryDocuments(
    room,
    lead.id,
    "codex-balanced",
    "Read the packet",
    async () => undefined,
    [],
    user,
    true,
    undefined,
    {
      modelEffort: "none",
      source: "auto",
      probe: async () => ({ ok: true, label: "Claude Sonnet", choice: "claude-sonnet" }),
      chat: async (_system, prompt, _tokens, opts) => {
        const choice = String(opts?.choice);
        const marker = prompt.includes("Characters 1-24000") ? "first" : "second";
        calls.push({ choice, marker });
        if (choice === "codex-balanced" && marker === "second") {
          return { ok: false as const, error: "Codex request timed out after 150s, 0 bytes out" };
        }
        return { ok: true as const, text: `${marker} evidence from ${choice}` };
      },
      onSwitch: async ({ nextChoice }) => { switches.push(nextChoice); },
    },
  );
  assert.deepEqual(calls, [
    { choice: "codex-balanced", marker: "first" },
    { choice: "codex-balanced", marker: "second" },
    { choice: "claude-sonnet", marker: "second" },
  ]);
  assert.deepEqual(switches, ["claude-sonnet"]);
  assert.match(evidence, /first evidence from codex-balanced/);
  assert.match(evidence, /second evidence from claude-sonnet/);
});
test("Story retries only the failed writer call and keeps completed research", async () => {
  await ensureJobsSchema();
  const sql = await getSql(), room = 88405, user = "writer-call-failover-editor";
  await sql.query("insert into newsrooms(id,name) values($1,'Writer failover room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Writer failover lead','Why','council','new','[]','',1,'{}') returning id",
    [user, room],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token,result_json) values($1,$2,'draft',$3,'codex-balanced','editor','supplied','default','running','Writing','writer-failover-claim',$4) returning id",
    [user, room, lead.id, JSON.stringify({ modelEffort: "none" })],
  );
  const job = {
    id: jobRow.id, user_id: user, newsroom_id: room, kind: "draft", subject_id: lead.id,
    model_choice: "codex-balanced", model_choice_source: "editor", research_scope: "supplied",
    lane: "default", status: "running", stage: "Writing", claim_token: "writer-failover-claim",
    result_json: JSON.stringify({ modelEffort: "none" }),
  } as DeskJob;
  let reportCalls = 0;
  let upstreamResearchCalls = 0;
  const providerCalls: Array<{ choice: unknown; effort: unknown }> = [];

  await performDraftWork(job, {
    readStoryDocuments: async () => "",
    reportAndDraft: async (_input, deps) => {
      reportCalls += 1;
      upstreamResearchCalls += 1;
      const written = await deps!.chat?.("writer system", "assembled research packet", 2200);
      assert.equal(written?.ok, true);
      return {
        headline: "Writer failover lead", dek: "", body: "The completed research packet was reused.",
        topic: "council", source_urls: [], integrity_notes: "", memory_entities: [], form: "news",
        provenance: [], found_note: "", findings: [], unanswered: [], claims: [], research_memo: {},
      } as unknown as ReportedDraftResult;
    },
    chat: async (_system, _user, _tokens, opts) => {
      providerCalls.push({ choice: opts?.choice, effort: opts?.reasoningEffort });
      return providerCalls.length === 1
        ? { ok: false as const, error: "Codex request timed out after 150s, 0 bytes out" }
        : { ok: true as const, text: "writer result" };
    },
    probe: async () => ({ ok: true, label: "Claude Sonnet", choice: "claude-sonnet" }),
    setJobStage: async () => undefined,
    setJobModelChoice: async (_id, choice) => { job.model_choice = choice; },
    setJobFailoverNote: async () => undefined,
  });

  assert.equal(reportCalls, 1, "the reporting pipeline must not restart");
  assert.equal(upstreamResearchCalls, 1, "completed ingestion/search/report gathering must be reused");
  assert.deepEqual(providerCalls, [
    { choice: "codex-balanced", effort: "none" },
    { choice: "claude-sonnet", effort: "medium" },
  ]);
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
    await deps!.onWriterDraft?.(checkpoint);
    await sql.query("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls) values($1,$2,$3,'Editor saved','','Editor newer body','council','[]')",[user,room,lead.id]);
    await deps!.onWriterDraft?.({...checkpoint,headline:"Writer two",body:"Writer two body"});
    return {error:"unreachable"};
  }}),/draft changed/i);
  const rows=await sql.query<{headline:string}>("select headline from drafts where newsroom_id=$1 and lead_id=$2 order by id",[room,lead.id]);
  assert.deepEqual(rows.map(row=>row.headline),["Writer one","Editor saved"]);
});

test("the atomic final-draft commit exposes a review-required terminal stage",async()=>{
  await ensureJobsSchema();
  const sql=await getSql(),room=88403,user="review-stage-editor";
  await sql.query("insert into newsrooms(id,name) values($1,'Review stage room') on conflict(id) do nothing",[room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')",[user,room]);
  const [lead]=await sql.query<{id:number}>("insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Review stage lead','Why','council','new','[]','',1,'{}') returning id",[user,room]);
  const receipt=JSON.stringify({version:2,finalDraftId:501,draftId:501,quality:{version:1,citationStatus:"repaired",evidenceCheckIncomplete:false,nameCheckComplete:false,namesVerified:false,reviewRequired:true,reviewReasons:["name-check-incomplete"]}});
  const [jobRow]=await sql.query<{id:number}>("insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token,result_json) values($1,$2,'draft',$3,'local-model','editor','supplied','default','running','Checking names','review-stage-claim',$4) returning id",[user,room,lead.id,receipt]);
  const job={id:jobRow.id,user_id:user,newsroom_id:room,kind:"draft",subject_id:lead.id,model_choice:"local-model",model_choice_source:"editor",research_scope:"supplied",lane:"default",status:"running",stage:"Checking names",claim_token:"review-stage-claim"} as DeskJob;
  await withClaimedLeadDraftLock(job,lead.id,async()=>undefined);
  const [stored]=await sql.query<{status:string;stage:string}>("select status,stage from desk_jobs where id=$1",[job.id]);
  assert.deepEqual(stored,{status:"completed",stage:"Draft saved — review required"});
});
