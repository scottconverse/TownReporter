import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  feat-publish-all (Nov 15 2026): the per-story loop behind the Drafts screen's
  "Publish all drafts" button.

  The one behaviour that cannot be proven without a database is the loop
  itself: two stories go in, the printable one prints, the unprintable one
  comes back as a HARD refusal, and the first is still on the paper. A batch
  that rolled back, or that stopped at the first refusal, would strand the
  editor's finished work -- which is the whole reason the button exists.

  Loaded through Vite and the real (PGlite) schema, exactly as
  `empty-dek-gate.test.ts` loads `performPublish`, so the gates that decide the
  print are the real ones.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublishAllDrafts: typeof import("./desk.ts").performPublishAllDrafts;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublishAllDrafts } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98471;
const USER = "publish-all-editor";

async function reset() {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
}

/**
 * One lead with one draft, filed the way `fileLead` files one: a confirmed
 * section (`topic_unchosen` false) and a completed evidence check for this
 * body, so the gates under test are the ones the story's own words raise.
 */
async function addStory(headline: string, body: string) {
  const sql = await getSql();
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,$3,'Why','council','new','[]','',1,'{}',false) returning id",
    [USER, NEWSROOM, headline],
  );
  await sql.query(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,$4,'The council met on Tuesday.',$5,'council','[]','','[]','news','[]','[]',$6)",
    [
      USER,
      NEWSROOM,
      lead.id,
      headline,
      body,
      JSON.stringify({
        aiEvidenceReview: { checkedText: body, rows: [] },
        evidenceReconciledAt: "2026-10-10T02:20:39.040Z",
      }),
    ],
  );
  return lead.id;
}

it("prints the printable story and reports the empty one as a hard refusal", async () => {
  await reset();
  const printable = await addStory(
    "Council approves the budget",
    "The council approved the budget on Tuesday night after a short debate.",
  );
  const empty = await addStory("Second story filed with no body", "");

  const results = await performPublishAllDrafts({ userId: USER, newsroomId: NEWSROOM }, [
    { leadId: printable, topic: "council" },
    { leadId: empty, topic: "council" },
  ]);

  assert.equal(results.length, 2, "one answer per story, in the order given");
  const [first, second] = results;
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.headline, "Council approves the budget");
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.hard, "body");
    assert.match(second.error, /body is empty/i);
  }

  // The first story really printed, and the second really did not.
  const sql = await getSql();
  const [article] = await sql.query<{ slug: string; status: string }>(
    "select slug, status from articles where lead_id=$1",
    [printable],
  );
  assert.equal(article?.status, "published");
  assert.equal(first.ok && first.slug, article.slug);
  assert.equal(
    (await sql.query("select id from articles where lead_id=$1", [empty])).length,
    0,
  );
});

it("keeps printing after a story that cannot be found", async () => {
  await reset();
  const printable = await addStory(
    "Council approves the budget",
    "The council approved the budget on Tuesday night after a short debate.",
  );

  const results = await performPublishAllDrafts({ userId: USER, newsroomId: NEWSROOM }, [
    { leadId: 2_000_000_001, topic: "council" },
    { leadId: printable, topic: "council" },
  ]);

  assert.equal(results[0].ok, false);
  if (!results[0].ok) assert.match(results[0].error, /not found/i);
  assert.equal(results[1].ok, true, JSON.stringify(results[1]));
});

it("one press publishes past a soft warning, but only when the press accepts warnings (Nov 17 2026)", async () => {
  /*
    Scott: "when i click publish all drafts, it does nothing ... why is it
    there if it doesn't publish all drafts". His one draft carried a warning
    the batch did not acknowledge, so the server refused it. The press now
    accepts every soft warning; without the flag the old refusal still holds.
  */
  await reset();
  const lead = await addStory(
    "Council approves the budget",
    "The council approved the budget on Tuesday night after a short debate.",
  );
  const sql = await getSql();
  await sql.query("update drafts set dek='' where lead_id=$1", [lead]);

  const [refused] = await performPublishAllDrafts({ userId: USER, newsroomId: NEWSROOM }, [
    { leadId: lead, topic: "council" },
  ]);
  assert.equal(refused.ok, false, "without the flag a soft warning still refuses");
  if (!refused.ok) {
    assert.equal(refused.hard, undefined);
    assert.ok((refused.warnings ?? []).some((w) => w.key === "dek"), JSON.stringify(refused));
  }

  const [printed] = await performPublishAllDrafts(
    { userId: USER, newsroomId: NEWSROOM },
    [{ leadId: lead, topic: "council" }],
    { acceptAllWarnings: true },
  );
  assert.equal(printed.ok, true, JSON.stringify(printed));
  const [article] = await sql.query<{ status: string }>(
    "select status from articles where lead_id=$1",
    [lead],
  );
  assert.equal(article?.status, "published");
});

it("accepting warnings never prints past a hard refusal", async () => {
  await reset();
  const empty = await addStory("Story filed with no body", "");
  const [result] = await performPublishAllDrafts(
    { userId: USER, newsroomId: NEWSROOM },
    [{ leadId: empty, topic: "council" }],
    { acceptAllWarnings: true },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.hard, "body");
});
