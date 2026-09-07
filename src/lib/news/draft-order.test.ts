import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { withCurrentDraftForPublish, withLeadDraftLock } from "./draft-order.server.ts";
import type { DraftRow } from "./types.ts";
it("a replacement draft landing after the publish read prevents stale publication", async () => {
  const sql = await getSql();
  await sql.query(`create table leads(id integer primary key, newsroom_id integer, status text)`);
  await sql.query(`create table drafts(id serial primary key, lead_id integer, newsroom_id integer, headline text, dek text, body text, topic text, source_urls text, updated_at timestamptz)`);
  await sql.query(`create table articles(id serial primary key, body text)`);
  await sql.query(`insert into leads values(501,81,'drafted')`);
  await sql.query(`insert into drafts(lead_id,newsroom_id,headline,dek,body,topic,source_urls,updated_at) values(501,81,'Original','','Draft A','community','[]','2026-09-07T01:00:00Z')`);
  const [readBeforePause] = await sql<DraftRow>`select * from drafts where lead_id=501 order by updated_at desc,id desc limit 1`;
  // Real second commit interleaves between the page's read and publish transaction.
  await sql.query(`insert into drafts(lead_id,newsroom_id,headline,dek,body,topic,source_urls,updated_at) values(501,81,'Replacement','','Draft B','community','[]','2026-09-07T02:00:00Z')`);
  await assert.rejects(withCurrentDraftForPublish({newsroomId:81},501,readBeforePause, async tx => {
    await tx`insert into articles(body) values(${readBeforePause.body})`;
  }), /draft changed/i);
  const [count] = await sql<{n:number}>`select count(*)::integer as n from articles`;
  assert.equal(count.n,0);
  const [latest] = await sql<DraftRow>`select * from drafts where lead_id=501 order by updated_at desc,id desc limit 1`;
  let lateDraft: Promise<unknown> | undefined;
  await withCurrentDraftForPublish({newsroomId:81},501,latest,async tx => {
    // A reporting worker finishes while publication holds the shared lead fence.
    lateDraft=withLeadDraftLock({newsroomId:81},501,async worker => {
      await worker`insert into drafts(lead_id,newsroom_id,body,updated_at) values(501,81,'Late draft C',now())`;
    });
    // Attach rejection handling immediately; its outcome is asserted after commit.
    void lateDraft.catch(()=>{});
    await tx`insert into articles(body) values(${latest.body})`;
    await tx`update leads set status='published' where id=501`;
  });
  assert.ok(lateDraft);
  await assert.rejects(lateDraft,/already been published/);
  const articles=await sql<{body:string}>`select body from articles`;
  assert.deepEqual(articles.map(a=>a.body),['Draft B']);
  const [draftCount]=await sql<{n:number}>`select count(*)::integer as n from drafts`;
  assert.equal(draftCount.n,2);
});
