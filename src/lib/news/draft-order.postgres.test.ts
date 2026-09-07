import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";
import type { DraftRow } from "./types.ts";

// PGLite serializes whole transactions: it cannot prove a parent-row lock.
// This opt-in test uses independent PostgreSQL connections and NOWAIT plus
// pg_stat_activity to observe contention, not an arbitrary sleep assertion.
const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested() ? await probePostgres(adminUrl) : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; the postgres-integration CI job runs this real connection-ordering check" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_test_draft_order_${process.pid}_${Date.now()}`;
let created = false;
let db: typeof import("../db.ts");
let order: typeof import("./draft-order.server.ts");
if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try { await admin.query(`create database ${dbName}`); created = true; } finally { await admin.end(); }
    process.env.DATABASE_URL = withDatabase(adminUrl, dbName);
    db = await import("../db.ts");
    order = await import("./draft-order.server.ts");
    const sql = await db.getSql();
    await sql.query(`create table leads(id integer primary key, newsroom_id integer, status text)`);
    await sql.query(`create table drafts(id serial primary key, lead_id integer, newsroom_id integer, headline text, dek text, body text, topic text, source_urls text, updated_at timestamptz default now())`);
    await sql.query(`create table articles(id serial primary key, body text)`);
    await sql.query(`insert into leads values(1,81,'drafted')`);
    await sql.query(`insert into drafts(lead_id,newsroom_id,headline,dek,body,topic,source_urls) values(1,81,'Reviewed','','Reviewed draft','community','[]')`);
  });
  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [dbName]);
      await admin.query(`drop database ${dbName}`);
    } finally { await admin.end(); }
  });
}

it("real PostgreSQL parent lock blocks replacement drafts during publication", { skip, timeout: 15000 }, async () => {
  const sql = await db.getSql();
  const [expected] = await sql<DraftRow>`select * from drafts where lead_id=1`;
  const observer = new Client({ connectionString: withDatabase(adminUrl, dbName) });
  await observer.connect();
  let release!: () => void;
  const pause = new Promise<void>(r => { release=r; });
  let entered!: () => void;
  const ownsFence = new Promise<void>(r => { entered=r; });
  const publishing = order.withCurrentDraftForPublish({ newsroomId:81 },1,expected,async tx => {
    entered();
    await pause;
    await tx`insert into articles(body) values(${expected.body})`;
    await tx`update leads set status='published' where id=1`;
  });
  void publishing.catch(() => {});
  let writer: Promise<{ok:boolean;error?:unknown}> | undefined;
  let writerEntered = false;
  try {
    await ownsFence;
    await observer.query("begin");
    let lockError: unknown;
    try { await observer.query("select id from leads where id=1 for update nowait"); }
    catch (error) { lockError=error; }
    finally { await observer.query("rollback"); }
    assert.equal((lockError as {code?:string}|undefined)?.code,"55P03","publisher must hold the parent row: removing FOR UPDATE must fail this assertion");

    writer=order.withLeadDraftLock({ newsroomId:81 },1,async tx => {
      writerEntered=true;
      await tx`insert into drafts(lead_id,newsroom_id,body) values(1,81,'Unreviewed replacement')`;
    }).then(()=>({ok:true}),error=>({ok:false,error}));
    const deadline=Date.now()+5000;
    let waiting=false;
    while (Date.now()<deadline) {
      const result=await observer.query<{waiting:boolean}>("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select id, to_jsonb(leads)%') as waiting");
      if (result.rows[0].waiting) { waiting=true; break; }
      assert.equal(writerEntered,false,"replacement writer entered before publication released the parent fence");
      await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(waiting,true,"replacement writer must reach the real PostgreSQL lock");
    release();
    await publishing;
    const outcome=await writer;
    assert.equal(outcome.ok,false);
    assert.match(String(outcome.error),/already been published/);
    assert.equal(writerEntered,false);
    assert.deepEqual((await sql<{body:string}>`select body from articles`).map(r=>r.body),["Reviewed draft"]);
    assert.equal((await sql<{n:number}>`select count(*)::integer as n from drafts`)[0].n,1);
  } finally {
    release();
    await publishing.catch(()=>{});
    await writer;
    await observer.end();
  }
});
