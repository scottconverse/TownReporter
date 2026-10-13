import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  THU-10: an AI-written opinion editorial that went to paper through
  "Publish anyway -- I accept these claims are unreviewed" must give the
  reader the same truthful AI line a news story gets. A piece the editor
  pasted in, with no AI, keeps no AI line. These drive the real editorial
  publish press, then read what the public story page returns.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublishEditorial: typeof import("./opinion.ts").performPublishEditorial;
let loadPublishedArticle: typeof import("./public.ts").loadPublishedArticle;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublishEditorial } = await vite.ssrLoadModule("/src/lib/news/opinion.ts"));
  ({ loadPublishedArticle } = await vite.ssrLoadModule("/src/lib/news/public.ts"));
});

after(async () => vite.close());

const NEWSROOM = 1;
const USER = "thu10-editor";
const BODY = "Longmont sits in two counties, and that matters at the ballot box.\n\nSources and claims\n";

async function fixture(pasted: boolean) {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from audit_events where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from editorial_extras where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [USER, NEWSROOM]);
  await sql.query(
    `insert into paper_settings(newsroom_id, onboarded) values($1,true)
     on conflict (newsroom_id) do update set onboarded=true`,
    [NEWSROOM],
  );
  const [draft] = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,model_body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json)
     values($1,$2,null,'Longmont sits in two counties','',$3,$4,'opinion','[]','','[]','editorial','','[]','{}') returning id`,
    [USER, NEWSROOM, BODY, pasted ? null : BODY],
  );
  await sql.query(
    "insert into editorial_extras(draft_id, newsroom_id, fact_sheet, image_prompt, source_kind, source_ref) values($1,$2,'','',$3,'')",
    [draft.id, NEWSROOM, pasted ? "written-by-the-editor" : "assignment"],
  );
  return { sql, draftId: draft.id };
}

async function publishAnyway(draftId: number) {
  const ctx = { userId: USER, newsroomId: NEWSROOM };
  const first = await performPublishEditorial(ctx, draftId, []);
  const keys = first.ok ? [] : ((first as { unacknowledged?: string[] }).unacknowledged ?? []);
  const printed = await performPublishEditorial(ctx, draftId, keys);
  assert.equal(printed.ok, true, printed.ok ? "" : String((printed as { error?: string }).error));
  return printed as { ok: true; slug: string };
}

// Scott, Oct 12 2026: no AI wording on the paper.
it("an AI editorial published over unreviewed claims carries no AI line", async () => {
  const f = await fixture(false);
  const printed = await publishAnyway(f.draftId);
  const shown = (await loadPublishedArticle(printed.slug)) as { disclosure_text?: string } | null;
  assert.ok(shown, "the public page returns the piece");
  const line = String(shown.disclosure_text ?? "");
  assert.equal(line, "");
});

it("an editorial the editor pasted in keeps no AI line", async () => {
  const f = await fixture(true);
  const printed = await publishAnyway(f.draftId);
  const shown = (await loadPublishedArticle(printed.slug)) as { disclosure_text?: string } | null;
  assert.ok(shown);
  assert.equal(String(shown.disclosure_text ?? ""), "");
});
