import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  Scott, Oct. 25 2026 (Option 1): a "Today in town" story does not show the
  "Dates in this story" box; every other story keeps it. The page decides that
  from what the public story read says the story is, so this reads the story
  the way the page does and checks which routine edition (if any) it reports.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let loadPublishedArticle: typeof import("./public.ts").loadPublishedArticle;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ loadPublishedArticle } = await vite.ssrLoadModule("/src/lib/news/public.ts"));
});

after(async () => vite.close());

const NEWSROOM = 1;
const USER = "today-page-owner";

it("the public story read says which routine edition a story is, and nothing for an ordinary story", async () => {
  const sql = await getSql();
  await sql.query("delete from routine_notice_publications where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from routine_notice_runs where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query(
    `insert into paper_settings(newsroom_id, onboarded) values($1,true)
     on conflict (newsroom_id) do update set onboarded=true`,
    [NEWSROOM],
  );
  const article = async (slug: string, topic: string) => {
    const [row] = await sql.query<{ id: number }>(
      "insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at) values($1,$2,$3,$4,'','Body.',$5,'[]','published',now()) returning id",
      [USER, NEWSROOM, slug, `Story ${slug}`, topic],
    );
    return row!.id;
  };
  const [run] = await sql.query<{ id: number }>(
    "insert into routine_notice_runs(newsroom_id,local_date,automation_revision,policy_revision,status,actor) values($1,'2026-10-25',1,1,'completed',$2) returning id",
    [NEWSROOM, USER],
  );
  for (const channel of ["today", "weekend"] as const) {
    const id = await article(`routine-${channel}-2026-10-25-1`, "council");
    await sql.query(
      "insert into routine_notice_publications(newsroom_id,run_id,channel,issue_date,article_id,content_fingerprint,candidate_keys_json,article_body_hash) values($1,$2,$3,'2026-10-25',$4,'f','[]','h')",
      [NEWSROOM, run!.id, channel, id],
    );
  }
  await article("council-budget", "council");

  const channelOf = async (slug: string) =>
    ((await loadPublishedArticle(slug)) as { routine_channel?: string | null } | null)?.routine_channel;
  assert.equal(await channelOf("routine-today-2026-10-25-1"), "today");
  assert.equal(await channelOf("routine-weekend-2026-10-25-1"), "weekend");
  assert.equal(await channelOf("council-budget"), null);
});
