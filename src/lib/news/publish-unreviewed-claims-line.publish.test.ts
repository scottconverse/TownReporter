import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  THT-17: the reader's AI line on a piece that went to paper through "Publish
  anyway -- I accept these claims are unreviewed".

  An editor who overrode unreviewed claims did not approve the story, so the
  public page must not say "An editor approved this story for publication."
  These drive the real accept and publish presses, then read the line the
  public story page returns -- the line only counts once a reader can see it.
  The paper's own newsroom (id 1) is used because the public reader is bound
  to it.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performAcceptUnreviewedClaims: typeof import("./desk.ts").performAcceptUnreviewedClaims;
let loadPublishedArticle: typeof import("./public.ts").loadPublishedArticle;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performAcceptUnreviewedClaims } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ loadPublishedArticle } = await vite.ssrLoadModule("/src/lib/news/public.ts"));
});

after(async () => vite.close());

const NEWSROOM = 1;
const USER = "tht17-editor";
const BODY = "The council adopted the budget after a short debate.";

/** A model-written draft with one unreviewed claim, so the claims gate is all that is outstanding. */
async function fixture(withClaim: boolean) {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from audit_events where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from artifact_versions where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [USER, NEWSROOM]);
  await sql.query(
    `insert into paper_settings(newsroom_id, onboarded) values($1,true)
     on conflict (newsroom_id) do update set onboarded=true`,
    [NEWSROOM],
  );
  const url = "https://records.example/tht17";
  const [capture] = await sql.query<{ id: number }>(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'tht17','Council record','The adopted budget message sets the 2027 operating budget at $547.5 million.') returning id",
    [USER, NEWSROOM, url],
  );
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Council adopts the budget','Why','council','drafted',$3,'',1,'{}') returning id",
    [USER, NEWSROOM, JSON.stringify([url])],
  );
  const claims = withClaim
    ? [{
        text: "The 2027 operating budget is $547.5 million.",
        source_urls: [url],
        capture_event_ids: [],
        artifact_version_ids: [capture.id],
        locators: ["Budget message, page 1"],
        excerpt: "$547.5 million operating budget",
      }]
    : [];
  const [draft] = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,model_body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json)
     values($1,$2,$3,'Council adopts the budget','The 5-2 vote funds the plan.',$4,$4,'council',$5,'','[]','news',$6,'[]','{}') returning id`,
    [USER, NEWSROOM, lead.id, BODY, JSON.stringify([url]), JSON.stringify(claims)],
  );
  return { sql, leadId: lead.id, draftId: draft.id };
}

async function publicLine(sql: Awaited<ReturnType<typeof getSql>>, leadId: number): Promise<string> {
  const [article] = await sql.query<{ slug: string }>("select slug from articles where lead_id=$1", [leadId]);
  assert.ok(article, "the piece reached the paper");
  const shown = await loadPublishedArticle(article.slug);
  assert.ok(shown, "the public story page returns the piece");
  return String((shown as { disclosure_text?: string }).disclosure_text ?? "");
}

// Scott, Oct 12 2026: no AI wording on the paper.
it("a piece published over accepted unreviewed claims carries no AI line", async () => {
  const f = await fixture(true);
  const ctx = { userId: USER, newsroomId: NEWSROOM };
  const { loadFindingEvidenceReview } = await vite.ssrLoadModule("/src/lib/news/finding-evidence-review.ts");
  const token = (await loadFindingEvidenceReview(f.sql, NEWSROOM, f.leadId)).evidenceToken;
  const accepted = await performAcceptUnreviewedClaims(ctx, f.leadId, token);
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
  const printed = await performPublish(ctx, f.leadId, "council");
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);

  const line = await publicLine(f.sql, f.leadId);
  assert.equal(line, "");
});

it("a piece with nothing unreviewed carries no AI line", async () => {
  const f = await fixture(false);
  const ctx = { userId: USER, newsroomId: NEWSROOM };
  const printed = await performPublish(ctx, f.leadId, "council", undefined, {}, ["unchecked"]);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
  const line = await publicLine(f.sql, f.leadId);
  assert.equal(line, "");
});
