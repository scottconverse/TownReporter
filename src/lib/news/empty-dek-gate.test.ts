import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  Release 0.6.80 (unit CK): two stories reached the paper with `articles.dek`
  empty -- a lead-bound report filed through the paste/import path
  (`paste-one-story.ts` always files `dek: ""`) and a standalone editorial
  (`editorial.server.ts` always files `dek: ""`). Neither `performPublish`
  (desk.ts) nor `performPublishEditorial` (opinion.ts) ever required one
  before this release. These tests call the real publish paths against a
  real (PGlite) schema, the same way `topic-confirmation-gate.test.ts` does,
  so the gate is proven end to end rather than by grepping the source.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;
let performPublishEditorial: typeof import("./opinion.ts").performPublishEditorial;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performConfirmDraftTopic } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ performPublishEditorial } = await vite.ssrLoadModule("/src/lib/news/opinion.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98430;
const USER = "empty-dek-editor";

async function leadFixture(dek: string) {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,'Council approves the budget','Why','council','new','[]','',1,'{}',false) returning id",
    [USER, NEWSROOM],
  );
  await sql.query(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Council approves the budget',$4,'The council approved the budget on Tuesday night after a short debate.','council','[]','','[]','news','[]','[]',$5)",
    [
      USER,
      NEWSROOM,
      lead.id,
      dek,
      /* A completed evidence check for this body, so the zero-claims gate stays
         out of the way and the dek gate is the only variable under test. */
      JSON.stringify({
        aiEvidenceReview: { checkedText: "The council approved the budget on Tuesday night after a short debate.", rows: [] },
        evidenceReconciledAt: "2026-10-10T02:20:39.040Z",
      }),
    ],
  );
  return { leadId: lead.id };
}

async function editorialFixture(dek: string) {
  const sql = await getSql();
  await sql.query("delete from editorial_extras where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1 and form='editorial'", [NEWSROOM]);
  const body =
    "The council's new tech board gets the demo and the ordinance keeps the power.\n\n" +
    "CLAIMS AND SOURCES\n\nRecord: https://example.org/record";
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,form,research_json) values($1,$2,null,'The board keeps its promise',$3,$4,'opinion','[]','editorial','{}') returning id",
    [USER, NEWSROOM, dek, body],
  );
  return { draftId: draft.id };
}

it("refuses to publish a lead-bound draft with an empty dek", async () => {
  const { leadId } = await leadFixture("");
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "an empty dek must not print");
  assert.equal(
    "error" in published ? published.error : "",
    "Add a dek, the one-line summary under the headline, before you publish.",
  );
});

it("refuses to publish a lead-bound draft with a whitespace-only dek", async () => {
  const { leadId } = await leadFixture("   ");
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "a whitespace dek is not a dek");
  assert.match("error" in published ? published.error : "", /dek/i);
});

it("publishes a lead-bound draft once the dek is filled in and the section is confirmed", async () => {
  const { leadId } = await leadFixture("The council voted 5-2 to fund the pilot program.");
  await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, true, "error" in published ? published.error : "");
  const sql = await getSql();
  const [article] = await sql.query<{ dek: string }>("select dek from articles where lead_id=$1", [leadId]);
  assert.equal(article.dek, "The council voted 5-2 to fund the pilot program.");
});

it("refuses to publish a standalone editorial with an empty dek", async () => {
  const { draftId } = await editorialFixture("");
  const published = await performPublishEditorial({ userId: USER, newsroomId: NEWSROOM }, draftId);
  assert.equal(published.ok, false, "an empty editorial dek must not print");
  assert.equal(
    "error" in published ? published.error : "",
    "Add a dek, the one-line summary under the headline, before you publish.",
  );
});

it("publishes a standalone editorial once the dek is filled in", async () => {
  const { draftId } = await editorialFixture("The paper's position on the new tech board.");
  const published = await performPublishEditorial({ userId: USER, newsroomId: NEWSROOM }, draftId);
  assert.equal(published.ok, true, "error" in published ? published.error : "");
  const sql = await getSql();
  const [article] = await sql.query<{ dek: string }>(
    "select dek from articles where origin_draft_id=$1",
    [draftId],
  );
  assert.equal(article.dek, "The paper's position on the new tech board.");
});
