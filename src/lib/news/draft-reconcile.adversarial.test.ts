import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import { NAME_INVENTORY_SYSTEM } from "./name-check-work.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftReconcileWork: typeof import("./draft-reconcile.server.ts").performDraftReconcileWork;
let sequence = 91000;

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-draft-reconcile-${process.pid}`),
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  const module = await vite.ssrLoadModule("/src/lib/news/draft-reconcile.server.ts");
  // These fixtures contain no people. Keep their adversarial edit callbacks
  // attached to the editing pass, rather than repeating their side effects
  // when the separate name inventory runs.
  performDraftReconcileWork = (job, deps = {}) => module.performDraftReconcileWork(job, {
    ...deps,
    chat: deps.chat ? (system: string, ...args: Parameters<NonNullable<typeof deps.chat>> extends [string, ...infer Rest] ? Rest : never) =>
      system === NAME_INVENTORY_SYSTEM ? Promise.resolve({ ok: true, text: '{"complete":true,"people":[]}' }) : deps.chat!(system, ...args) : undefined,
  });
  await ensureJobsSchema();
  const sql = await getSql();
  await sql.query("create table if not exists newsrooms(id integer primary key,name text not null)");
  await sql.query("create table if not exists newsroom_members(user_id text,newsroom_id integer,role text)");
  await sql.query("create table if not exists leads(id serial primary key,user_id text,newsroom_id integer,status text,headline text,why text,topic text,source_urls text,evidence text,newsworthiness integer,created_at timestamptz default now())");
  await sql.query("create table if not exists drafts(id serial primary key,user_id text,newsroom_id integer,lead_id integer,headline text,dek text,body text,topic text,source_urls text default '[]',integrity_notes text,updated_at timestamptz default now(),provenance_json text,form text,found_note text,unanswered text,research_json text)");
  await sql.query("create table if not exists artifact_versions(id serial primary key,user_id text,newsroom_id integer,url text,content_hash text,title text default '',full_text text default '',fetch_status integer,fetch_outcome text,captured_at timestamptz default now())");
  await sql.query("create table if not exists newsroom_sections(newsroom_id integer,key text,name text,position integer,visible boolean,replacement_key text,primary key(newsroom_id,key))");
  const { ensureStoryDocuments } = await vite.ssrLoadModule("/src/lib/news/story-documents.server.ts");
  await ensureStoryDocuments(sql);
});

after(async () => vite?.close());

async function fixture() {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `reconcile-editor-${newsroomId}`;
  const url = `https://records.example/${newsroomId}`;
  await sql.query("insert into newsrooms(id,name) values($1,$2)", [newsroomId, `Room ${newsroomId}`]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [userId, newsroomId]);
  await sql.query("insert into section_config(newsroom_id) values($1) on conflict do nothing", [newsroomId]);
  await sql.query("insert into newsroom_sections(newsroom_id,key,name,position,visible,replacement_key) values($1,'council','Council',1,true,null)",[newsroomId]);
  const [lead] = await sql.query<{id:number}>("insert into leads(user_id,newsroom_id,status,headline,why,topic,source_urls,evidence,newsworthiness) values($1,$2,'drafted','Council record','Why','council',$3,'',1) returning id", [userId, newsroomId, JSON.stringify([url])]);
  const [draft] = await sql.query<{id:number}>("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,found_note,unanswered,research_json) values($1,$2,$3,'Original headline','Original dek','Original body','council',$4,'Prior independent warning',$5,'{}','[]','{}') returning id", [userId, newsroomId, lead.id, JSON.stringify([url]), JSON.stringify([{url, title:"Council record"}])]);
  const claim = `claim-${newsroomId}`;
  const [job] = await sql.query<DeskJob>("insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values($1,$2,'reconcile',$3,'local-model','editor','default','running','Queued',$4) returning *", [userId, newsroomId, draft.id, claim]);
  return { sql, newsroomId, userId, url, leadId: lead.id, draftId: draft.id, claim, job };
}

const reply = JSON.stringify({
  headline: "Reconciled headline",
  dek: "Reconciled dek",
  body: "Reconciled body supported by the saved record.",
  topic: "council",
  source_urls: [],
  integrity_notes: "",
  reporting_trail: [],
  found: {},
  unanswered: [],
  claims: [],
});

async function attachExactCapture(f: Awaited<ReturnType<typeof fixture>>) {
  const [capture] = await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'exact','Council record','SUPPORTED RECORD') returning id", [f.userId, f.newsroomId, f.url]);
  await f.sql.query("update drafts set provenance_json=$1 where id=$2", [JSON.stringify([{url:f.url,version_id:capture.id,role:"record"}]), f.draftId]);
  return capture.id;
}

async function draftRows(f: Awaited<ReturnType<typeof fixture>>) {
  return f.sql.query<{id:number;headline:string;body:string;integrity_notes:string}>("select id,headline,body,integrity_notes from drafts where newsroom_id=$1 and lead_id=$2 order by id", [f.newsroomId, f.leadId]);
}

test("a successful reconciliation saves a new version and preserves the original", async () => {
  const f = await fixture();
  await attachExactCapture(f);
  await performDraftReconcileWork(f.job, { stage: async () => {}, chat: async () => ({ok:true, text:reply}) });
  const rows = await draftRows(f);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {id:f.draftId, headline:"Original headline", body:"Original body", integrity_notes:"Prior independent warning"});
  assert.equal(rows[1].headline, "Reconciled headline");
  assert.match(rows[1].integrity_notes, /Prior independent warning/);
  assert.doesNotMatch(rows[1].integrity_notes, /no matching captured evidence/i);
  const [job] = await f.sql.query<{status:string;result_json:string}>("select status,result_json from desk_jobs where id=$1", [f.job.id]);
  assert.equal(job.status, "completed");
  assert.deepEqual(JSON.parse(job.result_json), {originalDraftId:f.draftId, newDraftId:rows[1].id, evidenceCheckIncomplete:false});
});

test("successful reconciliation replaces stale pass metadata but keeps exact provenance and real uncertainty", async () => {
  const f = await fixture();
  const versionId = await attachExactCapture(f);
  const timeoutNote = "Evidence reconciliation not completed within the available edit pass. Draft retained; verify its claims and citations before publication.";
  await f.sql.query("update drafts set integrity_notes=$1,form='reported',unanswered=$2,research_json=$3 where id=$4", [
    `Keep this independent warning\n${timeoutNote}`,
    JSON.stringify(["Old unanswered question"]),
    JSON.stringify({reportedClaims:{version:1,rows:[{fact:"Old claim",url:f.url,kind:"record"}]}}),
    f.draftId,
  ]);
  const response = JSON.stringify({
    headline:"Checked", dek:"Checked dek", body:"Checked body", topic:"council",
    source_urls:[f.url,"https://unchecked.example/new"], integrity_notes:"New remaining uncertainty",
    form:"brief", unanswered:["Still unknown"], found:null,
    claims:[
      {fact:"Supported revised claim",url:f.url,kind:"record"},
      {fact:"Unchecked claim",url:"https://unchecked.example/new",kind:"news"},
    ],
    reporting_trail:[{url:"https://unchecked.example/new",title:"Unchecked"}],
  });
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:response})});
  const [saved] = await f.sql.query<{provenance_json:string;form:string;unanswered:string;research_json:string;integrity_notes:string;source_urls:string}>("select provenance_json,form,unanswered,research_json,integrity_notes,source_urls from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",[f.newsroomId,f.leadId]);
  assert.deepEqual(JSON.parse(saved.provenance_json),[{url:f.url,version_id:versionId,role:"record"}]);
  assert.equal(saved.form,"brief");
  assert.deepEqual(JSON.parse(saved.unanswered),["Still unknown"]);
  assert.deepEqual(JSON.parse(saved.source_urls),[f.url]);
  assert.deepEqual(JSON.parse(saved.research_json).reportedClaims.rows,[{fact:"Supported revised claim",url:f.url,kind:"record"}]);
  assert.match(saved.integrity_notes,/Keep this independent warning/);
  assert.match(saved.integrity_notes,/New remaining uncertainty/);
  assert.doesNotMatch(saved.integrity_notes,/Evidence reconciliation not completed within the available edit pass/);
});

test("removes only the stale missing-topic warning when the current topic is configured",async()=>{
  const f=await fixture();
  await attachExactCapture(f);
  const stale="No configured Topic key was supplied with the lead; assign the editorial section before publication.";
  await f.sql.query("update drafts set integrity_notes=$1 where id=$2",[`Genuine remaining uncertainty\n${stale}`,f.draftId]);
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:reply})});
  const rows=await f.sql.query<{id:number;integrity_notes:string}>("select id,integrity_notes from drafts where newsroom_id=$1 and lead_id=$2 order by id",[f.newsroomId,f.leadId]);
  assert.equal(rows.length,2);
  assert.match(rows[0].integrity_notes,/No configured Topic key/);
  assert.match(rows[1].integrity_notes,/Genuine remaining uncertainty/);
  assert.doesNotMatch(rows[1].integrity_notes,/No configured Topic key/);
});

test("a changed body cannot inherit stale claims when the model omits the claims field", async () => {
  const f=await fixture();
  await attachExactCapture(f);
  await f.sql.query("update drafts set found_note=$1,research_json=$2 where id=$3",[
    JSON.stringify([{text:"Finding about original body",source_urls:[f.url],artifact_version_ids:[999999],capture_event_ids:[888888]}]),
    JSON.stringify({reportedClaims:{version:1,rows:[{fact:"Claim about original body",url:f.url,kind:"record"}]},writerCheckpoint:{version:1,jobId:77,evidenceCheckIncomplete:true}}),
    f.draftId,
  ]);
  const response=JSON.stringify({headline:"Changed",dek:"",body:"A materially changed checked body.",topic:"council",source_urls:[f.url],integrity_notes:"",form:"brief",unanswered:["Remaining question"]});
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:response})});
  const rows=await f.sql.query<{found_note:string;research_json:string}>("select found_note,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by id",[f.newsroomId,f.leadId]);
  assert.match(rows[0].found_note,/Finding about original body/);
  assert.equal(JSON.parse(rows[0].research_json).writerCheckpoint.evidenceCheckIncomplete,true);
  assert.equal(rows[1].found_note,"");
  assert.deepEqual(JSON.parse(rows[1].research_json).reportedClaims,{version:1,rows:[]});
  assert.equal("writerCheckpoint" in JSON.parse(rows[1].research_json),false);
});

test("reconciliation findings are capture-bound and model-supplied ids cannot replace exact ids", async () => {
  const f=await fixture();
  const versionId=await attachExactCapture(f);
  await f.sql.query("update drafts set provenance_json=$1 where id=$2",[JSON.stringify([{url:f.url,version_id:versionId,capture_event_id:4321,role:"record"}]),f.draftId]);
  const response=JSON.stringify({...JSON.parse(reply),found:[
    {text:"Supported finding",source_urls:[f.url],artifact_version_ids:[999999],capture_event_ids:[888888]},
    {text:"Unchecked finding",source_urls:["https://unchecked.example/spoof"],artifact_version_ids:[versionId],capture_event_ids:[4321]},
  ]});
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:response})});
  const [saved]=await f.sql.query<{found_note:string}>("select found_note from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",[f.newsroomId,f.leadId]);
  assert.deepEqual(JSON.parse(saved.found_note),[{
    text:"Supported finding",
    source_urls:[f.url],
    capture_event_ids:[4321],
    artifact_version_ids:[versionId],
    locators:[],
  }]);
});

test("reconciliation preserves the existing investigation story form", async () => {
  const f=await fixture();
  await attachExactCapture(f);
  const response=JSON.stringify({...JSON.parse(reply),form:"investigation"});
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:response})});
  const [saved]=await f.sql.query<{form:string}>("select form from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",[f.newsroomId,f.leadId]);
  assert.equal(saved.form,"investigation");
});

test("a newer draft inserted while the model runs prevents replacement of the stale draft", async () => {
  const f = await fixture();
  await attachExactCapture(f);
  await assert.rejects(
    performDraftReconcileWork(f.job, {
      stage: async () => {},
      chat: async () => {
        await f.sql.query("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,research_json) values($1,$2,$3,'Editor replacement','','Newer editor copy','council','[]','{}')", [f.userId, f.newsroomId, f.leadId]);
        return {ok:true, text:reply};
      },
    }),
    /draft or its evidence changed/i,
  );
  const rows = await draftRows(f);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].body, "Original body");
  assert.equal(rows[1].body, "Newer editor copy");
});

test("evidence removal while the model runs invalidates the reconciliation snapshot", async () => {
  const f = await fixture();
  await attachExactCapture(f);
  await assert.rejects(
    performDraftReconcileWork(f.job, {
      stage: async () => {},
      chat: async () => {
        await f.sql.query("update drafts set source_urls='[]',provenance_json='[]',research_json=$1,updated_at=now()+interval '1 second' where id=$2", [JSON.stringify({evidenceReview:{decision:"remove"}}), f.draftId]);
        return {ok:true, text:reply};
      },
    }),
    /draft or its evidence changed/i,
  );
  assert.equal((await draftRows(f)).length, 1);
});

test("a provenance reference to another newsroom fails before the model is called", async () => {
  const f = await fixture();
  const otherRoom = sequence++;
  await f.sql.query("insert into newsrooms(id,name) values($1,'Other room')", [otherRoom]);
  const [foreign] = await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values('intruder',$1,$2,'foreign','Foreign capture','CROSS-ROOM SECRET') returning id", [otherRoom, f.url]);
  await f.sql.query("update drafts set provenance_json=$1 where id=$2", [JSON.stringify([{url:f.url,version_id:foreign.id}]), f.draftId]);
  let calls = 0;
  await assert.rejects(performDraftReconcileWork(f.job, {
    stage: async () => {},
    chat: async () => { calls++; return {ok:true, text:reply}; },
  }), /capture is missing or no longer matches this newsroom/i);
  assert.equal(calls, 0);
  assert.equal((await draftRows(f)).length, 1);
});

test("an exact provenance version is used instead of a newer capture at the same URL", async () => {
  const f = await fixture();
  const [older] = await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at) values($1,$2,$3,'older','Older capture','EXACT OLDER CONTENT',now()-interval '1 day') returning id", [f.userId, f.newsroomId, f.url]);
  await f.sql.query("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,captured_at) values($1,$2,$3,'newer','Newer capture','UNREFERENCED NEWER CONTENT',now())", [f.userId, f.newsroomId, f.url]);
  await f.sql.query("update drafts set provenance_json=$1 where id=$2", [JSON.stringify([{url:f.url,version_id:older.id}]), f.draftId]);
  let prompt = "";
  await performDraftReconcileWork(f.job, {
    stage: async () => {},
    chat: async (_system, userPrompt) => { prompt = userPrompt; return {ok:true, text:reply}; },
  });
  assert.match(prompt, new RegExp(`CAPTURE VERSION ${older.id}`));
  assert.match(prompt, /EXACT OLDER CONTENT/);
  assert.doesNotMatch(prompt, /UNREFERENCED NEWER CONTENT/);
});

test("a trailing-slash provenance spelling accepts the exact same capture version", async () => {
  const f = await fixture();
  const [capture] = await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'slash','Exact capture','TRAILING SLASH MATCH') returning id", [f.userId, f.newsroomId, f.url]);
  await f.sql.query("update drafts set provenance_json=$1 where id=$2", [JSON.stringify([{url:`${f.url}/`,version_id:capture.id}]), f.draftId]);
  let prompt = "";
  await performDraftReconcileWork(f.job, {stage:async()=>{},chat:async(_system,userPrompt)=>{prompt=userPrompt;return {ok:true,text:reply};}});
  assert.match(prompt,/TRAILING SLASH MATCH/);
});

test("an exact version id still rejects a genuinely different provenance URL", async () => {
  const f = await fixture();
  const [capture] = await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'distinct','Exact capture','DISTINCT URL') returning id", [f.userId, f.newsroomId, f.url]);
  await f.sql.query("update drafts set provenance_json=$1 where id=$2", [JSON.stringify([{url:`${f.url}/different`,version_id:capture.id}]), f.draftId]);
  let calls=0;
  await assert.rejects(performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>{calls++;return {ok:true,text:reply};}}),/capture is missing or no longer matches this newsroom/i);
  assert.equal(calls,0);
});

test("a draft with no matching captures stops before the model and saves no new version", async () => {
  const f = await fixture();
  await f.sql.query("update drafts set source_urls='[]',provenance_json='[]',found_note='{}',unanswered='[]',research_json=$1 where id=$2", [JSON.stringify({citationPolicy:"explicit"}), f.draftId]);
  await f.sql.query("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'lead-only','Lead-only capture','MUST NOT BE INHERITED')", [f.userId, f.newsroomId, f.url]);
  let calls = 0;
  await assert.rejects(performDraftReconcileWork(f.job, {
    stage: async () => {},
    chat: async () => { calls++; return {ok:true, text:reply}; },
  }),/no matching saved capture/i);
  assert.equal(calls,0);
  assert.equal((await draftRows(f)).length,1);
});

test("empty public citations can still use an exact private provenance capture", async () => {
  const f=await fixture();
  const versionId=await attachExactCapture(f);
  await f.sql.query("update drafts set source_urls='[]',research_json=$1 where id=$2",[JSON.stringify({citationPolicy:"explicit"}),f.draftId]);
  let calls=0;
  const privateReply=JSON.stringify({...JSON.parse(reply),source_urls:[f.url],claims:[{fact:"Private supported claim",url:f.url,kind:"record"}],reporting_trail:[{url:f.url,title:"Private record"}]});
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async(_system,prompt)=>{calls++;assert.match(prompt,new RegExp(`CAPTURE VERSION ${versionId}`));return {ok:true,text:privateReply};}});
  assert.equal(calls,1);
  assert.equal((await draftRows(f)).length,2);
  const [saved]=await f.sql.query<{source_urls:string;provenance_json:string;research_json:string}>("select source_urls,provenance_json,research_json from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",[f.newsroomId,f.leadId]);
  assert.deepEqual(JSON.parse(saved.source_urls),[]);
  assert.deepEqual(JSON.parse(saved.provenance_json),[{url:f.url,version_id:versionId,role:"record"}]);
  assert.deepEqual(JSON.parse(saved.research_json).reportedClaims.rows,[{fact:"Private supported claim",url:f.url,kind:"record"}]);
});

test("an explicitly cited public research capture gains its exact provenance", async () => {
  const f=await fixture();
  const originalVersion=await attachExactCapture(f);
  const addedUrl=`https://downtown.example/parking/${f.newsroomId}`;
  const [added]=await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'added-public','Public parking record','LOT CLOSED') returning id",[f.userId,f.newsroomId,addedUrl]);
  await f.sql.query("update drafts set research_json=$1 where id=$2",[JSON.stringify({citationPolicy:"explicit",researchScope:"public",captured:[{url:addedUrl,title:"Public parking record"}]}),f.draftId]);
  const response=JSON.stringify({...JSON.parse(reply),source_urls:[f.url,addedUrl,"https://unchecked.example/not-captured"],claims:[{fact:"The lot is closed.",url:addedUrl,kind:"record"}]});
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:response})});
  const rows=await f.sql.query<{source_urls:string;provenance_json:string}>("select source_urls,provenance_json from drafts where newsroom_id=$1 and lead_id=$2 order by id",[f.newsroomId,f.leadId]);
  assert.deepEqual(JSON.parse(rows[1].source_urls),[f.url,addedUrl]);
  const savedProvenance=JSON.parse(rows[1].provenance_json) as Array<Record<string,unknown>>;
  assert.deepEqual(savedProvenance[0],{url:f.url,version_id:originalVersion,role:"record"});
  assert.deepEqual(savedProvenance[1],{url:addedUrl,title:"Public parking record",version_id:added.id,captured_at:savedProvenance[1].captured_at,role:"followed"});
  assert.equal(typeof savedProvenance[1].captured_at,"string");
  assert.deepEqual(JSON.parse(rows[0].source_urls),[f.url]);
  assert.deepEqual(JSON.parse(rows[0].provenance_json),[{url:f.url,version_id:originalVersion,role:"record"}]);
});

test("a returned private corroboration URL is not promoted beside existing public citations", async () => {
  const f=await fixture();
  await attachExactCapture(f);
  const privateUrl=`https://private.example/record/${f.newsroomId}`;
  const [privateCapture]=await f.sql.query<{id:number}>("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'private','Private corroboration','PRIVATE MATERIAL') returning id",[f.userId,f.newsroomId,privateUrl]);
  await f.sql.query("update drafts set provenance_json=(provenance_json::jsonb || $1::jsonb)::text,research_json=$2 where id=$3",[JSON.stringify([{url:privateUrl,version_id:privateCapture.id,role:"corroboration"}]),JSON.stringify({citationPolicy:"explicit",researchScope:"public"}),f.draftId]);
  const response=JSON.stringify({...JSON.parse(reply),source_urls:[f.url,privateUrl]});
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>({ok:true,text:response})});
  const [saved]=await f.sql.query<{source_urls:string;provenance_json:string}>("select source_urls,provenance_json from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",[f.newsroomId,f.leadId]);
  assert.deepEqual(JSON.parse(saved.source_urls),[f.url]);
  assert.equal(JSON.parse(saved.provenance_json).some((row:{url:string})=>row.url===privateUrl),true);
});

test("a stale claim cannot commit a reconciled version", async () => {
  const f = await fixture();
  await attachExactCapture(f);
  await assert.rejects(
    performDraftReconcileWork(f.job, {
      stage: async () => {},
      chat: async () => {
        await f.sql.query("update desk_jobs set claim_token='replacement-claim' where id=$1", [f.job.id]);
        return {ok:true, text:reply};
      },
    }),
    /lease was lost/i,
  );
  assert.equal((await draftRows(f)).length, 1);
});

test("a failed model call retains the original without saving a replacement", async () => {
  const f = await fixture();
  await attachExactCapture(f);
  await assert.rejects(
    performDraftReconcileWork(f.job, { stage: async () => {}, chat: async () => ({ok:false, error:"fake provider failure"}) }),
    /fake provider failure/,
  );
  assert.deepEqual(await draftRows(f), [{id:f.draftId, headline:"Original headline", body:"Original body", integrity_notes:"Prior independent warning"}]);
});

async function attachUpload(f: Awaited<ReturnType<typeof fixture>>, id = `packet-${f.newsroomId}`, text = "The council approved $25, not $250. FINAL PAGE FACT.", room = f.newsroomId, lead: number | null = f.leadId) {
  await f.sql.query("insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original,full_text,evidence,status) values($1,$2,$3,$4,'packet.pdf','application/pdf',$5,$6,'WRONG CONDENSED NOTES: $250','read')", [id,room,f.userId,lead,Buffer.from(text),text]);
  return id;
}

test("document-only drafts use retained text and store private identity/coverage receipts without publishing URLs", async () => {
  const f = await fixture();
  await f.sql.query("update drafts set source_urls='[]',provenance_json='[]',research_json=$1 where id=$2", [JSON.stringify({researchScope:'supplied'}),f.draftId]);
  const id = await attachUpload(f);
  await attachUpload(f,`foreign-${f.newsroomId}`,"FOREIGN ROOM SECRET",f.newsroomId+100000);
  await attachUpload(f,`unattached-${f.newsroomId}`,"UNATTACHED SECRET",f.newsroomId,null);
  let prompt = '';
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async(_system,user)=>{prompt=user;return {ok:true,text:JSON.stringify({...JSON.parse(reply),source_urls:['https://invented.example/packet.pdf']})};}});
  assert.match(prompt,/The council approved \$25, not \$250/);
  assert.match(prompt,/FINAL PAGE FACT/);
  assert.match(prompt,/packet.pdf/);
  assert.doesNotMatch(prompt,/WRONG CONDENSED NOTES|FOREIGN ROOM SECRET|UNATTACHED SECRET/);
  const rows = await f.sql.query<{body:string;source_urls:string;research_json:string}>("select body,source_urls,research_json from drafts where lead_id=$1 order by id",[f.leadId]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].body,'Original body');
  assert.deepEqual(JSON.parse(rows[1].source_urls),[]);
  const review = JSON.parse(rows[1].research_json).documentEvidenceReview;
  assert.equal(review.mode,'full-text');
  assert.deepEqual(review.documents.map((doc:{id:string})=>doc.id),[id]);
  assert.equal(review.documents[0].textHash.length,64);
  assert.deepEqual(review.locators,[{documentId:id,start:0,end:review.documents[0].characters}]);
});

test("document claims retain exact private filename and locator without fabricating a public URL", async () => {
  const f=await fixture();
  await f.sql.query("update drafts set source_urls='[]',provenance_json='[]',research_json=$1 where id=$2",[JSON.stringify({researchScope:'supplied'}),f.draftId]);
  const text="SIGNED RECORD: The council approved $25."; const id=await attachUpload(f,undefined,text);
  let call=0;
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async(_system)=>{
    call++;
    if(call===1) return {ok:true,text:JSON.stringify({...JSON.parse(reply),document_claims:[{fact:"The council approved $25.",kind:"record",documentId:id,excerpt:text}],source_urls:["https://invented.example/private"]})};
    return {ok:true,text:JSON.stringify(call===2?{complete:true,people:[]}:{checks:[]})};
  }});
  const [saved]=await f.sql.query<{source_urls:string;research_json:string}>("select source_urls,research_json from drafts where lead_id=$1 order by id desc limit 1",[f.leadId]);
  assert.deepEqual(JSON.parse(saved.source_urls),[]);
  const documentClaims=JSON.parse(saved.research_json).reportedDocumentClaims;
  assert.equal(typeof documentClaims.checkedText,"string");
  assert.deepEqual(documentClaims.rows,[{fact:"The council approved $25.",kind:"record",documentId:id,filename:"packet.pdf",locator:`characters 1-${text.length}`,excerpt:text}]);
});

test("mixed evidence includes both an exact web version and the uploaded original",async()=>{
  const f=await fixture(); const version=await attachExactCapture(f); await attachUpload(f);
  await performDraftReconcileWork(f.job,{stage:async()=>{},chat:async(_system,prompt)=>{
    assert.match(prompt,new RegExp(`CAPTURE VERSION ${version}`));
    assert.match(prompt,/FINAL PAGE FACT/);
    return {ok:true,text:reply};
  }});
  assert.equal((await draftRows(f)).length,2);
});

test("an unread attachment blocks a partial evidence check before any model call",async()=>{
  const f=await fixture(); await attachExactCapture(f); const id=await attachUpload(f);
  await f.sql.query("update story_documents set status='failed',full_text=null where id=$1",[id]);
  let calls=0;
  await assert.rejects(performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>{calls++;return {ok:true,text:reply};}}),/has not finished reading/);
  assert.equal(calls,0); assert.equal((await draftRows(f)).length,1);
});

for (const mutation of ['text','original','remove','add'] as const) test(`uploaded evidence ${mutation} during the check preserves the original draft`,async()=>{
  const f=await fixture(); const id=await attachUpload(f);
  await assert.rejects(performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>{
    if(mutation==='text') await f.sql.query("update story_documents set full_text='CHANGED' where id=$1",[id]);
    if(mutation==='original') await f.sql.query("update story_documents set original=$1 where id=$2",[Buffer.from('CHANGED'),id]);
    if(mutation==='remove') await f.sql.query("delete from story_documents where id=$1",[id]);
    if(mutation==='add') await attachUpload(f,`added-${id}`);
    return {ok:true,text:reply};
  }}),/uploaded documents changed/i);
  assert.equal((await draftRows(f)).length,1);
});

test("a missing previously reviewed upload cannot silently fall back to web captures",async()=>{
  const f=await fixture();await attachExactCapture(f);
  await f.sql.query("update drafts set research_json=$1 where id=$2",[JSON.stringify({documentEvidenceReview:{documents:[{id:'missing'}]}}),f.draftId]);
  let calls=0;
  await assert.rejects(performDraftReconcileWork(f.job,{stage:async()=>{},chat:async()=>{calls++;return {ok:true,text:reply};}}),/previously checked uploaded document/);
  assert.equal(calls,0);
});

test("large packets read every section, including late counterevidence, and pass only exact extracts to the editor",async()=>{
  const {prepareDocumentReconcileEvidence,DOCUMENT_REVIEW_SYSTEM}=await vite.ssrLoadModule('/src/lib/news/document-reconcile-evidence.ts');
  const text='Unrelated background. '.repeat(5000)+'FINAL CORRECTION: the vote failed, 2 to 3.';
  let calls=0;
  const result=await prepareDocumentReconcileEvidence([{id:'large',filename:'long.md',mime:'text/markdown',status:'read',full_text:text,original_hash:'hash',source_url:null}], 'The motion passed.',async(system:string,prompt:string)=>{
    assert.equal(system,DOCUMENT_REVIEW_SYSTEM);calls++;
    return {ok:true,text:JSON.stringify({complete:true,quotes:prompt.includes('FINAL CORRECTION')?['FINAL CORRECTION: the vote failed, 2 to 3.']:[]})};
  },'local-model',async()=>{},1000);
  assert.equal(calls,Math.ceil(text.length/24000));
  assert.equal(result.receipt.sectionsRead,calls);
  assert.match(result.text,/FINAL CORRECTION: the vote failed, 2 to 3/);
  const last=result.receipt.locators.at(-1);
  assert.equal(text.slice(last.start,last.end),'FINAL CORRECTION: the vote failed, 2 to 3.');
});

for(const invalid of [{complete:false,quotes:[]},{complete:true,quotes:['FABRICATED PASSAGE']}]) test(`large-document selection rejects ${JSON.stringify(invalid)}`,async()=>{
  const {prepareDocumentReconcileEvidence}=await vite.ssrLoadModule('/src/lib/news/document-reconcile-evidence.ts');
  await assert.rejects(prepareDocumentReconcileEvidence([{id:'large',filename:'long.md',mime:'text/markdown',status:'read',full_text:'x'.repeat(90000),original_hash:'hash',source_url:null}], 'Draft',async()=>({ok:true,text:JSON.stringify(invalid)}),'local-model',async()=>{},1000),/draft was preserved/i);
});
