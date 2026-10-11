import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";

/**
 * UNIT ZC2 -- THE ZERO-RECORDED-CLAIMS TRUST BUG, at the server.
 *
 * A story whose evidence check raised NO claims (so nothing is "unreviewed")
 * but which was never checked at all used to print with no gate at all,
 * because `performPublish` only refused when the unreviewed count was ABOVE
 * zero. This pins the real refusal, the exact sentence, the one-press
 * acknowledgement recorded in `leads.notes_json`, its audit event, and the
 * edit that takes it back -- on the real functions and a real (PGlite)
 * database, in the shape of `unreviewed-claims-gate.test.ts`.
 */

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performPublish: typeof import("./desk.ts").performPublish;
let performDraftReconcileWork: typeof import("./draft-reconcile.server.ts").performDraftReconcileWork;
let saveDraftForEditor: typeof import("./draft-edit.server.ts").saveDraftForEditor;

/** The review token the editor's screen holds, which the acknowledgement press carries. */
async function currentToken(f: Fixture): Promise<string> {
  const sql = await getSql();
  const [row] = await sql.query<import("./types.ts").DraftRow>(
    `select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
            provenance_json, form, found_note, unanswered, research_json
       from drafts where lead_id=$1 and newsroom_id=$2 order by updated_at desc, id desc limit 1`,
    [f.leadId, f.newsroomId],
  );
  const { evidenceReviewToken } = await vite.ssrLoadModule("/src/lib/news/draft-evidence.ts");
  return evidenceReviewToken(row!);
}

/** Loaded per-test: the acknowledgement press is new, and its absence today
 *  must fail THAT test, not stop the file before the refusal is exercised. */
async function acknowledge(
  context: { userId: string; newsroomId: number },
  leadId: number,
  evidenceToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const mod = (await vite.ssrLoadModule("/src/lib/news/desk.ts")) as {
    performAcknowledgeUnchecked?: (
      context: { userId: string; newsroomId: number },
      leadId: number,
      evidenceToken: string,
    ) => Promise<{ ok: boolean; error?: string }>;
  };
  if (!mod.performAcknowledgeUnchecked) throw new Error("performAcknowledgeUnchecked is not implemented yet");
  return mod.performAcknowledgeUnchecked(context, leadId, evidenceToken);
}

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-unchecked-publish-${process.pid}`),
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({ performPublish } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ performDraftReconcileWork } = await vite.ssrLoadModule("/src/lib/news/draft-reconcile.server.ts"));
  ({ saveDraftForEditor } = await vite.ssrLoadModule("/src/lib/news/draft-edit.server.ts"));
  await ensureJobsSchema();
});

after(async () => vite?.close());

let sequence = 99700;

/**
 * A drafted story with a real, checkable fact in its body, a dek, a section
 * and a citation -- but NO claims from an evidence check (`found_note: '[]'`,
 * no findings, no reported claims). The only thing that could refuse it is the
 * zero-claims gate.
 */
async function fixture(body = "The council approved the $547.5 million budget on Tuesday.") {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `zc-editor-${newsroomId}`;
  const url = `https://records.example/zc-${newsroomId}`;
  await sql.query("delete from articles where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from artifact_versions where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query(
    "insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)",
    [userId, newsroomId],
  );
  await sql.query(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'zc','Council record','The adopted budget message sets the 2027 operating budget at $547.5 million.')",
    [userId, newsroomId, url],
  );
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Council adopts the budget','Why','council','drafted',$3,'',1,'{}') returning id",
    [userId, newsroomId, JSON.stringify([url])],
  );
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Council adopts the budget','The 5-2 vote funds the plan.',$4,'council',$5,'','[]','news',$6,'[]','{}') returning id",
    [userId, newsroomId, lead.id, body, JSON.stringify([url]), JSON.stringify([])],
  );
  return { sql, newsroomId, userId, leadId: lead.id, draftId: draft.id, url };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const SECTION = "council";

it("refuses to print a zero-claims story nobody has checked, in the exact sentence", async () => {
  const f = await fixture();
  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false, "a checkable story with no recorded claims must not print unchecked");
  assert.equal(
    printed.ok ? "" : printed.error,
    "No claims were recorded for this story, so nothing has been checked. Run the evidence check, or read it against your sources and press 'I checked this story myself'.",
  );
  const [article] = await f.sql.query("select id from articles where newsroom_id=$1", [f.newsroomId]);
  assert.equal(article, undefined, "nothing printed");
});

it("prints a zero-claims story with no checkable fact, unchanged", async () => {
  const f = await fixture("The council met and talked for a while about the year ahead.");
  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
});

it("warns on a pasted factual story, then publishes anyway and audits unchecked", async () => {
  const f = await fixture();
  await f.sql.query("update drafts set research_json=$1 where id=$2", [
    JSON.stringify({ importedText: true }),
    f.draftId,
  ]);
  const ctx = { userId: f.userId, newsroomId: f.newsroomId };
  const refused = await performPublish(ctx, f.leadId, SECTION);
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.warnings?.some(row => row.key === "unchecked"));
  const { queryDraftRows } = await vite.ssrLoadModule("/src/lib/news/desk.ts");
  const rows = await queryDraftRows(ctx);
  const { deskDraftState } = await vite.ssrLoadModule("/src/lib/news/desk-drafts.ts");
  assert.equal(deskDraftState(rows.find((row: { id: number }) => row.id === f.draftId)).label, "! Not checked yet");
  const printed = await performPublish(ctx, f.leadId, SECTION, undefined, {}, ["unchecked"]);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
  const audits = await f.sql.query<{ detail: string }>("select detail from audit_events where newsroom_id=$1 and action='override'", [f.newsroomId]);
  assert.deepEqual(audits.map(row => JSON.parse(row.detail).key), ["unchecked"]);
});

it("ignores a date or figure kept only in the private reporter notebook", async () => {
  /* The public story has nothing checkable; the notebook below it does. The
     detector reads the public text, so this story is not blocked. */
  const f = await fixture(
    "The council met and talked for a while about the year ahead.\n\nNext checks are: confirm the $547.5 million figure from the Sept. 30 meeting.",
  );
  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
});

it("records the one-press acknowledgement, audits it, and prints on it", async () => {
  const f = await fixture();

  const acked = await acknowledge(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await currentToken(f),
  );
  assert.equal(acked.ok, true, acked.ok ? "" : acked.error);

  const [row] = await f.sql.query<{ notes_json: string }>(
    "select notes_json from leads where id=$1",
    [f.leadId],
  );
  const stored = JSON.parse(row!.notes_json) as {
    uncheckedStoryConfirmation?: { token: string; at: string; by: string };
  };
  assert.ok(stored.uncheckedStoryConfirmation?.token, "the acknowledgement names the draft version");
  assert.equal(stored.uncheckedStoryConfirmation?.by, f.userId);
  assert.ok(stored.uncheckedStoryConfirmation?.at, "an acknowledgement without a time is not a record");

  const [audited] = await f.sql.query<{ action: string }>(
    "select action from audit_events where newsroom_id=$1 and action='publish-unchecked-acknowledged'",
    [f.newsroomId],
  );
  assert.ok(audited, "the acknowledgement is on the audit trail");

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
});

it("takes the acknowledgement back on an edit", async () => {
  const f = await fixture();
  await acknowledge({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, await currentToken(f));
  await f.sql.query("update drafts set body=$1, updated_at=now() where id=$2", [
    "The council approved the $547.5 million budget after a long and contested debate.",
    f.draftId,
  ]);
  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false, "the editor's acknowledgement was for the words they read");
  assert.match(printed.ok ? "" : printed.error, /nothing has been checked/);
});

it("a completed zero-claims evidence check clears the gate for the version it checked, and an edit reopens it", async () => {
  const f = await fixture();
  const sql = await getSql();
  /* A completed reconcile job with no claims returned: the check ran, found
     nothing to judge, and stamped the draft it checked. */
  const [job] = await sql.query<DeskJob>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values($1,$2,'reconcile',$3,'local-model','editor','default','running','Queued',$4) returning *",
    [f.userId, f.newsroomId, f.draftId, `zc-claim-${f.newsroomId}`],
  );
  const reply = JSON.stringify({
    headline: "Council adopts the budget",
    dek: "The 5-2 vote funds the plan.",
    body: "The council approved the $547.5 million budget on Tuesday.",
    topic: "council",
    source_urls: [],
    integrity_notes: "",
    reporting_trail: [],
    found: {},
    unanswered: [],
    claims: [],
  });
  await performDraftReconcileWork(job, { stage: async () => {}, chat: async () => ({ ok: true, text: reply }) });

  const [checked] = await sql.query<{ research_json: string }>(
    "select research_json from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",
    [f.newsroomId, f.leadId],
  );
  const memo = JSON.parse(checked!.research_json) as {
    aiEvidenceReview?: { checkedText?: string; rows?: unknown[] };
    evidenceReconciledAt?: string;
    evidenceReviewVersion?: string;
  };
  assert.equal(memo.aiEvidenceReview?.rows?.length, 0, "the run found no claims");
  assert.equal(memo.aiEvidenceReview?.checkedText, "The council approved the $547.5 million budget on Tuesday.");
  assert.ok(
    memo.evidenceReviewVersion,
    "the check stamps the identity of the draft it covered, so an edit reopens the gate",
  );

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);

  /* A redraft moves the story on: the check covered the old version. */
  const [newDraft] = await sql.query<{ id: number }>(
    "select id from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",
    [f.newsroomId, f.leadId],
  );
  await sql.query("update drafts set body=$1, updated_at=now() where id=$2", [
    "The council approved the $547.5 million budget after a long debate.",
    newDraft!.id,
  ]);
  await sql.query("delete from articles where newsroom_id=$1", [f.newsroomId]);
  const afterEdit = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(afterEdit.ok, false, "the check does not survive an edit in the zero-claims case");
  assert.match(afterEdit.ok ? "" : afterEdit.error, /nothing has been checked/);
});

it("leaves a story with recorded claims to the ordinary claims gate", async () => {
  const f = await fixture();
  const sql = await getSql();
  /* One finding against the readable capture: the evidence check did run, and
     its claim is unreviewed -- the existing U24 refusal, not this one. */
  const [capture] = await sql.query<{ id: number }>(
    "select id from artifact_versions where newsroom_id=$1 limit 1",
    [f.newsroomId],
  );
  await sql.query("update drafts set found_note=$1 where id=$2", [
    JSON.stringify([
      {
        text: "The 2027 operating budget is $547.5 million.",
        source_urls: [f.url],
        capture_event_ids: [],
        artifact_version_ids: [capture!.id],
        locators: [],
      },
    ]),
    f.draftId,
  ]);
  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false);
  assert.match(printed.ok ? "" : printed.error, /has not been reviewed/);
});

it("the acknowledgement survives an unchanged editor save (derived styleAudit) and reopens on a headline-only edit", async () => {
  const f = await fixture();
  const sql = await getSql();
  const { evidenceReviewToken } = await vite.ssrLoadModule("/src/lib/news/draft-evidence.ts");
  const { topicConfirmationFingerprint } = await vite.ssrLoadModule("/src/lib/news/notes.ts");
  await acknowledge({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, await currentToken(f));

  /* The ordinary save / publish-time save: the same fields the page holds. The
     derived style record lands in the memo but is not part of the identity, so
     the acknowledgement still names the saved version. */
  await saveDraftForEditor(
    { userId: f.userId, newsroomId: f.newsroomId },
    {
      leadId: f.leadId,
      headline: "Council adopts the budget",
      dek: "The 5-2 vote funds the plan.",
      body: "The council approved the $547.5 million budget on Tuesday.",
      topic: "council",
    },
  );
  const [saved] = await sql.query<import("./types.ts").DraftRow>(
    `select id, lead_id, headline, dek, body, topic, source_urls, integrity_notes, updated_at,
            provenance_json, form, found_note, unanswered, research_json
       from drafts where id=$1`,
    [f.draftId],
  );
  const notes = JSON.parse(
    (await sql.query<{ notes_json: string }>("select notes_json from leads where id=$1", [f.leadId]))[0]!.notes_json,
  ) as { uncheckedStoryConfirmation?: { token: string } };
  assert.equal(
    notes.uncheckedStoryConfirmation?.token,
    topicConfirmationFingerprint(evidenceReviewToken(saved!)),
    "an unchanged save leaves the acknowledgement naming the same version",
  );

  /* A HEADLINE-only edit: the body's checked text still matches, so only the
     identity can take this back. It must. */
  const [row] = await sql.query<{ dek: string; body: string }>(
    "select dek, body from drafts where id=$1",
    [f.draftId],
  );
  await saveDraftForEditor(
    { userId: f.userId, newsroomId: f.newsroomId },
    { leadId: f.leadId, headline: "Council passes the budget", dek: row!.dek, body: row!.body, topic: "council" },
  );
  const afterHeadline = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(afterHeadline.ok, false, "an acknowledgement is for the words the editor read");
  assert.match(afterHeadline.ok ? "" : afterHeadline.error, /nothing has been checked/);
});

it("a legacy zero-claim completed check survives an unchanged save and reopens on a headline-only edit", async () => {
  const f = await fixture();
  const sql = await getSql();
  /* A completion from before the identity stamp existed: the reconcile stamp and
     a checked text matching the body, and NO `evidenceReviewVersion` key. */
  await sql.query("update drafts set research_json=$1 where id=$2", [
    JSON.stringify({
      aiEvidenceReview: {
        checkedText: "The council approved the $547.5 million budget on Tuesday.",
        rows: [],
      },
      evidenceReconciledAt: "2026-10-10T02:20:39.040Z",
    }),
    f.draftId,
  ]);

  /* An unchanged save must not take the legate completion back. */
  await saveDraftForEditor(
    { userId: f.userId, newsroomId: f.newsroomId },
    {
      leadId: f.leadId,
      headline: "Council adopts the budget",
      dek: "The 5-2 vote funds the plan.",
      body: "The council approved the $547.5 million budget on Tuesday.",
      topic: "council",
    },
  );
  const [saved] = await sql.query<{ research_json: string }>(
    "select research_json from drafts where id=$1",
    [f.draftId],
  );
  const memo = JSON.parse(saved!.research_json) as { evidenceReviewVersion?: string };
  assert.equal(
    memo.evidenceReviewVersion,
    undefined,
    "an unchanged save does not stamp a stale identity over a live legacy completion",
  );

  /* A headline-only edit moves the draft's identity, so the legacy completion is
     stamped stale and the gate reopens even though the body's text is unchanged. */
  const [row] = await sql.query<{ dek: string; body: string }>(
    "select dek, body from drafts where id=$1",
    [f.draftId],
  );
  await saveDraftForEditor(
    { userId: f.userId, newsroomId: f.newsroomId },
    { leadId: f.leadId, headline: "Council passes the budget", dek: row!.dek, body: row!.body, topic: "council" },
  );
  const afterHeadline = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(afterHeadline.ok, false);
  assert.match(afterHeadline.ok ? "" : afterHeadline.error, /nothing has been checked/);
});

it("refuses a stale or missing acknowledgement token and audits nothing", async () => {
  const f = await fixture();
  const stale = await currentToken(f);
  /* The draft moves on after the page was drawn. */
  await f.sql.query("update drafts set body=$1, updated_at=now() where id=$2", [
    "The council approved the $547.5 million budget after a debate.",
    f.draftId,
  ]);
  const refused = await acknowledge({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, stale);
  assert.equal(refused.ok, false, "a stale tab must not acknowledge words it never saw");
  assert.match(refused.ok ? "" : refused.error ?? "", /changed since this page was drawn/);
  /* And a press that carried no token at all is refused the same way. */
  const empty = await acknowledge({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, "");
  assert.equal(empty.ok, false);
  const [audited] = await f.sql.query<{ action: string }>(
    "select action from audit_events where newsroom_id=$1 and action='publish-unchecked-acknowledged'",
    [f.newsroomId],
  );
  assert.equal(audited, undefined, "a refused press writes no audit row");
});

it("still demands the unchecked sentence when a zero-claim draft has only flagged specifics covered by an existing acceptance", async () => {
  const f = await fixture();
  /*
    The review's own claim stacks are EMPTY: no findings, no reported claims, no
    manual claims. All it carries is a grounding row -- a detected specific the
    audit flagged `Could not check` -- and an unreviewed-claims acceptance is on
    file so the OLD gate would print. The zero-claims gate is independent of that
    count, so the exact unchecked sentence must still be returned.
  */
  await f.sql.query("update leads set notes_json=$1 where id=$2", [
    JSON.stringify({
      unreviewedClaimsConfirmation: { count: 3, token: "whatever", at: new Date().toISOString(), by: f.userId },
    }),
    f.leadId,
  ]);
  const groundingRows = [{ kind: "date" as const, text: "Tuesday" }];
  const deps = {
    loadReview: async () => ({
      rows: [],
      claimRows: [],
      manualClaimRows: [],
      groundingRows,
      evidenceToken: "review-token",
    }),
  };
  const printed = await performPublish(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    SECTION,
    undefined,
    deps,
  );
  assert.equal(printed.ok, false);
  assert.equal(
    printed.ok ? "" : printed.error,
    "No claims were recorded for this story, so nothing has been checked. Run the evidence check, or read it against your sources and press 'I checked this story myself'.",
  );
});
