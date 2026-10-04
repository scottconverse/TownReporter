import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  loadMeetingAccounting,
  loadStoredLedgerForRewrite,
  markClaimReviewed,
  saveLedgerItemStatus,
} from "./meeting-ledger.server.ts";

/*
  WR1 phase 2's writes, against the migrated schema. 0120's tables and 0121's
  `draft_claims.reviewed_at` are written here and nowhere else in the test
  suite, so this is the file that proves the panel's two server-side writes --
  a ledger status, a claim's checked mark -- have columns to land in.

  No model call, no network: every function under test is a plain SQL write,
  driven against a PGlite carrying the same migrations the app applies.

  The fixture is two newsrooms with their own leads and drafts. That is the
  point of the second one: every write here is scoped by `newsroom_id`, and the
  only way to prove it is to hand a write the OTHER room's row and watch it
  refuse.
*/

await applyMigrationsToTestPglite();

const NEWSROOM = 951;
const OTHER_NEWSROOM = 952;
const USER = "wr1-screen-editor";

let ourLeadId = 0;
let ourDraftId = 0;
let rewriteLeadId = 0;
let rewriteDraftId = 0;
let otherLeadId = 0;
let otherDraftId = 0;

/** One lead, its draft, and whatever ledger/claim rows the test needs on them. */
async function seed(
  sql: Awaited<ReturnType<typeof getSql>>,
  input: {
    newsroomId: number;
    headline: string;
    ledger: { itemNo: number; kind: string; text: string; status: string; reason: string }[];
    claims: { claim: string; checkStatus: "found" | "flagged" }[];
    meetingNotes?: string;
    runStats?: Record<string, number>;
  },
): Promise<{ leadId: number; draftId: number }> {
  const leads = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,source_urls)
     values ($1,$2,$3,'the tape covers it','council','[]') returning id`,
    [USER, input.newsroomId, input.headline],
  );
  const leadId = Number(leads[0]!.id);
  const drafts = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic,meeting_notes,run_stats)
     values ($1,$2,$3,'H','','body','council',$4,$5) returning id`,
    [
      USER,
      input.newsroomId,
      leadId,
      input.meetingNotes ?? null,
      input.runStats ? JSON.stringify(input.runStats) : null,
    ],
  );
  const draftId = Number(drafts[0]!.id);
  for (const item of input.ledger) {
    await sql.query(
      `insert into meeting_ledger_items
         (newsroom_id,draft_id,lead_id,item_no,kind,text,start_seconds,packet_page,status,reason,source_excerpt)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.newsroomId,
        draftId,
        leadId,
        item.itemNo,
        item.kind,
        item.text,
        item.itemNo * 10,
        57,
        item.status,
        item.reason,
        `source words for item ${item.itemNo}`,
      ],
    );
  }
  for (const claim of input.claims) {
    await sql.query(
      `insert into draft_claims(newsroom_id,draft_id,claim,source_kind,source_ref,check_status,note)
       values ($1,$2,$3,'primary','packet text',$4,'checked in code')`,
      [input.newsroomId, draftId, claim.claim, claim.checkStatus],
    );
  }
  return { leadId, draftId };
}

before(async () => {
  const sql = await getSql();
  for (const [id, name] of [
    [NEWSROOM, "WR1 screen room"],
    [OTHER_NEWSROOM, "WR1 other room"],
  ] as const) {
    await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [id, name]);
  }
  // The room the panel is read in: an unread window, a lead item, a roundup
  // item, a flagged claim, a found one, and the run's own record.
  const ours = await seed(sql, {
    newsroomId: NEWSROOM,
    headline: "Council takes up airport noise policy",
    ledger: [
      { itemNo: 1, kind: "unread-window", text: "Window 2 could not be inventoried.", status: "unread", reason: "" },
      { itemNo: 2, kind: "vote", text: "Airport noise policy carries unanimously", status: "lead", reason: "the meeting's main decision" },
      { itemNo: 3, kind: "staff-report", text: "Proposed 2027 airport fund budget totals $733,170", status: "roundup", reason: "a budget detail" },
    ],
    claims: [
      { claim: "$9,999,999", checkStatus: "flagged" },
      { claim: "$733,170", checkStatus: "found" },
    ],
    meetingNotes: "LEDGER: 3 item(s); 1 lead, 1 roundup, 0 excluded, 1 unread.\n\nCOLD CHECK: no mismatches reported.",
    runStats: { wallMs: 720_000, modelCalls: 57, inputTokens: 410_000, outputTokens: 38_000 },
  });
  ourLeadId = ours.leadId;
  ourDraftId = ours.draftId;

  // A second lead in the same room, for the rewrite's read-back, so the tests
  // above cannot see its statuses changed under them.
  const rewrite = await seed(sql, {
    newsroomId: NEWSROOM,
    headline: "Council takes up the staffing plan",
    ledger: [
      { itemNo: 1, kind: "motion", text: "Direct staff on the staffing plan", status: "roundup", reason: "a detail" },
      { itemNo: 2, kind: "vote", text: "The staffing motion is tabled", status: "lead", reason: "the decision" },
    ],
    claims: [],
  });
  rewriteLeadId = rewrite.leadId;
  rewriteDraftId = rewrite.draftId;

  // Another newsroom's lead and draft: the rows every scoped write must refuse.
  const other = await seed(sql, {
    newsroomId: OTHER_NEWSROOM,
    headline: "A story in another paper",
    ledger: [{ itemNo: 1, kind: "vote", text: "Their motion", status: "roundup", reason: "theirs" }],
    claims: [{ claim: "$1", checkStatus: "found" }],
  });
  otherLeadId = other.leadId;
  otherDraftId = other.draftId;
});

describe("meeting ledger writes", () => {
  it("saves a status for this newsroom's draft and refuses another newsroom's", async () => {
    /*
      The panel writes through the desk's server function, which passes the
      caller's newsroom. The write has to land on this room's row and must not
      touch a draft in another room -- so the other room's draft id is handed to
      the same call and answers with a refusal, and the other room's row is read
      back unchanged.
    */
    const sql = await getSql();
    const saved = await saveLedgerItemStatus(sql, {
      newsroomId: NEWSROOM,
      draftId: ourDraftId,
      itemNo: 3,
      status: "excluded",
      reason: "split into its own story",
    });
    assert.deepEqual(saved, { ok: true }, "the editor's own draft saves");

    const rows = await sql.query<{ status: string; reason: string }>(
      `select status,reason from meeting_ledger_items where draft_id=$1 and item_no=3`,
      [ourDraftId],
    );
    assert.equal(rows[0]!.status, "excluded", "the new status is stored");
    assert.equal(rows[0]!.reason, "split into its own story", "the reason travels with it");

    const refused = await saveLedgerItemStatus(sql, {
      newsroomId: NEWSROOM,
      draftId: otherDraftId,
      itemNo: 1,
      status: "lead",
      reason: "",
    });
    assert.equal(refused.ok, false, "a draft id from another newsroom cannot be written");
    assert.match((refused as { error: string }).error, /not in this newsroom/);

    const theirs = await sql.query<{ status: string }>(
      `select status from meeting_ledger_items where draft_id=$1 and item_no=1`,
      [otherDraftId],
    );
    assert.equal(theirs[0]!.status, "roundup", "the other newsroom's row is exactly as it was");
  });

  it("will not exclude an item without a reason, and will not take a status an editor does not set", async () => {
    /*
      Excluding an item is a decision the next reader has to be able to read, so
      it will not save with an empty reason -- nor with one that is only
      whitespace. `unread` is not an editor's decision at all: it is what the run
      recorded, so it is refused too.
    */
    const sql = await getSql();
    const blank = await saveLedgerItemStatus(sql, {
      newsroomId: NEWSROOM,
      draftId: ourDraftId,
      itemNo: 2,
      status: "excluded",
      reason: "   ",
    });
    assert.equal(blank.ok, false, "excluded with whitespace-only reason is refused");
    assert.match((blank as { error: string }).error, /reason is required/i);

    const notAnEditorStatus = await saveLedgerItemStatus(sql, {
      newsroomId: NEWSROOM,
      draftId: ourDraftId,
      itemNo: 2,
      status: "unread" as never,
      reason: "",
    });
    assert.equal(notAnEditorStatus.ok, false, "`unread` is recorded by the run, not set by an editor");
    assert.match((notAnEditorStatus as { error: string }).error, /not one an editor can set/);

    const rows = await sql.query<{ status: string }>(
      `select status from meeting_ledger_items where draft_id=$1 and item_no=2`,
      [ourDraftId],
    );
    assert.equal(rows[0]!.status, "lead", "a refused write changes nothing");
  });

  it("records that a claim was checked, and clears the mark again", async () => {
    /*
      `reviewed_at` IS the mark: its presence says a person read the row, and
      un-checking sets it back to NULL. A claim id from another newsroom is
      refused on the same rule as the ledger write.
    */
    const sql = await getSql();
    const before = await loadMeetingAccounting(sql, { newsroomId: NEWSROOM, leadId: ourLeadId });
    const claim = before.claims.find((row) => row.claim === "$733,170");
    assert.ok(claim, "the fixture's found claim must be readable");
    assert.equal(claim!.reviewedAt, null, "a fresh claim is not yet reviewed");

    const marked = await markClaimReviewed(sql, { newsroomId: NEWSROOM, claimId: claim!.id, reviewed: true });
    assert.deepEqual(marked, { ok: true });

    const after = await loadMeetingAccounting(sql, { newsroomId: NEWSROOM, leadId: ourLeadId });
    const seen = after.claims.find((row) => row.id === claim!.id);
    assert.ok(seen!.reviewedAt, "the checked mark persists as a timestamp");

    const otherClaim = (await loadMeetingAccounting(sql, { newsroomId: OTHER_NEWSROOM, leadId: otherLeadId }))
      .claims[0]!;
    const refused = await markClaimReviewed(sql, {
      newsroomId: NEWSROOM,
      claimId: otherClaim.id,
      reviewed: true,
    });
    assert.equal(refused.ok, false, "another newsroom's claim cannot be marked");
    assert.match((refused as { error: string }).error, /not in this newsroom/);

    await markClaimReviewed(sql, { newsroomId: NEWSROOM, claimId: claim!.id, reviewed: false });
    const cleared = await loadMeetingAccounting(sql, { newsroomId: NEWSROOM, leadId: ourLeadId });
    assert.equal(
      cleared.claims.find((row) => row.id === claim!.id)!.reviewedAt,
      null,
      "un-checking clears the mark",
    );
  });

  it("leads the reading with the unread rows and the flagged claims", async () => {
    /*
      The panel's rule, read from the loader: the part of the tape nobody read
      comes first, then the decisions; a flagged claim comes before a found one.
      The run's notes and cost are carried through intact.
    */
    const sql = await getSql();
    const accounting = await loadMeetingAccounting(sql, { newsroomId: NEWSROOM, leadId: ourLeadId });
    assert.equal(accounting.draftId, ourDraftId, "the accounting names the lead's latest ledgered draft");
    assert.equal(accounting.ledger[0]!.status, "unread", "the unread row is first");
    assert.ok(
      accounting.ledger.slice(1).every((row) => row.status !== "unread"),
      "and it is the only warning row",
    );
    assert.equal(accounting.claims[0]!.checkStatus, "flagged", "a flagged claim leads the claims list");
    assert.match(accounting.meetingNotes, /COLD CHECK/, "the whole run record is carried, uncut");
    assert.equal(accounting.runStats?.modelCalls, 57, "the run's model-call count is read back");
  });

  it("hands a rewrite the statuses the editor set on the stored ledger", async () => {
    /*
      Rewrite from ledger reads the ledger already stored for the lead, carrying
      the editor's statuses. What this proves is that a save and a later read
      agree -- and that the read is scoped to the caller's newsroom, so another
      room's lead yields nothing.
    */
    const sql = await getSql();
    await saveLedgerItemStatus(sql, {
      newsroomId: NEWSROOM,
      draftId: rewriteDraftId,
      itemNo: 1,
      status: "excluded",
      reason: "covered by the lead",
    });
    const stored = await loadStoredLedgerForRewrite(sql, { newsroomId: NEWSROOM, leadId: rewriteLeadId });
    const excluded = stored.find((item) => item.itemNo === 1);
    assert.equal(excluded!.status, "excluded", "the rewrite reads the edited status");
    assert.equal(excluded!.reason, "covered by the lead", "and its reason");
    assert.ok(excluded!.sourceExcerpt.length > 0, "the verbatim excerpt comes with it");

    const none = await loadStoredLedgerForRewrite(sql, { newsroomId: NEWSROOM, leadId: otherLeadId });
    assert.deepEqual(none, [], "another newsroom's lead has no ledger for this caller");
  });
});
