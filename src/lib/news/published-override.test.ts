import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  TWO THINGS AN EDITOR CAN NOW DO THAT THE DESK USED TO REFUSE.

  Item 7. A story that is already on the paper has a summary, a section and a
  body an editor may still need to change -- to fix a figure, refile it under
  the right section, or replace a paragraph. The headline has been changeable
  since 0.6.67 (`article-headline-history.test.ts`); the rest of the story was
  not. Changing it now writes the real `articles` row AND appends a row to the
  public change log (`corrections`), so a reader sees that the paper changed
  something rather than finding the text quietly different. The first press
  warns ("This story is live. Your change will show on the paper."); the change
  happens only when the editor accepts with `override:[key]`.

  Item 35. The named-outlet gate only knows the outlets on the newsroom's list
  (`outlet-credit.ts`). A story that names an outlet the list does not carry
  used to be impossible to override and impossible to print; the override is
  now allowed for ANY name, but never silently -- first a warning, then an
  accepted `override:[key]`, and an `override` audit row naming the key, the
  editor, the time and the target.

  These drive the real server functions against a real schema. The refusals
  that must survive (an empty body, a blank summary, a missing record, another
  newsroom's story, a job already running, a non-public link, an unknown
  section) are exercised here too, because the point of the feature is that it
  widened exactly those four changes and nothing else.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performChangePublishedStory: typeof import("./desk.ts").performChangePublishedStory;
let performOverrideNamedOutlet: typeof import("./desk.ts").performOverrideNamedOutlet;
let performRewritePublishedStory: typeof import("./desk.ts").performRewritePublishedStory;
let performDraftMeetingReview: typeof import("./desk.ts").performDraftMeetingReview;
let performReverifyPublishedStory: typeof import("./desk.ts").performReverifyPublishedStory;
let LIVE_STORY_REVERIFY_KEY: typeof import("./desk.ts").LIVE_STORY_REVERIFY_KEY;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({
    performChangePublishedStory,
    performOverrideNamedOutlet,
    performReverifyPublishedStory,
    performRewritePublishedStory,
    performDraftMeetingReview,
    LIVE_STORY_REVERIFY_KEY,
  } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98_601;
const ELSEWHERE = 98_602;
const USER = "published-override-editor";

const ctx = { userId: USER, newsroomId: NEWSROOM };

/** The shared warn-then-override answer, whatever server function produced it. */
type Warned = { ok: false; warning: { key: string; sentence: string } };

function warned(result: unknown): result is Warned {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === false &&
    "warning" in result
  );
}

async function reset() {
  const sql = await getSql();
  for (const table of [
    "article_body_history",
    "article_headline_history",
    "corrections",
    "articles",
    "desk_jobs",
    "drafts",
    "leads",
    "audit_events",
    "newsroom_members",
  ]) {
    await sql.query(`delete from ${table} where newsroom_id=$1`, [NEWSROOM]);
    await sql.query(`delete from ${table} where newsroom_id=$1`, [ELSEWHERE]);
  }
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
}

/** One printed story, optionally tied to a lead so a running job can be pinned. */
async function articleFixture(
  options: {
    slug?: string;
    dek?: string;
    body?: string;
    topic?: string;
    status?: string;
    newsroomId?: number;
    lead?: boolean;
  } = {},
) {
  const sql = await getSql();
  const room = options.newsroomId ?? NEWSROOM;
  let leadId: number | null = null;
  if (options.lead) {
    const [lead] = await sql.query<{ id: number }>(
      "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Council approves the plan','Why','council','published','[]','',1,'{}') returning id",
      [USER, room],
    );
    leadId = Number(lead.id);
  }
  const [article] = await sql.query<{ id: number }>(
    "insert into articles(newsroom_id,user_id,lead_id,slug,headline,dek,body,topic,status) values($1,$2,$3,$4,'Council approves the plan',$5,$6,$7,$8) returning id",
    [
      room,
      USER,
      leadId,
      options.slug ?? "live-story",
      options.dek ?? "The old summary.",
      options.body ?? "The council approved the plan on Tuesday.",
      options.topic ?? "council",
      options.status ?? "published",
    ],
  );
  return { articleId: Number(article.id), leadId };
}

async function article(articleId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ dek: string; body: string; topic: string }>(
    "select dek,body,topic from articles where id=$1",
    [articleId],
  );
  return row;
}

async function setArticleFields(
  articleId: number,
  fields: { body?: string; source_urls?: string[] },
) {
  const sql = await getSql();
  if (fields.body !== undefined) {
    await sql.query("update articles set body=$1 where id=$2", [fields.body, articleId]);
  }
  if (fields.source_urls !== undefined) {
    await sql.query("update articles set source_urls=$1 where id=$2", [
      JSON.stringify(fields.source_urls),
      articleId,
    ]);
  }
}

async function correctionCount() {
  const sql = await getSql();
  const [row] = await sql.query<{ count: number }>(
    "select count(*)::int as count from corrections where newsroom_id=$1",
    [NEWSROOM],
  );
  return Number(row.count);
}

async function overrideAudits() {
  const sql = await getSql();
  return sql.query<{ detail: string; user_id: string }>(
    "select detail,user_id from audit_events where newsroom_id=$1 and action='override' order by id",
    [NEWSROOM],
  );
}

/** The draft the override is scoped to: one lead, one draft, one body. */
async function outletFixture(body: string) {
  const sql = await getSql();
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Skate park opens','Why','council','new','[]','',1,'{}') returning id",
    [USER, NEWSROOM],
  );
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Skate park opens','The park opened.','The park opened Saturday.','council','[]','','[]','news','[]','[]','{}') returning id",
    [USER, NEWSROOM, lead.id],
  );
  await sql.query("update drafts set body=$1 where id=$2", [body, draft.id]);
  return { leadId: Number(lead.id), draftId: Number(draft.id) };
}

async function overrideRowsFor(draftId: number) {
  const sql = await getSql();
  return sql.query<{ outlet: string; overridden_by: string; overridden_at: string }>(
    "select outlet,overridden_by,overridden_at from named_outlet_overrides where newsroom_id=$1 and draft_id=$2 order by id",
    [NEWSROOM, draftId],
  );
}

/* ── Item 7: the summary ──────────────────────────────────────────────── */

it("warns before a live summary change, then applies it and shows it in the change log", async () => {
  await reset();
  const { articleId } = await articleFixture();

  const first = await performChangePublishedStory(ctx, { articleId, dek: "A new summary." });
  assert.equal(first.ok, false);
  assert.ok(warned(first), "the first press must warn rather than change the paper");
  assert.equal(first.warning.sentence, "This story is live. Your change will show on the paper.");

  assert.equal(
    (await article(articleId)).dek,
    "The old summary.",
    "nothing changes before the editor accepts",
  );
  assert.equal(await correctionCount(), 0, "the change log is written only on acceptance");
  assert.equal((await overrideAudits()).length, 0, "no override is audited before it is accepted");

  const second = await performChangePublishedStory(ctx, {
    articleId,
    dek: "A new summary.",
    override: [first.warning.key],
  });
  assert.equal(second.ok, true);
  assert.equal(
    (await article(articleId)).dek,
    "A new summary.",
    "the printed summary really changed",
  );

  const sql = await getSql();
  const corrections = await sql.query<{ body: string; article_id: number }>(
    "select body,article_id from corrections where newsroom_id=$1",
    [NEWSROOM],
  );
  assert.equal(corrections.length, 1, "the public change log must see the change");
  assert.equal(Number(corrections[0].article_id), articleId);
  assert.match(corrections[0].body, /summary/i);

  const audits = await overrideAudits();
  assert.equal(audits.length, 1, "accepting the override is on the record");
  assert.equal(audits[0].user_id, USER);
  assert.equal(JSON.parse(audits[0].detail).key, first.warning.key);
  assert.deepEqual(JSON.parse(audits[0].detail).target, { kind: "articles", id: articleId });

  // A second press of the same text is not a second decision.
  await performChangePublishedStory(ctx, {
    articleId,
    dek: "A new summary.",
    override: [first.warning.key],
  });
  assert.equal(await correctionCount(), 1, "saving identical text writes nothing again");
});

/* ── Item 7: the section and the body ─────────────────────────────────── */

it("changes the live section and records it", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const first = await performChangePublishedStory(ctx, { articleId, topic: "schools" });
  assert.ok(warned(first));
  const second = await performChangePublishedStory(ctx, {
    articleId,
    topic: "schools",
    override: [first.warning.key],
  });
  assert.equal(second.ok, true);
  assert.equal((await article(articleId)).topic, "schools");
  assert.equal(await correctionCount(), 1);
});

it("rewrites the live body and keeps the text it replaced on the record", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const first = await performChangePublishedStory(ctx, {
    articleId,
    body: "The council approved the plan on Wednesday.",
  });
  assert.ok(warned(first));
  const second = await performChangePublishedStory(ctx, {
    articleId,
    body: "The council approved the plan on Wednesday.",
    override: [first.warning.key],
  });
  assert.equal(second.ok, true);
  assert.equal((await article(articleId)).body, "The council approved the plan on Wednesday.");

  const sql = await getSql();
  const [history] = await sql.query<{
    old_body: string;
    new_body: string;
    changed_by: string;
    correction_id: number;
  }>(
    "select old_body,new_body,changed_by,correction_id from article_body_history where article_id=$1",
    [articleId],
  );
  assert.equal(history.old_body, "The council approved the plan on Tuesday.");
  assert.equal(history.new_body, "The council approved the plan on Wednesday.");
  assert.equal(history.changed_by, USER);
  const [correction] = await sql.query<{ id: number }>(
    "select id from corrections where newsroom_id=$1",
    [NEWSROOM],
  );
  assert.equal(
    Number(history.correction_id),
    Number(correction.id),
    "the history and the change log are one act",
  );
});

it("applies a summary, a section and a body in one accepted act", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const first = await performChangePublishedStory(ctx, {
    articleId,
    dek: "The approved plan.",
    topic: "budget",
    body: "The council approved the $2.4M plan on Tuesday.",
  });
  assert.ok(warned(first));
  const second = await performChangePublishedStory(ctx, {
    articleId,
    dek: "The approved plan.",
    topic: "budget",
    body: "The council approved the $2.4M plan on Tuesday.",
    override: [first.warning.key],
  });
  assert.equal(second.ok, true);
  const row = await article(articleId);
  assert.equal(row.dek, "The approved plan.");
  assert.equal(row.topic, "budget");
  assert.equal(row.body, "The council approved the $2.4M plan on Tuesday.");
  assert.equal(await correctionCount(), 1, "three changes to one story are one change-log entry");
});

/* ── The refusals this feature must NOT widen ─────────────────────────── */

it("KEEP: refuses an empty body even with the override", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const first = await performChangePublishedStory(ctx, { articleId, body: "x" });
  assert.ok(warned(first));
  const result = await performChangePublishedStory(ctx, {
    articleId,
    body: "   ",
    override: [first.warning.key],
  });
  assert.equal(result.ok, false);
  assert.ok(!("warning" in result));
  assert.equal((await article(articleId)).body, "The council approved the plan on Tuesday.");
  assert.equal(await correctionCount(), 0);
});

/*
  A blank summary is NOT on the KEEP list (coordinator, item 7): only the empty
  headline and body are. Clearing a dek on a live story is a real decision, and
  it goes through the same warning as any other.
*/
it("clears a live summary once the editor accepts, and says so in the change log", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const first = await performChangePublishedStory(ctx, { articleId, dek: "" });
  assert.ok(warned(first), "clearing the summary is still a change to the live paper");
  assert.equal((await article(articleId)).dek, "The old summary.");
  const second = await performChangePublishedStory(ctx, {
    articleId,
    dek: "",
    override: [first.warning.key],
  });
  assert.equal(second.ok, true);
  assert.equal((await article(articleId)).dek, "", "the summary was cleared");
  assert.equal(await correctionCount(), 1);
});

it("KEEP: refuses a missing record, another newsroom's story and a story not on the paper", async () => {
  await reset();
  const missing = await performChangePublishedStory(ctx, {
    articleId: 9_999_999,
    dek: "A new summary.",
  });
  assert.equal(missing.ok, false);
  assert.ok(
    warned(missing) === false,
    "a missing record is a refusal, not a warning to click through",
  );

  const other = await articleFixture({ newsroomId: ELSEWHERE, slug: "elsewhere-story" });
  const refused = await performChangePublishedStory(ctx, {
    articleId: other.articleId,
    dek: "A new summary.",
  });
  assert.equal(refused.ok, false);
  assert.ok(warned(refused) === false);

  const draft = await articleFixture({ slug: "not-printed", status: "draft" });
  const notPrinted = await performChangePublishedStory(ctx, {
    articleId: draft.articleId,
    dek: "A new summary.",
  });
  assert.equal(notPrinted.ok, false);
});

it("KEEP: refuses while a job is already running for the story", async () => {
  await reset();
  const { articleId, leadId } = await articleFixture({ lead: true });
  const sql = await getSql();
  await sql.query(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,status) values($1,$2,'draft',$3,'running')",
    [NEWSROOM, USER, leadId],
  );
  const result = await performChangePublishedStory(ctx, {
    articleId,
    dek: "A new summary.",
    override: ["published-live-change"],
  });
  assert.equal(result.ok, false, "an edit must not race the model that is rewriting the story");
  assert.equal((await article(articleId)).dek, "The old summary.");
});

/*
  KEEP: the non-public-URL (SSRF) guard is the INGEST path's, where a URL is
  actually fetched, and this change leaves it exactly where it is. A live rewrite
  is text an editor typed, not a fetch, so it does not invent a new link policy
  (coordinator, live review): an ordinary cited link saves, and the guard that
  refuses 127.0.0.1 still refuses it.
*/
it("KEEP: leaves the non-public-URL guard where it lives, and does not block a cited link", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const cited = "The plan is attached: https://example-city.test/packet.pdf.";
  const first = await performChangePublishedStory(ctx, { articleId, body: cited });
  assert.ok(warned(first));
  const second = await performChangePublishedStory(ctx, {
    articleId,
    body: cited,
    override: [first.warning.key],
  });
  assert.equal(second.ok, true, "an ordinary cited link is the editor's text, not a fetch");
  assert.equal(
    (await article(articleId)).body,
    cited,
    "the link is stored verbatim, not rewritten",
  );

  const { assertHttpUrl } = await vite.ssrLoadModule("/src/lib/news/url-guard.ts");
  assert.throws(() => assertHttpUrl("http://127.0.0.1/secret"), /fetchable/);
});

it("KEEP: refuses a section this newsroom does not file under", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const result = await performChangePublishedStory(ctx, { articleId, topic: "no-such-section" });
  assert.equal(result.ok, false);
  assert.ok(
    !warned(result),
    "there is no live change to warn about: the section does not exist here",
  );
  assert.equal((await article(articleId)).topic, "council");
});

/* ── Item 7: re-verifying the live text ───────────────────────────────── */

it("warns before re-checking a live story, then records the check and the acceptance", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const first = await performReverifyPublishedStory(ctx, { articleId });
  assert.equal(first.ok, false);
  assert.ok(warned(first), "re-checking the paper warns before it records anything");
  assert.equal((await overrideAudits()).length, 0, "nothing is audited before the editor accepts");

  const second = await performReverifyPublishedStory(
    ctx,
    {
      articleId,
      override: [first.warning.key],
    },
    { chat: async () => ({ ok: true, text: JSON.stringify({ rows: [] }) }) },
  );
  assert.equal(second.ok, true);
  const sql = await getSql();
  const recheck = await sql.query<{ action: string; detail: string }>(
    "select action,detail from audit_events where newsroom_id=$1 and action='reverify_published_story'",
    [NEWSROOM],
  );
  assert.equal(recheck.length, 1, "the check is on the record");
  const audits = await overrideAudits();
  assert.equal(audits.length, 1, "accepting the warning is audited");
  assert.equal(JSON.parse(audits[0].detail).key, first.warning.key);
  assert.equal(
    await correctionCount(),
    0,
    "a check that changes no reader-visible byte writes no public change-log row",
  );
});

it("re-checking a live story refers to the text on the paper, not the draft", async () => {
  await reset();
  const { articleId } = await articleFixture();
  await setArticleFields(articleId, { body: "The Denver Post reported the grant was in doubt." });
  let checked = "";
  const result = await performReverifyPublishedStory(
    ctx,
    { articleId, override: [LIVE_STORY_REVERIFY_KEY] },
    {
      chat: async (_system, prompt) => {
        checked = prompt;
        return { ok: true, text: '{"rows":[]}' };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.match(checked, /Denver Post/);
  if (result.ok) {
    assert.match(result.review.checkedText, /Denver Post/);
    assert.equal(result.review.rows[0].verdict, "Needs a human");
  }
});

it("KEEP: re-checking refuses a missing record and a story not on the paper", async () => {
  await reset();
  const missing = await performReverifyPublishedStory(ctx, { articleId: 9_999_999 });
  assert.equal(missing.ok, false);
  assert.ok(!warned(missing));

  const notPrinted = await articleFixture({ slug: "not-printed-check", status: "draft" });
  const result = await performReverifyPublishedStory(ctx, { articleId: notPrinted.articleId });
  assert.equal(result.ok, false);
  assert.ok(!warned(result));
});

/* ── Item 35: the named-outlet override for an unknown outlet ─────────── */

it("lets an editor override an outlet the check does not know, after a warning, and records it", async () => {
  await reset();
  const { leadId, draftId } = await outletFixture("The Niwot Tribune reported the vote.");

  const first = await performOverrideNamedOutlet(ctx, leadId, "Niwot Tribune");
  assert.equal(first.ok, false);
  assert.ok(warned(first), "an unknown outlet must warn rather than refuse or record");
  assert.match(first.warning.sentence, /Niwot Tribune/);
  assert.equal(
    (await overrideRowsFor(draftId)).length,
    0,
    "nothing is recorded before the editor accepts",
  );

  const second = await performOverrideNamedOutlet(ctx, leadId, "Niwot Tribune", {
    override: [first.warning.key],
  });
  assert.equal(second.ok, true);
  const rows = await overrideRowsFor(draftId);
  assert.equal(rows.length, 1, "the accepted decision is the paper's record");
  assert.equal(rows[0].outlet, "Niwot Tribune");
  assert.equal(rows[0].overridden_by, USER);
  assert.ok(rows[0].overridden_at, "the record must carry a time");

  const audits = await overrideAudits();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].user_id, USER);
  assert.equal(JSON.parse(audits[0].detail).key, first.warning.key);
  assert.deepEqual(JSON.parse(audits[0].detail).target, { kind: "drafts", id: draftId });
});

it("a known outlet retains its existing direct override", async () => {
  await reset();
  const { leadId, draftId } = await outletFixture(
    "The Denver Post reported the grant was in doubt.",
  );
  const result = await performOverrideNamedOutlet(ctx, leadId, "Denver Post");
  assert.equal(result.ok, true);
  const rows = await overrideRowsFor(draftId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outlet, "Denver Post");
});

it("allows any named-outlet decision after the editor accepts its warning", async () => {
  await reset();
  const { leadId, draftId } = await outletFixture("The council approved the skate park.");
  const result = await performOverrideNamedOutlet(ctx, leadId, "Niwot Tribune", {
    override: ["named-outlet:Niwot Tribune"],
  });
  assert.equal(result.ok, true, "any outlet name can be overridden");
  assert.equal((await overrideRowsFor(draftId)).length, 1);
});

it("refuses an unknown-outlet override when there is no draft", async () => {
  await reset();
  const result = await performOverrideNamedOutlet(ctx, 9_999_999, "Niwot Tribune", {
    override: ["named-outlet:Niwot Tribune"],
  });
  assert.equal(result.ok, false);
});

it("live rewrite warns without calling the model, then updates the printed body, history and audit", async () => {
  await reset();
  const { articleId, leadId } = await articleFixture({ lead: true });
  let calls = 0;
  const deps = {
    chat: async () => {
      calls++;
      return { ok: true as const, text: JSON.stringify({ body: "The rewritten live story." }) };
    },
  };
  const first = await performRewritePublishedStory(ctx, { articleId }, deps);
  assert.ok(warned(first));
  assert.equal(calls, 0);
  const result = await performRewritePublishedStory(
    ctx,
    { articleId, override: [first.warning.key] },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal((await article(articleId)).body, "The rewritten live story.");
  assert.equal(await correctionCount(), 1);
  assert.equal((await overrideAudits()).length, 1);
  const sql = await getSql();
  const leads = await sql.query<{ status: string }>("select status from leads where id=$1", [
    leadId,
  ]);
  assert.equal(leads[0].status, "published");
});

it("KEEP: legal removal refuses live changes, rewrite and re-verification even with overrides", async () => {
  await reset();
  const { articleId } = await articleFixture();
  const sql = await getSql();
  await sql.query(
    "insert into legal_removals(id,newsroom_id,requested_by,case_ref,policy) values('override-legal',$1,$2,'case','retain')",
    [NEWSROOM, USER],
  );
  await sql.query(
    "insert into legal_removal_targets(newsroom_id,table_name,row_id,case_id) values($1,'articles',$2,'override-legal')",
    [NEWSROOM, articleId],
  );
  const input = {
    articleId,
    body: "Changed story.",
    override: ["published-live-change", "published-live-reverify"],
  };
  try {
    for (const action of [
      performChangePublishedStory,
      performRewritePublishedStory,
      performReverifyPublishedStory,
    ]) {
      const result = await action(ctx, input);
      assert.equal(result.ok, false);
      assert.ok("error" in result);
      if ("error" in result) assert.match(result.error, /legal removal/);
    }
    assert.equal(await correctionCount(), 0);
    assert.equal((await overrideAudits()).length, 0);
  } finally {
    await sql.query("delete from legal_removal_targets where case_id='override-legal'");
    await sql.query("delete from legal_removals where id='override-legal'");
  }
});

it("live meeting citation review warns, then calls the existing review routine with the editor's decisions", async () => {
  await reset();
  const { articleId, leadId } = await articleFixture({ lead: true });
  const input = {
    leadId: leadId!,
    draftId: 42,
    evidenceToken: "current-token",
    acceptedArtifactId: 9,
    confirmedSegmentIndexes: [1, 3],
    note: "I compared these passages.",
  };
  let calls = 0;
  const deps = {
    record: async (
      _sql: unknown,
      decision: { confirmedSegmentIndexes: number[]; note: string; reviewerId: string },
    ) => {
      calls++;
      assert.deepEqual(decision.confirmedSegmentIndexes, input.confirmedSegmentIndexes);
      assert.equal(decision.note, input.note);
      assert.equal(decision.reviewerId, USER);
      return {
        reviewId: 1,
        acceptedArtifactSha256: "checked-sha",
        reviewedAt: "2026-10-10T00:00:00Z",
      };
    },
  };
  const first = await performDraftMeetingReview(ctx, input, deps);
  assert.ok(warned(first));
  assert.equal(calls, 0);
  const result = await performDraftMeetingReview(
    ctx,
    { ...input, override: [first.warning.key] },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  const audits = await overrideAudits();
  assert.equal(audits.length, 1);
  assert.equal(JSON.parse(audits[0].detail).target.id, articleId);
});

it("records a live rewrite override even when the model returns the existing text", async () => {
  await reset();
  const {articleId} = await articleFixture();
  const body = (await article(articleId)).body;
  const result = await performRewritePublishedStory(ctx, {articleId, override: ["published-live-change"]},
    {chat: async () => ({ok: true, text: JSON.stringify({body})})});
  assert.equal(result.ok, true);
  assert.equal(await correctionCount(), 0);
  assert.equal((await overrideAudits()).length, 1);
});
