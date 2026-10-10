import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  An imported story the editor edits is not an AI draft that drifted.

  The evidence review exists because a model writes a draft out of gathered
  records: when the prose changes after those records were gathered, a person
  has to look at the two together again before it prints. An imported story is
  the opposite shape -- the pasted text IS the material, and its sources are
  the pages it cites. Fixing a name in it and saving is ordinary desk work.

  An edited imported story prints after acknowledging that no check was recorded. The imported
  half of this file does not hand-build its rows: it runs the real import, on
  the real publish path, so the mark the import puts on the draft and the thing
  publish respects cannot drift apart. The checks that protect readers still
  hold and are exercised here too: the section must be confirmed again for the
  edited version (the edit changes the fingerprint), and a model-written draft
  with sources and a changed body still stops at the evidence review.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performConfirmDraftTopic: typeof import("./desk.ts").performConfirmDraftTopic;
let saveDraftForEditor: typeof import("./draft-edit.server.ts").saveDraftForEditor;
let performImportFinishedStories: typeof import("./import-stories.server.ts").performImportFinishedStories;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performConfirmDraftTopic } = await vite.ssrLoadModule(
    "/src/lib/news/desk.ts",
  ));
  ({ saveDraftForEditor } = await vite.ssrLoadModule("/src/lib/news/draft-edit.server.ts"));
  ({ performImportFinishedStories } = await vite.ssrLoadModule(
    "/src/lib/news/import-stories.server.ts",
  ));
});

after(async () => vite.close());

const NEWSROOM = 98447;
const USER = "import-editor-edit";

const HEADLINE = "Council votes to bring marijuana hospitality rules back";
const DEK = "The council asked for a draft ordinance.";
const BODY =
  "The council voted 5-2 on Tuesday to bring the hospitality rules back for consideration.";
const CITED = [
  "https://www.youtube.com/watch?v=jhsFsEz0P5A",
  "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1",
];

async function emptyNewsroom() {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
}

/** The editor fixes the vote count and saves -- the desk's own save path. */
async function editAndSave(leadId: number, body: string) {
  const saved = await saveDraftForEditor(
    { userId: USER, newsroomId: NEWSROOM },
    { leadId, headline: HEADLINE, dek: DEK, body, topic: "council" },
  );
  assert.equal(saved.ok, true, "fixture: the editor's save should go through");
  // The edit changed the version being printed, so the section has to be
  // confirmed again -- the same step the story editor asks a person for.
  const reconfirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(reconfirmed.ok, true, "fixture: the edited version's section should confirm");
}

/**
 * A story that arrived through the import screen: the paste, the cards the
 * editor ticked, the real import function.
 */
async function importOneStory() {
  await emptyNewsroom();
  const text = [
    HEADLINE,
    "",
    DEK,
    "",
    BODY,
    "",
    "Sources:",
    `- ${CITED[0]}`,
    `- ${CITED[1]}`,
  ].join("\n");
  const result = await performImportFinishedStories(
    { userId: USER, newsroomId: NEWSROOM },
    {
      text,
      tool: "Civic Scanner",
      stories: [
        {
          headline: HEADLINE,
          kind: "story",
          section: "council",
          dek: DEK,
          body: BODY,
          citations: [],
          links: CITED.map((url) => ({ url, text: url })),
          score: "17/20",
          triage: "Advance",
          reporterNextStep: "",
          hold: false,
          disclosureKey: "outside-ai",
          disclosureOther: "",
        },
      ],
    },
    // The cited pages are fetched in the background for real; here the fetch
    // is stubbed, because the walk covers a page that actually answers.
    { capture: async () => ({ captured: 0, failed: 0 }) },
  );
  assert.equal(result.error, "", "fixture: the import should read the story");
  assert.equal(result.imported.length, 1, "fixture: one story imported");
  const leadId = result.imported[0]!.leadId;
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(confirmed.ok, true, "fixture: the section should confirm");
  return leadId;
}

it("prints an imported story whose body an editor edited, with the edit in it", async () => {
  const leadId = await importOneStory();
  const edited = `${BODY} The ordinance comes back on 13 October.`;
  await editAndSave(leadId, edited);
  const ctx = { userId: USER, newsroomId: NEWSROOM };
  const warnings = await performPublish(ctx, leadId);
  assert.ok(!warnings.ok && warnings.warnings?.some(row => row.key === "unchecked"));
  const published = await performPublish(ctx, leadId, undefined, undefined, {}, ["unchecked"]);
  assert.equal(
    "error" in published ? published.error : "",
    "",
    "an edited imported story publishes after the unchecked warning is acknowledged",
  );
  assert.equal(published.ok, true, "the editor's edit prints on the normal button");
  const sql = await getSql();
  const [article] = await sql.query<{ body: string }>(
    "select body from articles where lead_id=$1",
    [leadId],
  );
  assert.equal(article.body, edited, "the reader gets the version the editor saved");
});

it("warns before printing a changed model-written draft and audits Publish anyway", async () => {
  await emptyNewsroom();
  const sql = await getSql();
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,origin)
     values($1,$2,$3,'Why','council','new',$4,'',0,'{}','scanner') returning id`,
    [USER, NEWSROOM, HEADLINE, JSON.stringify(CITED)],
  );
  await sql.query(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json,disclosure_text)
     values($1,$2,$3,$4,$5,$6,'council',$7,'',$8,'reported','[]','[]',$9,'')`,
    [
      USER,
      NEWSROOM,
      lead!.id,
      HEADLINE,
      DEK,
      BODY,
      JSON.stringify(CITED),
      JSON.stringify(CITED.map((url) => ({ url }))),
      // The material a model draft carries: claims it read out of the records.
      JSON.stringify({ reportedDocumentClaims: [{ claim: "voted 5-2", source: CITED[0] }] }),
    ],
  );
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, lead!.id);
  assert.equal(confirmed.ok, true, "fixture: the section should confirm");
  await editAndSave(lead!.id, `${BODY} The ordinance comes back on 13 October.`);
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, lead!.id);
  assert.equal(published.ok, false, "the first press asks the editor to review current warnings");
  assert.ok("warnings" in published && Array.isArray(published.warnings));
  const warnings = (published as {warnings:Array<{key:string;sentence:string}>}).warnings;
  assert.ok(warnings.some(warning => warning.key === "evidence-stale" && /Review the evidence in the workbench/.test(warning.sentence)));
  const printed = await performPublish({userId:USER,newsroomId:NEWSROOM}, lead!.id, undefined, undefined, {}, warnings.map(warning=>warning.key));
  assert.equal(printed.ok, true, "the explicit override prints instead of dead-ending");
  const [article] = await sql.query<{body:string}>("select body from articles where lead_id=$1", [lead!.id]);
  assert.equal(article.body, `${BODY} The ordinance comes back on 13 October.`);
  const audit = await sql.query<{user_id:string;detail:string}>("select user_id,detail from audit_events where action='override' and subject_kind='drafts' and subject_id in (select id from drafts where lead_id=$1)", [lead!.id]);
  assert.ok(audit.some(row=>row.user_id===USER && JSON.parse(row.detail).key==="evidence-stale"));

});
