import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/*
  The reader-facing disclosure line of an imported story.

  An imported story is written by an outside research tool, not by this
  paper's AI drafting path, so the standard line ("AI tools helped find
  records and write the first draft") would be false over it. The import
  review screen chooses the wording, the draft carries it, and publish copies
  it onto the article -- that is the seam these drive, on the real publish
  path, because a line that only exists on the draft never reaches a reader.

  The same fixtures also prove the other half of the brief's publish claim:
  a well-formed imported story (headline, confirmed section, body, sources)
  prints without any AI pass. There is no draft-with-AI call anywhere in this
  file; the section confirmation, which protects readers, is the one editorial
  step taken, exactly as for a story the desk wrote.
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
  ({ performPublish, performConfirmDraftTopic } = await vite.ssrLoadModule(
    "/src/lib/news/desk.ts",
  ));
});

after(async () => vite.close());

const NEWSROOM = 98433;
const USER = "import-disclosure-editor";

const OUTSIDE_AI_LINE =
  "An outside AI research tool wrote this from public records; an editor reviewed it.";

/**
 * An imported lead and its draft: origin "import", provenance recorded, the
 * score a pasted report carries (none) rather than a scanner's.
 */
async function importedFixture(disclosureText: string) {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [NEWSROOM]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    USER,
    NEWSROOM,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,origin,provenance_json)
     values($1,$2,'Council votes to bring marijuana hospitality rules back','Why','council','new','[]','',0,'{}','import',$3) returning id`,
    [
      USER,
      NEWSROOM,
      JSON.stringify({
        importer: USER,
        importedAt: "2026-09-24T10:00:00.000Z",
        inputSha256: "a".repeat(64),
        tool: "Civic Scanner",
      }),
    ],
  );
  const [draft] = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json,disclosure_text)
     values($1,$2,$3,'Council votes to bring marijuana hospitality rules back','The council asked for a draft ordinance.','The council voted 5-2 on Tuesday to bring the hospitality rules back for consideration.','council',$4,'','[]','reported','[]','[]','{}',$5) returning id`,
    [
      USER,
      NEWSROOM,
      lead.id,
      JSON.stringify(['https://www.youtube.com/watch?v=abc123']),
      disclosureText,
    ],
  );
  const confirmed = await performConfirmDraftTopic({ userId: USER, newsroomId: NEWSROOM }, lead.id);
  assert.equal(confirmed.ok, true, "fixture: the section should confirm");
  return { leadId: lead.id, draftId: draft.id };
}

it("prints the imported story under the line the editor chose, and needs no AI pass", async () => {
  const { leadId } = await importedFixture(OUTSIDE_AI_LINE);
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(
    "error" in published ? published.error : "",
    "",
    "a well-formed imported story must not be blocked by a gate meant for AI drafts",
  );
  assert.equal(published.ok, true, "an imported story prints on the normal button");

  const sql = await getSql();
  const [article] = await sql.query<{ disclosure_text: string; body: string }>(
    "select disclosure_text, body from articles where lead_id=$1",
    [leadId],
  );
  assert.equal(
    article.disclosure_text,
    OUTSIDE_AI_LINE,
    "the line the editor chose reaches the published article, word for word",
  );
  assert.equal(
    article.body,
    "The council voted 5-2 on Tuesday to bring the hospitality rules back for consideration.",
    "the imported text prints as written",
  );
});

it("leaves the standard disclosure line alone for a story the desk wrote", async () => {
  const { leadId } = await importedFixture("");
  const published = await performPublish({ userId: USER, newsroomId: NEWSROOM }, leadId);
  assert.equal(published.ok, true);
  const sql = await getSql();
  const [article] = await sql.query<{ disclosure_text: string }>(
    "select disclosure_text from articles where lead_id=$1",
    [leadId],
  );
  assert.equal(
    article.disclosure_text,
    "",
    "empty means 'print the standard line', so nothing changes for a desk-written story",
  );
});
