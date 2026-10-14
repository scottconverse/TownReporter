import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/**
 * PR298-1: the private "missing fact" note was filed on the NEWEST draft of the
 * lead, not on the draft that was published.
 *
 * The note is written when a reader's visit runs the print-time cleanup (see
 * `rememberMissingFactNotesForArticle`), so it lands later than the publish by
 * minutes or days. The old rule was `order by updated_at desc limit 1` over the
 * lead's drafts: publish, then ask for a redraft, and the next reader's visit
 * filed the note against the newer draft -- a private check on a draft nobody
 * printed, and nothing on the draft the story came from, which is the draft the
 * editor opens to see it.
 *
 * These are behavior tests against real PGlite rows: real `leads`, `drafts` and
 * `articles` rows, the real exported function, and the assertion reads
 * `integrity_notes` straight out of the table with SQL.
 *
 * The module is loaded through Vite's SSR pipeline, the same way
 * `empty-dek-gate.test.ts` loads the publish path, so the test exercises the
 * shipped source rather than a copy of it.
 */

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let rememberMissingFactNotesForArticle: typeof import("./public.ts").rememberMissingFactNotesForArticle;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ rememberMissingFactNotesForArticle } = await vite.ssrLoadModule("/src/lib/news/public.ts"));
});

after(async () => vite.close());

const NEWSROOM = 98_640;
const USER = "missing-fact-note-editor";

type DraftRow = { id: number };

async function fixture() {
  const sql = await getSql();
  await sql.query("delete from articles where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from drafts where newsroom_id=$1", [NEWSROOM]);
  await sql.query("delete from leads where newsroom_id=$1", [NEWSROOM]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,topic_unchosen) values($1,$2,'Council approves the budget','Why','council','new','[]','',1,'{}',false) returning id",
    [USER, NEWSROOM],
  );
  /* The draft the story was PRINTED from: older than the redraft below. */
  const [printed] = await sql.query<DraftRow>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,updated_at) values($1,$2,$3,'Council approves the budget','The council approved the budget on Tuesday night.','council','[]','','[]','news','[]','[]', now() - interval '1 hour') returning id",
    [USER, NEWSROOM, lead.id],
  );
  const [article] = await sql.query<{ id: number }>(
    "insert into articles(user_id,newsroom_id,lead_id,origin_draft_id,slug,headline,body,topic,status) values($1,$2,$3,$4,$5,'Council approves the budget','The council approved the budget on Tuesday night.','council','published') returning id",
    [USER, NEWSROOM, lead.id, printed.id, `missing-fact-${NEWSROOM}`],
  );
  return { sql, leadId: Number(lead.id), printedId: Number(printed.id), articleId: Number(article.id) };
}

/** A later draft of the same lead -- what a redraft leaves behind. */
async function redraft(leadId: number) {
  const sql = await getSql();
  const [row] = await sql.query<DraftRow>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,updated_at) values($1,$2,$3,'Council approves the budget, again','A later draft.','council','[]','','[]','news','[]','[]', now()) returning id",
    [USER, NEWSROOM, leadId],
  );
  return Number(row.id);
}

async function noteOn(draftId: number) {
  const sql = await getSql();
  const [row] = await sql.query<{ integrity_notes: string | null }>(
    "select integrity_notes from drafts where id=$1",
    [draftId],
  );
  return row?.integrity_notes ?? null;
}

describe("PR298-1: the missing-fact note is filed on the draft that was published", () => {
  it("leaves a newer redraft alone and puts the note on the published draft", async () => {
    const f = await fixture();
    const laterId = await redraft(f.leadId);
    await rememberMissingFactNotesForArticle(f.articleId, ["The council vote count is missing."], NEWSROOM);

    assert.doesNotMatch(
      String(await noteOn(laterId)),
      /vote count is missing/,
      "the note does not land on a draft that was never printed",
    );
    assert.match(
      String(await noteOn(f.printedId)),
      /The council vote count is missing\./,
      "the note is on the draft the published story came from",
    );
  });

  it("still records the note once, and does not repeat it on a later visit", async () => {
    const f = await fixture();
    await rememberMissingFactNotesForArticle(f.articleId, ["  The date is missing.  "], NEWSROOM);
    await rememberMissingFactNotesForArticle(f.articleId, ["The date is missing."], NEWSROOM);
    const notes = String(await noteOn(f.printedId));
    assert.equal(notes.split("\n").filter((line) => line.includes("The date is missing.")).length, 1);
  });

  it("keeps the lead-level fallback for an article published before origin_draft_id existed", async () => {
    const f = await fixture();
    const sql = await getSql();
    await sql.query("update articles set origin_draft_id = null where id=$1", [f.articleId]);
    await rememberMissingFactNotesForArticle(f.articleId, ["The address is missing."], NEWSROOM);
    assert.match(
      String(await noteOn(f.printedId)),
      /The address is missing\./,
      "an old article still gets its note somewhere an editor can read it",
    );
  });
});
