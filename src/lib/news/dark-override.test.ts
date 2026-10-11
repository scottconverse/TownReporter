import assert from "node:assert/strict";
import { it } from "node:test";
import { getSql } from "../db.ts";
import { startDarkRound, startBriefJob, ensureDarkSchema } from "./dark.ts";
import { enqueueJob } from "./jobs.ts";
import { ensureDeskRateSchema } from "./ops.ts";

const context={userId:"dark-override-editor",newsroomId:1};
const deps={kick:false,probe:async()=>({ok:true as const,choice:"claude-sonnet" as const,label:"Sonnet",skippedRungs:[]})};
it("Dark and brief caps warn without spending, then enqueue with audit; model changes cancel the old claim",async()=>{
  await ensureDarkSchema(); await ensureDeskRateSchema();
  const sql=await getSql();
  for(const [kind,cap,start] of [["dark",8,startDarkRound],["brief",40,startBriefJob]] as const){
    const [file]=await sql.query<{id:number}>("insert into investigations(user_id,newsroom_id,title,summary) values($1,1,'Fixture investigation','Fixture seed') returning id",[context.userId]);
    await sql.query("insert into desk_rate(user_id,newsroom_id,action) select $1,1,$2 from generate_series(1,$3)",[context.userId,kind,cap]);
    const warning=await start(context,file.id,"claude-sonnet",undefined,undefined,deps);
    assert.equal("warning" in warning && warning.warning.key,`rate-${kind}`);
    const [count]=await sql.query<{c:number}>("select count(*)::int c from desk_rate where user_id=$1 and action=$2",[context.userId,kind]); assert.equal(count.c,cap);
    const result=await start(context,file.id,"claude-sonnet",undefined,[`rate-${kind}`],deps); assert.equal(result.ok,true);
    const [other]=await sql.query<{id:number}>("insert into investigations(user_id,newsroom_id,title,summary) values($1,1,'Another fixture investigation','Seed') returning id",[context.userId]);
    const old=await enqueueJob({userId:context.userId,newsroomId:1,kind,subjectId:other.id,modelChoice:"codex-frontier",kick:false});
    await sql.query("update desk_jobs set claim_token='old-claim' where id=$1",[old.id]);
    const restart=await start(context,other.id,"claude-sonnet",undefined,undefined,deps);
    assert.equal("warning" in restart && restart.warning.key,"model-change-running");
    const approved=await start(context,other.id,"claude-sonnet",undefined,["model-change-running",`rate-${kind}`],deps); assert.equal(approved.ok,true);
    const [cancelled]=await sql.query<{status:string;claim_token:string|null}>("select status,claim_token from desk_jobs where id=$1",[old.id]);assert.equal(cancelled.status,"failed");assert.equal(cancelled.claim_token,null);
    const missing=await start(context,2147483000,"claude-sonnet",undefined,["model-change-running",`rate-${kind}`],deps); assert.equal(missing.ok,false);
  }
  const rows=await sql.query<{detail:string;created_at:unknown}>("select detail,created_at from audit_events where action='override' and user_id=$1",[context.userId]);
  for(const key of ["rate-dark","rate-brief","model-change-running"]) assert.ok(rows.some(r=>JSON.parse(r.detail).key===key && JSON.parse(r.detail).target && r.created_at));
});
