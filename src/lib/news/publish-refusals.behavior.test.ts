import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  Two of `performPublish`'s refusals had no test that would notice their
  removal.

  The claims-of-absence gate (`desk.ts`, "FAIL CLOSED ON A CLAIM OF ABSENCE")
  was covered only by `scripts/claims-of-absence-gate.test.mjs`, which greps
  the source text of desk.ts for the branch -- a regex over the file still
  matches when the condition is short-circuited to `false`, so the branch could
  be deleted and every test stayed green. The section-mismatch refusal
  (`sectionFromEditor` naming a section the draft does not file under) had no
  test at all.

  These call the real `performPublish` against a real (PGlite) schema, the way
  `empty-dek-gate.test.ts` and `topic-confirmation-gate.test.ts` do, and assert
  both the refusal and the fact that a refused publish leaves no article
  behind. A refusal that still writes the row is not a refusal.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performConfirmDraftTopic } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98440;
const USER = "publish-refusal-editor";

/*
  The shape the gate itself writes into `leads.notes_json` (see notes.ts):
  a to-do whose `src` is "gate" is a claim of absence the desk raised, and an
  unchecked one blocks the print. `q` carries the ladder's summary, which is
  what the editor reads before ticking the box.
*/
const GATE_QUERY =
  "TownReporter searched longmontcolorado.gov and 2 more ways and found nothing. " +
  "Confirm you checked yourself before this prints.";

const CLAIM_ONE = "Claim of absence: The city does not publish a survey page.";
const CLAIM_TWO = "Claim of absence: No council agenda item mentions the survey.";

function gateTodo(t: string, done: boolean) {
  return { t, done, src: "gate", q: GATE_QUERY };
}

async function fixture(notes: { todo: unknown[] }, topic = "council") {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from audit_events where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,'Council approves the plan','Why',$3,'new','[]','',1,$4,false) returning id",
    [USER, NEWSROOM, topic, JSON.stringify(notes)],
  );
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Council approves the plan','The plan passed.','The council approved the plan on Tuesday night.',$4,'[]','','[]','news','[]','[]','{}') returning id",
    [USER, NEWSROOM, lead.id, topic],
  );
  return { leadId: lead.id, draftId: draft.id };
}

async function articleCount(leadId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ count: number }>(
    "select count(*)::int as count from articles where lead_id=$1",
    [leadId],
  );
  return Number(row.count);
}

function refusalOf(result: { ok: true; slug: string } | { ok: false; error: string }) {
  return "error" in result ? result.error : "";
}

it("refuses to print a draft with one unchecked claim of absence, and writes nothing", async () => {
  const { leadId } = await fixture({ todo: [gateTodo(CLAIM_ONE, false)] });
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "an unconfirmed claim of absence must not print");
  assert.match(
    refusalOf(published),
    /Confirm the claim of absence first/,
    "the refusal has to say which box the editor must tick",
  );
  assert.equal(
    await articleCount(leadId),
    0,
    "a refused publish must not leave an article behind",
  );
});

it("counts the claims of absence when more than one is unchecked", async () => {
  const { leadId } = await fixture({
    todo: [gateTodo(CLAIM_ONE, false), gateTodo(CLAIM_TWO, false)],
  });
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "two unconfirmed claims must not print");
  assert.match(refusalOf(published), /Confirm the 2 claims of absence first/);
  assert.equal(await articleCount(leadId), 0);
});

it("prints the same draft once the claim of absence is ticked, and counts a ticked claim as confirmed", async () => {
  const { leadId } = await fixture({ todo: [gateTodo(CLAIM_ONE, true)] });
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(confirmed.ok, true, "fixture: the section should confirm");
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(
    published.ok,
    true,
    `a ticked claim of absence is confirmed, not outstanding: ${refusalOf(published)}`,
  );
  assert.equal(await articleCount(leadId), 1, "the print has to reach the paper");
});

it("still refuses while one of two claims is unchecked, even after the other is ticked", async () => {
  const { leadId } = await fixture({
    todo: [gateTodo(CLAIM_ONE, true), gateTodo(CLAIM_TWO, false)],
  });
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "ticking one claim must not clear the other");
  assert.match(refusalOf(published), /Confirm the claim of absence first/);
  assert.equal(await articleCount(leadId), 0);
});

it("refuses when the button names a section the draft does not file under", async () => {
  const { leadId } = await fixture({ todo: [] }, "council");
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "budget",
  );
  assert.equal(published.ok, false, "a section the draft does not file under must not print");
  assert.match(
    refusalOf(published),
    /and the button said/,
    "the refusal must show the editor the two sections that disagree",
  );
  assert.match(refusalOf(published), /"budget"/);
  assert.equal(await articleCount(leadId), 0, "a refused publish must not leave an article behind");
});

it("prints when the button names the draft's own section", async () => {
  const { leadId } = await fixture({ todo: [] }, "council");
  const published = await performPublish(
    { userId: USER, newsroomId: NEWSROOM },
    leadId,
    "council",
  );
  assert.equal(
    published.ok,
    true,
    `the section the editor read is the confirmation: ${refusalOf(published)}`,
  );
  const sql = await getSql();
  const [article] = await sql.query<{ topic: string }>(
    "select topic from articles where lead_id=$1",
    [leadId],
  );
  assert.equal(article.topic, "council", "the printed story carries the section that was pressed");
});
