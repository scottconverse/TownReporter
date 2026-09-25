import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  The section a story files under reaches a printed article the same way its
  claims do: it is written by a machine and read by nobody. A classifier picks
  it, the desk shows it as a select, and the publish button prints whatever the
  select happened to say.

  These call the real publish path. The desk's own button is disabled while the
  section is unconfirmed, and a disabled button is a suggestion -- a stale tab,
  a second window or a scripted call routes straight past it, which is the same
  reason the claims-of-absence gate lives on the server (see notes.ts).
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;
let parseNotes: typeof import("./notes.ts").parseNotes;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performConfirmDraftTopic } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ parseNotes } = await vite.ssrLoadModule("/src/lib/news/notes.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98411;
const USER = "topic-gate-editor";

async function fixture(topic = "council", topicUnchosen = false) {
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
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,'Council approves the plan','Why',$3,'new','[]','',1,'{}',$4) returning id",
    [USER, NEWSROOM, topic, topicUnchosen],
  );
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Council approves the plan','The plan passed.','The council approved the plan on Tuesday.',$4,'[]','','[]','news','[]','[]','{}') returning id",
    [USER, NEWSROOM, lead.id, topic],
  );
  return { leadId: lead.id, draftId: draft.id };
}

async function storedTopicConfirmation(leadId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ notes_json: string }>(
    "select notes_json from leads where id=$1",
    [leadId],
  );
  return parseNotes(row.notes_json).topicConfirmation;
}

it("refuses to publish a draft whose section nobody confirmed", async () => {
  const { leadId } = await fixture("council");
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "an unconfirmed section must not print");
  assert.match(
    "error" in published ? published.error : "",
    /section/i,
    "the refusal must say what is missing",
  );
});

it("publishes once an editor confirms the section for that draft, and records what was confirmed", async () => {
  const { leadId } = await fixture("schools");
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(confirmed.ok, true);
  const stored = await storedTopicConfirmation(leadId);
  assert.equal(stored?.topic, "schools", "the record must name the section it confirmed");

  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, true);
  const sql = await getSql();
  const [article] = await sql.query<{ topic: string }>(
    "select topic from articles where lead_id=$1",
    [leadId],
  );
  assert.equal(article.topic, "schools");
});

it("refuses again when the section is changed after the confirmation", async () => {
  const { leadId, draftId } = await fixture("council");
  await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);

  // The editor re-files the story and saves: the draft now says something the
  // confirmation does not cover.
  const sql = await getSql();
  await sql.query("update drafts set topic='budget' where id=$1", [draftId]);

  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "a confirmation for one section must not carry over to another");
  assert.match("error" in published ? published.error : "", /section/i);
});

it("refuses when the draft is rewritten after the confirmation", async () => {
  const { leadId, draftId } = await fixture("council");
  await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);

  const sql = await getSql();
  await sql.query("update drafts set body='A completely different story about a different meeting.' where id=$1", [
    draftId,
  ]);

  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(
    published.ok,
    false,
    "the confirmation is for the version that was read, not for the lead",
  );
});

/*
  Unit P item 1: when the scan names no section this newsroom files under, the
  lead keeps a section (the column needs one) and records that the model did
  not choose it (topic_unchosen, migrations/0087_lead_topic_unchosen.sql). The
  Queue row and the story page say "Section not chosen — pick one" until an
  editor actually picks one. Confirming the section on the draft IS that
  choice, so the mark has to clear -- otherwise the notice keeps telling an
  editor to do the thing they just did.
*/
it("clears the not-chosen mark when an editor confirms the section, and only then", async () => {
  const { leadId } = await fixture("council", true);
  const sql = await getSql();
  const marked = async () => {
    const [row] = await sql.query<{ topic_unchosen: boolean }>(
      "select topic_unchosen from leads where id=$1",
      [leadId],
    );
    return row!.topic_unchosen;
  };
  assert.equal(await marked(), true, "a lead filed under a section the scan never chose starts marked");

  // 0.6.62 still applies: the publish gate does not care why the section is
  // unconfirmed, and nothing here is a way around it.
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, false, "an unconfirmed section must not print, chosen or not");
  assert.equal(await marked(), true, "a refused publish is not a confirmation");

  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(confirmed.ok, true);
  assert.equal(await marked(), false, "confirming the section is the editor choosing it");
  assert.equal(
    (await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId)).ok,
    true,
    "the confirmed section prints",
  );
});
