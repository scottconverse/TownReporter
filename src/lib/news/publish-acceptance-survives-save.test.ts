import { deskDraftState } from "./desk-drafts.ts";
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/**
 * UNIT PUB1. "Publish gives no answer."
 *
 * THE OWNER'S STORY. The bar said "Nothing blocks Publish. 5 claims from the
 * evidence check are unreviewed." -- which is only drawn when the desk already
 * holds an acceptance covering this draft version (`acceptanceCovers`) -- he
 * pressed Publish, and the same button came back with no message at all. The
 * lead stayed `drafted`, no article was written, and the draft's `updated_at`
 * moved to the minute of the press. The refusal, if it was drawn, was a Notice
 * in the body far from the bar.
 *
 * THE CAUSE THIS FILE PINS, on the real functions and a real (PGlite)
 * database, is NOT the gate. It is the press itself:
 *
 *   1. The editor presses "Publish anyway, I accept these claims are
 *      unreviewed". The acceptance is stored against
 *      `topicConfirmationFingerprint(evidenceReviewToken(draft))` -- the
 *      identity of the exact draft version they were reading.
 *   2. The publish press does not print first. It SAVES first
 *      (`saveDraftForEditor`), so the print cannot race the editor's box.
 *   3. That save writes `research_json` back through
 *      `researchJsonWithStyleAudit`, which adds the derived `styleAudit` key
 *      (a model draft has none; the Style check list needs one).
 *   4. `evidenceReviewToken` hashes the WHOLE `research_json`. So a save whose
 *      text did not change one character still moves the draft's identity, the
 *      stored acceptance no longer matches, and `performPublish` refuses in
 *      words that were drawn in the page body, away from the bar.
 *
 * THE FIX (see `draft-evidence.ts`): the token ignores the one key inside
 * `research_json` that is a pure function of text the token already carries.
 * Nothing an editor can change leaves the token: the body, headline, dek,
 * topic, sources, provenance, findings and transcript citations are all still
 * hashed. `styleAudit` is measured FROM the headline/dek/body, so dropping it
 * cannot hide an edit -- which is why option (b), "skip the save when nothing
 * would change", does not fix this at all: on a model draft the style record
 * IS the change, so the save would still run and the token would still move.
 *
 * This file uses the real schema and the real server functions, like
 * `unreviewed-claims-gate.test.ts` (unit U24) next to it.
 */

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performAcceptUnreviewedClaims: typeof import("./desk.ts").performAcceptUnreviewedClaims;
let saveDraftForEditor: typeof import("./draft-edit.server.ts").saveDraftForEditor;
let evidenceReviewToken: typeof import("./draft-evidence.ts").evidenceReviewToken;
let stripReporterNotebook: typeof import("./strip-draft.ts").stripReporterNotebook;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performAcceptUnreviewedClaims } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ saveDraftForEditor } = await vite.ssrLoadModule("/src/lib/news/draft-edit.server.ts"));
  ({ evidenceReviewToken } = await vite.ssrLoadModule("/src/lib/news/draft-evidence.ts"));
  ({ stripReporterNotebook } = await vite.ssrLoadModule("/src/lib/news/strip-draft.ts"));
});

after(async () => vite.close());

let sequence = 99100;

const MODEL_DRAFT_SECTIONS = "council";

/**
 * A MODEL draft: `research_json` is `{}` -- no `styleAudit` key, exactly as
 * `draft.ts` leaves a freshly written draft -- with one unreviewed claim
 * against one readable captured record, a dek, a section and a citation, so
 * the claims gate is the only thing outstanding.
 */
async function fixture() {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `pub1-editor-${newsroomId}`;
  const url = `https://records.example/pub1-${newsroomId}`;
  await sql.query("delete from articles where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from artifact_versions where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    userId,
    newsroomId,
  ]);
  const [capture] = await sql.query<{ id: number }>(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'pub1','Council record','The adopted budget message sets the 2027 operating budget at $547.5 million.') returning id",
    [userId, newsroomId, url],
  );
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Council adopts the budget','Why','council','drafted',$3,'',1,'{}') returning id",
    [userId, newsroomId, JSON.stringify([url])],
  );
  const body = "The council adopted the budget after a short debate.";
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Council adopts the budget','The 5-2 vote funds the plan.',$4,'council',$5,'','[]','news',$6,'[]','{}') returning id",
    [
      userId,
      newsroomId,
      lead.id,
      body,
      JSON.stringify([url]),
      JSON.stringify([
        {
          text: "The 2027 operating budget is $547.5 million.",
          source_urls: [url],
          capture_event_ids: [],
          artifact_version_ids: [capture.id],
          locators: ["Budget message, page 1"],
          excerpt: "$547.5 million operating budget",
        },
      ]),
    ],
  );
  return { sql, newsroomId, userId, leadId: lead.id, draftId: draft.id, url, captureId: capture.id };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** The draft row as the server reads it, in the column order the page's loader uses. */
async function draftRow(f: Fixture) {
  const [row] = await f.sql.query<import("./types.ts").DraftRow>(
    `select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
            provenance_json, form, found_note, unanswered, research_json
       from drafts where id=$1`,
    [f.draftId],
  );
  return row!;
}

/**
 * The fields the story page's boxes hold, as it seeds them: the stored row,
 * unpacked, with the reporter notebook stripped -- `desk.story.$leadId.tsx`
 * does exactly this before the editor can touch anything.
 */
async function displayedFields(f: Fixture) {
  const row = await draftRow(f);
  return {
    headline: row.headline,
    dek: row.dek,
    topic: row.topic,
    body: stripReporterNotebook(row.body ?? ""),
  };
}

/** The review token the Checks pane reports up, which the accept press carries. */
async function paneReviewToken(f: Fixture): Promise<string> {
  const { loadFindingEvidenceReview } = await vite.ssrLoadModule("/src/lib/news/finding-evidence-review.ts");
  return (await loadFindingEvidenceReview(await getSql(), f.newsroomId, f.leadId)).evidenceToken;
}

it("a publish-time save of text that did not change does not take back the acceptance", async () => {
  const f = await fixture();

  /* The editor accepted the claims for the version on screen. */
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await paneReviewToken(f),
  );
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);

  /* Recording the acceptance does not touch the draft row, so the identity
     the acceptance was recorded against still stands. */
  const beforeSave = evidenceReviewToken(await draftRow(f));

  /* The publish press saves first, with the page's own boxes. Nothing here has
     been edited: this is the press, not an edit. */
  await saveDraftForEditor(
    { userId: f.userId, newsroomId: f.newsroomId },
    { leadId: f.leadId, ...(await displayedFields(f)) },
  );

  const afterSave = evidenceReviewToken(await draftRow(f));

  /*
    WHICH STEP MOVED IT. Not the acceptance (asserted above), not the text --
    the save. And the only key that changed inside `research_json` is the
    derived style record, which is measured FROM the headline/dek/body the
    token already carries.
  */
  const researchBefore = JSON.parse((await draftRow(f)).research_json ?? "{}") as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(researchBefore).sort(),
    ["styleAudit"],
    "the publish-time save adds nothing but the derived style record to a model draft",
  );
  assert.equal(
    JSON.parse((await draftRow(f)).found_note ?? "[]").length,
    1,
    "the review's own material is untouched, so the claims are the same claims",
  );

  assert.equal(
    afterSave,
    beforeSave,
    "a save of text that did not change must not move the draft's identity",
  );

  /* And the press that follows prints, instead of refusing with words the
     editor never saw. */
  const printed = await performPublish(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    MODEL_DRAFT_SECTIONS,
  );
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
});

it("STILL voids the acceptance when the body is edited (the U24 guard)", async () => {
  /*
    The fix must not weaken the token for anything a person can change. The
    body is the one that matters most: the claims a person accepted are the
    claims they read, and different words are a different story.

    The refusal comes back as the older stale-evidence sentence rather than the
    claims one -- an edited body sets `evidenceReview.required`, which
    `performPublish` checks first -- so what this asserts is the thing that
    actually matters: the stored acceptance no longer matches the draft, and
    the print does not happen.
  */
  const f = await fixture();
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await paneReviewToken(f),
  );
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);

  const fields = await displayedFields(f);
  await saveDraftForEditor(
    { userId: f.userId, newsroomId: f.newsroomId },
    { leadId: f.leadId, ...fields, body: `${fields.body} The vote was 5-2.` },
  );

  const { topicConfirmationFingerprint } = await vite.ssrLoadModule("/src/lib/news/notes.ts");
  const [notesRow] = await f.sql.query<{ notes_json: string }>(
    "select notes_json from leads where id=$1",
    [f.leadId],
  );
  const stored = JSON.parse(notesRow!.notes_json) as {
    unreviewedClaimsConfirmation?: { token: string };
  };
  assert.notEqual(
    stored.unreviewedClaimsConfirmation?.token,
    topicConfirmationFingerprint(evidenceReviewToken(await draftRow(f))),
    "the acceptance was for the words that were read, not for these",
  );

  const printed = await performPublish(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    MODEL_DRAFT_SECTIONS,
  );
  assert.equal(printed.ok, false, "an edited story is not covered by the old acceptance");
});

it("STILL voids the acceptance when the headline, the dek or the section is edited", async () => {
  for (const patch of [
    { headline: "Council adopts the budget, 5-2" },
    { dek: "The 5-2 vote funds the plan for one year." },
    { topic: "schools" },
  ]) {
    const f = await fixture();
    const accepted = await performAcceptUnreviewedClaims(
      { userId: f.userId, newsroomId: f.newsroomId },
      f.leadId,
      await paneReviewToken(f),
    );
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    await saveDraftForEditor(
      { userId: f.userId, newsroomId: f.newsroomId },
      { leadId: f.leadId, ...(await displayedFields(f)), ...patch },
    );
    const printed = await performPublish(
      { userId: f.userId, newsroomId: f.newsroomId },
      f.leadId,
      MODEL_DRAFT_SECTIONS,
    );
    assert.equal(printed.ok, false, `an edit to ${Object.keys(patch)[0]} must take the acceptance back`);
  }
});

it("STILL voids the acceptance when a source or a finding is added", async () => {
  const f = await fixture();
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await paneReviewToken(f),
  );
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
  /* A redraft, a re-check, a claim added by hand: the row's own material. */
  await f.sql.query("update drafts set found_note=$1 where id=$2", [
    JSON.stringify([
      {
        text: "The 2027 operating budget is $547.5 million.",
        source_urls: [f.url],
        capture_event_ids: [],
        artifact_version_ids: [f.captureId],
        locators: ["Budget message, page 1"],
        excerpt: "$547.5 million operating budget",
      },
      {
        text: "The mill levy is 2.44 mills.",
        source_urls: [f.url],
        capture_event_ids: [],
        artifact_version_ids: [f.captureId],
        locators: [],
      },
    ]),
    f.draftId,
  ]);
  const printed = await performPublish(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    MODEL_DRAFT_SECTIONS,
  );
  assert.equal(printed.ok, false, "a claim that arrived after the acceptance is not covered by it");
  assert.match(printed.ok ? "" : printed.error, /2 claims from the evidence check|has not been reviewed/);
});

it("the token is still a pure function of the draft's own text, with the derived record ignored", async () => {
  /*
    The whole of the fix, stated as a property: two rows that differ ONLY in
    the derived style record are the same draft version, and a row whose text
    differs is not.
  */
  const base = {
    id: 1,
    headline: "Council adopts the budget",
    dek: "The 5-2 vote funds the plan.",
    topic: "council",
    body: "The council adopted the budget.",
    source_urls: "[]",
    provenance_json: "[]",
    found_note: "[]",
    unanswered: "[]",
    research_json: '{"transcriptCitations":[{"at":3}]}',
  };
  const withStyle = {
    ...base,
    research_json: JSON.stringify({
      transcriptCitations: [{ at: 3 }],
      styleAudit: { version: 1, status: "clean", findings: [{ message: "Long sentence." }] },
    }),
  };
  assert.equal(
    evidenceReviewToken(withStyle),
    evidenceReviewToken(base),
    "the style record is measured from the text, so it is not part of the draft's identity",
  );
  assert.notEqual(
    evidenceReviewToken({ ...withStyle, body: "The council adopted the budget on Tuesday." }),
    evidenceReviewToken(withStyle),
    "a body edit still moves it",
  );
  assert.notEqual(
    evidenceReviewToken({ ...withStyle, research_json: '{"transcriptCitations":[{"at":4}],"styleAudit":{}}' }),
    evidenceReviewToken(withStyle),
    "a transcript citation is not the derived record and still moves it",
  );
  assert.notEqual(
    evidenceReviewToken({ ...withStyle, found_note: '[{"text":"x"}]' }),
    evidenceReviewToken(withStyle),
    "the findings still move it",
  );
});

it("a content-identical replacement draft keeps its token; every content edit moves it", () => {
  const base = { id: 1, headline: "Headline", dek: "Dek", body: "Body", topic: "business",
    source_urls: "[]", provenance_json: "[]", found_note: "[]", unanswered: "[]", research_json: "{}" };
  assert.equal(evidenceReviewToken({ ...base, id: 2 }), evidenceReviewToken(base));
  for (const field of ["headline", "dek", "body", "topic", "source_urls", "provenance_json", "found_note", "unanswered", "research_json"] as const) {
    assert.notEqual(evidenceReviewToken({ ...base, [field]: "changed" }), evidenceReviewToken(base), field);
  }
});

it("source edits after accepting still refuse publication", async () => {
  const f = await fixture();
  const accepted = await performAcceptUnreviewedClaims({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, await paneReviewToken(f));
  assert.equal(accepted.ok, true);
  await f.sql.query("update drafts set source_urls=$1 where id=$2", [JSON.stringify([f.url, "https://records.example/new-source"]), f.draftId]);
  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, MODEL_DRAFT_SECTIONS);
  assert.equal(printed.ok, false);
});

it("reopening the drafts list after a no-op Save uses the recorded acceptance", async () => {
  const f = await fixture();
  const context = { userId: f.userId, newsroomId: f.newsroomId };
  assert.equal((await performAcceptUnreviewedClaims(context, f.leadId, await paneReviewToken(f))).ok, true);
  await saveDraftForEditor(context, { leadId: f.leadId, ...(await displayedFields(f)) });
  const { queryDraftRows } = await vite.ssrLoadModule("/src/lib/news/desk.ts");
  const rows = await queryDraftRows(context);
  const row = rows.find((row: {lead_id:number}) => row.lead_id === f.leadId);
  assert.equal(row.unreviewed_claims, 1);
  assert.equal(row.unreviewed_claims_accepted_count, 1);
  const state = deskDraftState(row);
  assert.equal(state.label, "✓ Ready");
  assert.equal(state.readiness?.reason, "You accepted 1 claim the AI could not confirm.");
});
