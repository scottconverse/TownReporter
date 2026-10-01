import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/** The token the editor's screen would have been holding (unit U24b). */
async function reviewToken(f: {
  newsroomId: number;
  leadId: number;
}): Promise<string> {
  const { unreviewedClaimsGate } = await vite.ssrLoadModule("/src/lib/news/desk.ts");
  return (await unreviewedClaimsGate(f.newsroomId, f.leadId)).evidenceToken;
}

/**
 * Unit U24: a story does not print with claims its own evidence check raised
 * and nobody judged -- unless a person says so, on the record.
 *
 * THE FINDING. On the stand-in editorial day (2026-09-30) a draft went to
 * paper carrying seven claims its Checks pane had chipped `! Needs review`,
 * and nothing on the page mentioned them: not a chip, not the bar, not the
 * list above it, not the publish confirmation. The desk had the list and did
 * not act on it.
 *
 * WHAT THIS FILE PROVES, against the real `performPublish` on a real (PGlite)
 * database:
 *
 *   1. The gate exists. A draft whose review resolves claims nobody has judged
 *      is REFUSED, in a sentence that says how many and what to do.
 *   2. The refusal is not a dead end. Judging the claim clears it, and so does
 *      the recorded override -- which is attributable and dated.
 *   3. The override is for ONE draft version. Editing the story takes it back,
 *      because the claims a person accepted are the claims they read.
 *   4. The desk's blocker and the server's refusal agree, because both count
 *      with the same function over the same resolved review.
 *
 * MUTATION, and it is the whole point of the file: deleting the
 * `if (outstandingClaims > 0) { ... }` block from `performPublish` makes the
 * first test fail with a published slug where it expects a refusal.
 *
 * `draft-evidence-serialization.test.ts` is the model: the real schema, the
 * real server functions, no faked database.
 */

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performPublish: typeof import("./desk.ts").performPublish;
let performAcceptUnreviewedClaims: typeof import("./desk.ts").performAcceptUnreviewedClaims;
let unreviewedClaimCount: typeof import("./desk.ts").unreviewedClaimCount;
let parseFindings: typeof import("./findings.ts").parseFindings;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performPublish, performAcceptUnreviewedClaims, unreviewedClaimCount } =
    await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ parseFindings } = await vite.ssrLoadModule("/src/lib/news/findings.ts"));
});

after(async () => vite.close());

let sequence = 98600;

/**
 * A newsroom with one drafted story whose evidence check raised one claim
 * against one readable captured record, and where everything ELSE publish
 * wants is satisfied -- section on the button, dek written, sources cited.
 * The claim nobody has judged is then the only variable in the test.
 */
async function fixture() {
  const sql = await getSql();
  const newsroomId = sequence++;
  const userId = `u24-editor-${newsroomId}`;
  const url = `https://records.example/u24-${newsroomId}`;
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
  const [capture] = await sql.query<{ id: number }>(
    "insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,$2,$3,'u24','Council record','The adopted budget message sets the 2027 operating budget at $547.5 million.') returning id",
    [userId, newsroomId, url],
  );
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Council adopts the budget','Why','council','drafted',$3,'',1,'{}') returning id",
    [userId, newsroomId, JSON.stringify([url])],
  );
  const body = "The council adopted the budget after a short debate.";
  const findings = parseFindings([
    {
      text: "The 2027 operating budget is $547.5 million.",
      source_urls: [url],
      capture_event_ids: [],
      artifact_version_ids: [capture.id],
      locators: ["Budget message, page 1"],
      excerpt: "$547.5 million operating budget",
    },
  ]);
  const [draft] = await sql.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,source_urls,integrity_notes,provenance_json,form,found_note,unanswered,research_json) values($1,$2,$3,'Council adopts the budget','The 5-2 vote funds the plan.',$4,'council',$5,'','[]','news',$6,'[]','{}') returning id",
    [userId, newsroomId, lead.id, body, JSON.stringify([url]), JSON.stringify(findings)],
  );
  return { sql, newsroomId, userId, leadId: lead.id, draftId: draft.id, url, captureId: capture.id };
}

/** Append a finding citing the fixture's readable capture, so it counts. */
async function addFinding(
  f: Awaited<ReturnType<typeof fixture>>,
  text: string,
): Promise<void> {
  const [draft] = await f.sql.query<{ found_note: string }>(
    "select found_note from drafts where id=$1",
    [f.draftId],
  );
  const findings = JSON.parse(draft!.found_note) as unknown[];
  await f.sql.query("update drafts set found_note=$1 where id=$2", [
    JSON.stringify([
      ...findings,
      {
        text,
        source_urls: [f.url],
        capture_event_ids: [],
        artifact_version_ids: [f.captureId],
        locators: [],
      },
    ]),
    f.draftId,
  ]);
}

const SECTION = "council";

it("refuses to print a draft whose evidence check raised a claim nobody judged", async () => {
  const f = await fixture();

  assert.equal(
    await unreviewedClaimCount(f.newsroomId, f.leadId),
    1,
    "fixture: the finding cites a readable captured record, so it is review work",
  );

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false, "a claim nobody judged must not reach the paper by itself");
  assert.match(
    printed.ok ? "" : printed.error,
    /1 claim from the evidence check has not been reviewed/,
  );
  const [article] = await f.sql.query("select id from articles where newsroom_id=$1", [f.newsroomId]);
  assert.equal(article, undefined, "nothing printed");
});

it("lets the story print once the claim has been judged", async () => {
  const f = await fixture();
  /*
    The editor's own answer, through the real path the Checks pane's judgment
    controls use -- not a hand-written memo. It matters that this is the real
    one: `persistFindingEvidenceJudgment` binds the judgment to the captured
    records it was made against (`evidenceBinding`), and `resolveFinding`
    throws a judgment away when that binding no longer matches. A fixture that
    wrote the memo itself would prove nothing about whether judging a claim
    actually clears this gate -- it would only prove that a JSON blob with the
    right shape does.
  */
  const { loadFindingEvidenceReview, persistFindingEvidenceJudgment } = await vite.ssrLoadModule(
    "/src/lib/news/finding-evidence-review.ts",
  );
  const review = await loadFindingEvidenceReview(await getSql(), f.newsroomId, f.leadId);
  assert.equal(review.rows.length, 1, "fixture: one finding to judge");
  await persistFindingEvidenceJudgment(
    { newsroomId: f.newsroomId },
    {
      leadId: f.leadId,
      draftId: f.draftId,
      findingKey: "finding:0",
      judgment: "supports",
      reason: "",
      contraryVersionId: null,
      evidenceToken: review.evidenceToken,
    },
  );
  assert.equal(
    await unreviewedClaimCount(f.newsroomId, f.leadId),
    0,
    "the judged claim is no longer review work",
  );

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
});

it("records an explicit acceptance, and prints on it", async () => {
  const f = await fixture();

  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await reviewToken(f),
  );
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
  assert.equal(accepted.ok ? accepted.count : 0, 1, "the acceptance names how many claims went unreviewed");

  /* The record is a real one: who accepted, when, and which draft version. */
  const [row] = await f.sql.query<{ notes_json: string }>(
    "select notes_json from leads where id=$1",
    [f.leadId],
  );
  const stored = JSON.parse(row!.notes_json) as {
    unreviewedClaimsConfirmation?: { count: number; token: string; at: string; by: string };
  };
  const confirmation = stored.unreviewedClaimsConfirmation;
  assert.equal(confirmation?.count, 1);
  assert.equal(confirmation?.by, f.userId);
  assert.ok(confirmation?.at, "an acceptance without a time is not a record");
  assert.ok(confirmation?.token, "an acceptance without a draft version would outlive the claims");

  const [audited] = await f.sql.query<{ action: string }>(
    "select action from audit_events where newsroom_id=$1 and action='accept_unreviewed_claims'",
    [f.newsroomId],
  );
  assert.ok(audited, "the override is on the audit trail, like the other overrides");

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, true, printed.ok ? "" : printed.error);
  const [printAudit] = await f.sql.query<{ action: string }>(
    "select action from audit_events where newsroom_id=$1 and action='publish-unreviewed-claims'",
    [f.newsroomId],
  );
  assert.ok(printAudit, "and the print that used it says so too");
});

it("the acceptance is for one draft version, and an edit takes it back", async () => {
  const f = await fixture();
  await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await reviewToken(f),
  );

  /* The story moves on. The claims a person accepted were the claims they
     READ, so the acceptance must not carry to words nobody has seen. */
  await f.sql.query("update drafts set body=$1, updated_at=now() where id=$2", [
    "The council adopted the budget after a long and contested debate.",
    f.draftId,
  ]);

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false, "an edited story is not covered by the old acceptance");
  assert.match(printed.ok ? "" : printed.error, /has not been reviewed/);
});

it("refuses an acceptance carrying a review token that has moved", async () => {
  /*
    UNIT U24b. The acceptance is "I read THESE claims", so the press carries the
    review the editor's screen was holding and the server compares it against
    the review it can see now -- exactly what every judgment save does. A stale
    tab, or a review that moved between the page being drawn and the press,
    records nothing rather than recording a permission for claims nobody read.
  */
  const f = await fixture();
  const stale = await reviewToken(f);
  /* The review moves: a judgment saved in another tab. */
  await f.sql.query(
    "update drafts set research_json=$1 where id=$2",
    [JSON.stringify({ findingEvidenceReview: { contentToken: "moved", judgments: {} } }), f.draftId],
  );
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    stale,
  );
  assert.equal(accepted.ok, false);
  assert.match(accepted.ok ? "" : accepted.error, /changed since this page was drawn/);
  /* And a press that carried no review at all is refused the same way. */
  const empty = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    "",
  );
  assert.equal(empty.ok, false);
  assert.match(empty.ok ? "" : empty.error, /changed since this page was drawn/);
});

it("will not print on an acceptance given for fewer claims than are outstanding now", async () => {
  /*
    UNIT U24b -- THE COUNT FLOOR. Three claims were accepted. A judgment the
    desk then DOWNGRADES to unreviewed -- because the capture behind it changed,
    or its binding moved -- raises the number the story must answer for without
    touching the draft row, so the acceptance's fingerprint still matches while
    the claims it covered no longer do. "I accepted three" must not print four.
  */
  const f = await fixture();
  const token = await reviewToken(f);
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    token,
  );
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
  assert.equal(accepted.ok ? accepted.count : 0, 1);

  /* A second finding arrives -- a redraft, a re-check, a claim added by hand --
     and nothing in the acceptance covered it. Note that the acceptance's own
     fingerprint still matches, because it is a hash of the draft row and the
     findings live beside it in `found_note`... which is in the row, so this
     edit DOES move the token too; the count floor is what covers the other
     road, where a judgment is downgraded without the row changing at all. Both
     are refused, and this pins the count. */
  await addFinding(f, "The council also set the mill levy at 2.44 mills.");
  assert.equal(await unreviewedClaimCount(f.newsroomId, f.leadId), 2);

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false, "the old acceptance does not cover a claim that arrived after it");
  assert.match(printed.ok ? "" : printed.error, /2 claims from the evidence check/);
});

it("will not print more claims than the editor accepted, when one is downgraded behind them", async () => {
  /*
    THE ROAD THE FINGERPRINT CANNOT SEE, and the reason the count floor exists.

    `resolveFinding` silently downgrades a recorded judgment back to
    `unreviewed` when its evidence binding moved -- the captured record's text
    changed under it. That happens in the RESOLVED review; the draft row is not
    touched, so the acceptance's token still matches while the number of claims
    to answer for grows by one. Without the floor, "I accepted one" prints two.
  */
  const f = await fixture();
  await addFinding(f, "The council also set the mill levy at 2.44 mills.");
  const { loadFindingEvidenceReview, persistFindingEvidenceJudgment } = await vite.ssrLoadModule(
    "/src/lib/news/finding-evidence-review.ts",
  );
  const review = await loadFindingEvidenceReview(await getSql(), f.newsroomId, f.leadId);
  assert.equal(review.rows.length, 2);
  /* Judge the FIRST one, so exactly one claim is left outstanding. */
  await persistFindingEvidenceJudgment(
    { newsroomId: f.newsroomId },
    {
      leadId: f.leadId,
      draftId: f.draftId,
      findingKey: "finding:0",
      judgment: "supports",
      reason: "",
      contraryVersionId: null,
      evidenceToken: review.evidenceToken,
    },
  );
  assert.equal(await unreviewedClaimCount(f.newsroomId, f.leadId), 1);

  const token = await reviewToken(f);
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    token,
  );
  assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
  assert.equal(accepted.ok ? accepted.count : 0, 1, "one claim was accepted");

  /* The record behind the JUDGED claim changes, so `resolveFinding` drops that
     judgment -- in the RESOLVED review. The draft row is not touched, which is
     the whole point: the acceptance's own fingerprint is over that row, so it
     still matches and only the count can refuse this. */
  await f.sql.query("update artifact_versions set full_text=$1 where id=$2", [
    "A different record entirely.",
    f.captureId,
  ]);
  assert.equal(await unreviewedClaimCount(f.newsroomId, f.leadId), 2);

  const printed = await performPublish({ userId: f.userId, newsroomId: f.newsroomId }, f.leadId, SECTION);
  assert.equal(printed.ok, false, "the accepted count no longer covers what is outstanding");
  /* `you accepted 1` appears only on the branch where the acceptance DID match
     this draft version -- so this assertion is also the proof that the floor,
     and not the fingerprint, is what refused it. */
  assert.match(printed.ok ? "" : printed.error, /you accepted 1, and 1 more is outstanding now/);
});

it("refuses to record an acceptance when there is nothing to accept", async () => {
  const f = await fixture();
  /* No findings at all: the check raised nothing, so there is no claim a
     person could be accepting. A permission recorded here would be a
     permission that outlives the thing it was about. */
  await f.sql.query("update drafts set found_note='[]' where id=$1", [f.draftId]);
  assert.equal(await unreviewedClaimCount(f.newsroomId, f.leadId), 0);
  const accepted = await performAcceptUnreviewedClaims(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    await reviewToken(f),
  );
  assert.equal(accepted.ok, false);
  assert.match(accepted.ok ? "" : accepted.error, /nothing to accept/i);
});

it("FAILS CLOSED when the review cannot be read at all", async () => {
  /*
    UNIT U24b. U24's counter wrapped everything in a bare `catch { return 0 }`,
    so a transient database error read as "nothing outstanding" and OPENED the
    gate for as long as the outage lasted. Only the unreadable-stored-findings
    error may be swallowed; everything else has to come out.
  */
  const f = await fixture();
  const brokenDb = async () => {
    throw new Error("connection terminated unexpectedly");
  };
  await assert.rejects(
    () => unreviewedClaimCount(f.newsroomId, f.leadId, { loadReview: brokenDb }),
    /connection terminated/,
    "an infrastructure failure must not be answered with 0",
  );

  /* And the publish refuses, in words, rather than printing the story:
     `unreviewedClaimCount` throwing is what used to open the gate. */
  const { performPublish: publish } = await vite.ssrLoadModule("/src/lib/news/desk.ts");
  const printed = await publish(
    { userId: f.userId, newsroomId: f.newsroomId },
    f.leadId,
    SECTION,
    undefined,
    { loadReview: brokenDb },
  );
  assert.equal(printed.ok, false, "a publish that cannot be checked does not happen");
  assert.match(printed.ok ? "" : printed.error, /could not read this draft's evidence review/);
  const [article] = await f.sql.query("select id from articles where newsroom_id=$1", [f.newsroomId]);
  assert.equal(article, undefined, "nothing printed");
});

it("still swallows the one error that really means 'no findings to count'", async () => {
  /*
    The other half of failing closed: a draft whose stored findings will not
    parse has no review to resolve, and the Checks pane already shows those rows
    as unreadable. A publish that hard-failed on them would be a story nobody
    could print or fix, so THIS error is the one that answers 0.
  */
  const f = await fixture();
  /* The real error, raised by the real reader: `assertReadableStoredFindings`
     throws a `ReviewError("invalid-input")` for exactly this row. */
  await f.sql.query("update drafts set found_note='[not json' where id=$1", [f.draftId]);
  assert.equal(
    await unreviewedClaimCount(f.newsroomId, f.leadId),
    0,
    "a draft with unreadable stored findings has no claims to count",
  );
});

it("is called from the page with the shape its own schemas take", () => {
  /*
    The tests above call `performAcceptUnreviewedClaims` directly, so they
    cannot see the one thing that would break in the browser: the wire shape.
    `acceptUnreviewedClaimsInput` is `{ leadId, evidenceToken }` -- a NUMBER and
    a STRING -- and a press passing a bare id, or omitting the token, would fail
    validation and report a schema dump to the editor. TypeScript cannot catch
    it (a server function's validator input is untyped at the call site), so the
    tripwire is here.
  */
  const page = readFileSync(
    new URL("../../routes/desk.story.$leadId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /acceptUnreviewedClaims\(\{\s*data: \{ leadId: id, evidenceToken:/);
  assert.doesNotMatch(page, /acceptUnreviewedClaims\(\{ data: id \}\)/);
});
