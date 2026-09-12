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
