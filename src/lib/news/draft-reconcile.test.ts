import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let enqueueJob: typeof import("./jobs.ts").enqueueJob;
let requestDraftReconciliation: typeof import("./draft-reconcile.server.ts").requestDraftReconciliation;

before(async () => {
  vite = await createServer({ configFile: false, cacheDir: join(tmpdir(),`townreporter-reconcile-request-${process.pid}`), server: { middlewareMode: true, hmr: {port:0} }, resolve: { alias: { "@": join(process.cwd(), "src") } } });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema, enqueueJob } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({ requestDraftReconciliation } = await vite.ssrLoadModule("/src/lib/news/draft-reconcile.server.ts"));
});
after(async () => vite.close());

test("queues the exact latest authorized draft version", async () => {
  await ensureJobsSchema();
  const sql = await getSql();
  await sql.query("create table if not exists newsrooms(id integer primary key,name text not null)");
  await sql.query("create table if not exists newsroom_members(user_id text,newsroom_id integer,role text)");
  await sql.query("create table if not exists leads(id serial primary key,user_id text,newsroom_id integer,status text,headline text,why text,topic text,source_urls text,evidence text,newsworthiness integer,created_at timestamptz default now())");
  await sql.query("create table if not exists drafts(id serial primary key,user_id text,newsroom_id integer,lead_id integer,headline text,dek text,body text,topic text,source_urls text default '[]',integrity_notes text,updated_at timestamptz default now(),provenance_json text,form text,found_note text,unanswered text,research_json text)");
  await sql.query("insert into newsrooms values(88101,'Reconcile room')");
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values('editor',88101,'editor')");
  const [lead] = await sql.query<{id:number}>("insert into leads(user_id,newsroom_id,status,headline,why,topic,source_urls,evidence,newsworthiness) values('editor',88101,'drafted','Lead','Why','council','[]','',1) returning id");
  await sql.query("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic) values('editor',88101,$1,'Old','','Old','council')",[lead.id]);
  const [latest] = await sql.query<{id:number}>("insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic) values('editor',88101,$1,'Latest','','Latest','council') returning id",[lead.id]);
  const job = await requestDraftReconciliation({userId:'editor',newsroomId:88101},{leadId:lead.id,modelChoice:'local-model'},{probe:async()=>({ok:true as const,label:'Local',choice:'local-model'}),enqueue: opts => enqueueJob({...opts,kick:false})});
  assert.equal(job.kind,'reconcile');
  assert.equal(job.subject_id,latest.id);
  let codexChoice = "";
  const codexJob = await requestDraftReconciliation({userId:'editor',newsroomId:88101},{leadId:lead.id,modelChoice:'codex-balanced'},{
    probe:async()=>({ok:true as const,label:'Codex',choice:'codex-balanced'}),
    enqueue: async opts => { codexChoice=String(opts.modelChoice); return {...job,id:job.id+1,model_choice:String(opts.modelChoice)}; },
  });
  assert.equal(codexChoice,'codex-balanced');
  assert.equal(codexJob.model_choice,'codex-balanced');
  await assert.rejects(requestDraftReconciliation({userId:'editor',newsroomId:88101},{leadId:lead.id,modelChoice:'not-a-provider'},{probe:async()=>({ok:true as const,label:'unused',choice:'local-model'}),enqueue:async()=>job}),/selected model is not available/i);
  await sql.query("delete from desk_jobs where newsroom_id=88101");
  await sql.query("delete from drafts where newsroom_id=88101");
  await sql.query("delete from leads where newsroom_id=88101");
  await sql.query("delete from newsroom_members where newsroom_id=88101");
  await sql.query("delete from newsrooms where id=88101");
});
