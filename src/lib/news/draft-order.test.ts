import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { withCurrentDraftForPublish, withLeadDraftLock } from "./draft-order.server.ts";
import type { DraftRow } from "./types.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";

// U18a-1: this file needs the migrated schema. scripts/run-tests-safe.mjs
// applies migrations/*.sql before the file loads; the postgres-integration
// runner runs the same file WITHOUT that preload, so the fixture asks for it
// itself -- through the one shared applier, which does nothing at all when
// the ledger is already full and applies the whole set when it is empty.
await applyMigrationsToTestPglite();
it("a replacement draft landing after the publish read prevents stale publication", async () => {
  const sql = await getSql();
  // U18a-1: these are the real `leads`, `drafts` and `articles` now --
  // `migrations/*.sql` is applied before this file loads -- so the three
  // hand-written fixtures are gone. The inserts carry the columns the real
  // tables require, they file under a section their newsroom really has
  // (0045's trigger refuses one it does not), and the article reads are scoped
  // to this test's own newsroom so they do not count the welcome article
  // migrations/0002_newsroom.sql seeds.
  await sql.query(`insert into leads (id,newsroom_id,user_id,headline,why,topic) values(501,81,'draft-order','Council vote','Fixture','council') on conflict (id) do nothing`);
  await sql.query(`insert into drafts(lead_id,newsroom_id,user_id,headline,dek,body,topic,source_urls,updated_at) values(501,81,'draft-order','Original','','Draft A','council','[]','2026-09-07T01:00:00Z')`);
  const [readBeforePause] = await sql<DraftRow>`select * from drafts where lead_id=501 order by updated_at desc,id desc limit 1`;
  // Real second commit interleaves between the page's read and publish transaction.
  await sql.query(`insert into drafts(lead_id,newsroom_id,user_id,headline,dek,body,topic,source_urls,updated_at) values(501,81,'draft-order','Replacement','','Draft B','council','[]','2026-09-07T02:00:00Z')`);
  await assert.rejects(withCurrentDraftForPublish({newsroomId:81},501,readBeforePause, async tx => {
    await tx`insert into articles(newsroom_id,user_id,slug,headline,body,topic) values(81,'draft-order','draft-order-a','Council vote',${readBeforePause.body},'council')`;
  }), /draft changed/i);
  const [count] = await sql<{n:number}>`select count(*)::integer as n from articles where newsroom_id=81`;
  assert.equal(count.n,0);
  const [latest] = await sql<DraftRow>`select * from drafts where lead_id=501 order by updated_at desc,id desc limit 1`;
  let lateDraft: Promise<unknown> | undefined;
  await withCurrentDraftForPublish({newsroomId:81},501,latest,async tx => {
    // A reporting worker finishes while publication holds the shared lead fence.
    lateDraft=withLeadDraftLock({newsroomId:81},501,async worker => {
      await worker`insert into drafts(lead_id,newsroom_id,user_id,headline,body,topic,updated_at) values(501,81,'draft-order','Late','Late draft C','council',now())`;
    });
    // Attach rejection handling immediately; its outcome is asserted after commit.
    void lateDraft.catch(()=>{});
    await tx`insert into articles(newsroom_id,user_id,slug,headline,body,topic) values(81,'draft-order','draft-order-b','Council vote',${latest.body},'council')`;
    await tx`update leads set status='published' where id=501`;
  });
  assert.ok(lateDraft);
  await assert.rejects(lateDraft,/already been published/);
  const articles=await sql<{body:string}>`select body from articles where newsroom_id=81`;
  assert.deepEqual(articles.map(a=>a.body),['Draft B']);
  const [draftCount]=await sql<{n:number}>`select count(*)::integer as n from drafts`;
  assert.equal(draftCount.n,2);
});
