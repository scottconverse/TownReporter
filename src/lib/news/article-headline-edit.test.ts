import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  A headline is the editor's word, and until this release there was no way to
  change one after a story printed: `articles.headline` was written once, at
  publish, and the story page's input is disabled for a lead on paper. A typo or
  a better verb needed a developer and a SQL prompt.

  These drive the real write path rather than the pure rules (those are in
  headline-control.test.ts). Four things have to hold together, and each is a
  separate way the press could go wrong:

    1. The WORDS change and nothing else -- `articles.slug` is untouched, which
       is what keeps every link, share and open tab working.
    2. The change is ON THE RECORD: the old headline, who did it and when, in
       `article_headline_history` (migration 0093), append-only.
    3. A SECOND PRESS of Save is not a second decision. It must not leave a row
       saying the headline was rewritten when it was not.
    4. The refusals refuse WITHOUT writing: another paper's story, a story that
       has not printed, and a blank headline.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performUpdateArticleHeadline: typeof import("./desk.ts").performUpdateArticleHeadline;
let performSuggestHeadlines: typeof import("./desk.ts").performSuggestHeadlines;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performUpdateArticleHeadline, performSuggestHeadlines } = await vite.ssrLoadModule(
    "/src/lib/news/desk.ts",
  ));
});

after(async () => vite.close());

const NEWSROOM = 98_613;
const ELSEWHERE = 98_614;
const USER = "headline-edit-editor";
const PRINTED = "Council approves the plan";

/** An empty desk and this editor on the masthead. Once per test, not per article. */
async function reset() {
  const sql = await getSql();
  await sql.query("delete from article_headline_history where newsroom_id in ($1,$2)", [
    NEWSROOM,
    ELSEWHERE,
  ]);
  await sql.query("delete from articles where newsroom_id in ($1,$2)", [NEWSROOM, ELSEWHERE]);
  await sql.query("delete from audit_events where newsroom_id in ($1,$2)", [NEWSROOM, ELSEWHERE]);
  await sql.query("delete from newsroom_members where newsroom_id in ($1,$2)", [NEWSROOM, ELSEWHERE]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
}

/** One story, filed under a section this newsroom has. */
async function fixture(options: { status?: string; headline?: string; slug?: string } = {}) {
  const sql = await getSql();
  // `topic` is not decoration: the articles trigger resolve_story_section()
  // refuses a row whose section this newsroom does not have (0045), and seeds
  // its own default sections the first time a newsroom files anything.
  const [article] = await sql.query<{ id: number }>(
    "insert into articles(newsroom_id,user_id,slug,headline,status,topic,body) values($1,$2,$3,$4,$5,'council','The council approved the plan on Tuesday.') returning id",
    [
      NEWSROOM,
      USER,
      options.slug ?? "headline-edit-fixture",
      options.headline ?? PRINTED,
      options.status ?? "published",
    ],
  );
  return { articleId: article.id };
}

async function historyFor(articleId: number) {
  const sql = await getSql();
  return sql.query<{ old_headline: string; new_headline: string; changed_by: string }>(
    "select old_headline, new_headline, changed_by from article_headline_history where article_id=$1 order by id asc",
    [articleId],
  );
}

it("changes the printed words, keeps the slug, and records who changed it from what", async () => {
  await reset();
  const { articleId } = await fixture();

  const result = await performUpdateArticleHeadline(
    { userId: USER, newsroomId: NEWSROOM },
    articleId,
    "Council approves the plan, with one change",
  );
  assert.deepEqual(result, {
    ok: true,
    headline: "Council approves the plan, with one change",
  });

  const sql = await getSql();
  const [row] = await sql.query<{ headline: string; slug: string }>(
    "select headline, slug from articles where id=$1",
    [articleId],
  );
  assert.equal(row.headline, "Council approves the plan, with one change");
  assert.equal(row.slug, "headline-edit-fixture", "the slug must not move, or every link breaks");

  const history = await historyFor(articleId);
  assert.equal(history.length, 1, "one edit is one record");
  assert.deepEqual(
    {
      old: history[0].old_headline,
      next: history[0].new_headline,
      who: history[0].changed_by,
    },
    {
      old: PRINTED,
      next: "Council approves the plan, with one change",
      who: USER,
    },
    "the record must name the words before, the words after, and the account",
  );

  const audits = await sql.query<{ id: number }>(
    "select id from audit_events where user_id=$1 and newsroom_id=$2 and action='edit_headline'",
    [USER, NEWSROOM],
  );
  assert.equal(audits.length, 1, "the action log carries the change too");
});

it("does not record a second row when the second press changes nothing", async () => {
  await reset();
  const { articleId } = await fixture({ headline: "The pool will open in June" });

  const first = await performUpdateArticleHeadline(
    { userId: USER, newsroomId: NEWSROOM },
    articleId,
    "The pool opens in June",
  );
  assert.equal(first.ok, true);

  // The editor presses Save again with the same words in the box, which is what
  // a reload-and-press looks like: not a decision, and not a record.
  const second = await performUpdateArticleHeadline(
    { userId: USER, newsroomId: NEWSROOM },
    articleId,
    "  The pool opens in June  ",
  );
  assert.deepEqual(second, { ok: true, headline: "The pool opens in June" });

  const history = await historyFor(articleId);
  assert.equal(history.length, 1, "an unchanged press must not claim the headline was rewritten");
});

it("refuses a blank headline, an unprinted story and another paper's story, without writing", async () => {
  await reset();
  const printed = await fixture();
  const unprinted = await fixture({ status: "draft", slug: "headline-edit-draft" });

  const blank = await performUpdateArticleHeadline(
    { userId: USER, newsroomId: NEWSROOM },
    printed.articleId,
    "   ",
  );
  assert.equal(blank.ok, false);
  assert.match(
    blank.ok === false ? blank.error : "",
    /headline cannot be blank/i,
    "a blank headline must be refused in a sentence an editor can act on",
  );

  const notOnPaper = await performUpdateArticleHeadline(
    { userId: USER, newsroomId: NEWSROOM },
    unprinted.articleId,
    "A headline that will not be written",
  );
  assert.equal(notOnPaper.ok, false, "a story that has not printed is edited in the workbench");

  const foreign = await performUpdateArticleHeadline(
    { userId: USER, newsroomId: ELSEWHERE },
    printed.articleId,
    "A headline that will not be written",
  );
  assert.equal(foreign.ok, false, "another paper's story is not this editor's to re-head");

  const sql = await getSql();
  const [row] = await sql.query<{ headline: string }>(
    "select headline from articles where id=$1",
    [printed.articleId],
  );
  assert.equal(row.headline, PRINTED, "a refused press must not write");
  assert.equal((await historyFor(printed.articleId)).length, 0, "a refused press must not record");
});

it("says so in a sentence, without offering an option, when the lead does not exist", async () => {
  /*
    The suggestions path asks the story model for three headlines and changes
    nothing on its own. The guard that matters most is the first one: a lead
    that is not this paper's must come back as the desk's own sentence rather
    than as a model call about somebody else's story (or a thrown error, which
    on the desk reads as a blank screen).
  */
  const result = await performSuggestHeadlines({ userId: USER, newsroomId: NEWSROOM }, 987_654_321);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : "", /lead not found/i);
});
