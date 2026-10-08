import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  loadOrFetchMeetingPacket,
  loadWholeMeetingInput,
  packetDocumentForMeeting,
  persistWholeMeetingAccounting,
  runWholeMeetingDraft,
} from "./meeting-whole.server.ts";
import {
  COLD_CHECK_SYSTEM,
  INVENTORY_SYSTEM,
  LEAD_WRITE_SYSTEM,
  LEDGER_STATUS_SYSTEM,
} from "./meeting-whole.ts";
import { loadMeetingAccounting, loadStoredLedgerForRewrite } from "./meeting-ledger.server.ts";
import type { IngestDocument } from "./ingest.ts";
import type { ReportChat } from "./report.ts";
import type { ClaimCheck, LedgerItem, RunStats } from "./meeting-whole.ts";

/*
  WR1's DB half, run against the migrated schema -- the tables 0120 adds are
  written here and nowhere else, so this is the only test that proves the
  insert's column list and the migration agree. No model call and no network:
  the portal, the packet lookup and the document fetch are all injected.

  The meeting is the real Longmont council study session of Sept. 29, 2026,
  shrunk to two segments and one packet page.
*/

// scripts/run-tests-safe.mjs applies migrations/*.sql before this file loads;
// the postgres-integration runner runs the same file without that preload, so
// the fixture asks for the schema itself.
await applyMigrationsToTestPglite();

const NEWSROOM = 941;
const VIDEO = "wr1testVid01";
const USER = "wr1-test-editor";

let artifactId = 0;
let leadId = 0;
let draftId = 0;

before(async () => {
  const sql = await getSql();
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict (id) do nothing", [
    NEWSROOM,
    "WR1 test room",
  ]);
  const artifacts = await sql.query<{ id: number }>(
    `insert into meeting_transcript_artifacts
       (newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (newsroom_id,video_id,artifact_type,sha256) where artifact_type='transcript' do update set updated_at=now()
     returning id`,
    [NEWSROOM, VIDEO, "/tmp/wr1.vtt", "vtt", "wr1testsha", "captions", "transcript-only"],
  );
  artifactId = Number(artifacts[0]!.id);
  await sql.query(
    `insert into meeting_transcript_segments
       (artifact_id,segment_index,start_seconds,end_seconds,item,excerpt,caption_sha256)
     values ($1,0,0,12,'1',$2,'seg0'), ($1,1,12,40,'1',$3,'seg1')
     on conflict (artifact_id,segment_index) do nothing`,
    [
      artifactId,
      "Okay. And that carries unanimously. So, do we have a motion for directing",
      "Council Member Popkin. Thank you, Mayor. Um, as I said before, I would encourage us to not give direction",
    ],
  );
  await sql.query(
    `insert into meeting_agenda_chunks
       (newsroom_id,video_id,artifact_id,item,title,start_seconds,end_seconds,segment_indexes)
     values ($1,$2,$3,'1','Airport noise policy',0,40,'[0,1]')
     on conflict (newsroom_id,video_id,item) do nothing`,
    [NEWSROOM, VIDEO, artifactId],
  );
  await sql.query(
    `insert into meeting_structured_votes
       (newsroom_id,video_id,item,established,motion,tally,result,source)
     values ($1,$2,'1',true,'Direct staff on noise policy','7-0','carried','minutes')
     on conflict (newsroom_id,video_id,item) do nothing`,
    [NEWSROOM, VIDEO],
  );
  await sql.query(
    `insert into meeting_capture_records
       (newsroom_id,video_id,channel_url,title,published,status)
     values ($1,$2,$3,$4,$5,'captured')
     on conflict (newsroom_id,video_id) do update set title=excluded.title`,
    [NEWSROOM, VIDEO, "https://www.youtube.com/@longmont", "City Council Study Session", "2026-09-29T00:00:00Z"],
  );
  const leads = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,source_urls)
     values ($1,$2,'Council takes up airport noise policy','the tape covers it','council','[]')
     returning id`,
    [USER, NEWSROOM],
  );
  leadId = Number(leads[0]!.id);
  const drafts = await sql.query<{ id: number }>(
    `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic)
     values ($1,$2,$3,'H','','body','council')
     returning id`,
    [USER, NEWSROOM, leadId],
  );
  draftId = Number(drafts[0]!.id);
});

const MEETING = {
  id: 1,
  title: "City Council Study Session",
  date: "2026-09-29",
  dateTime: "2026-09-29T19:00:00",
  time: "7:00 PM",
  location: "Civic Center",
  documentList: [
    { id: 1, templateId: 9, compileOutputType: 1, templateName: "Agenda", link: null },
    { id: 2, templateId: 11, compileOutputType: 2, templateName: "Packet", link: null },
  ],
};

const PACKET_PAGE_57 = `NEXTLIGHT BUDGET SUMMARY
The NextLight 2027 budget reflects $24,907,816 in expenses and $24,197,712 in revenue.
AIRPORT BUDGET SUMMARY
The 2027 proposed Airport Fund budget totals $733,170, a $7,796 (1.07%) increase.`;

function packetDocument(): IngestDocument {
  return {
    ok: true,
    status: 200,
    outcome: "fetched",
    text: PACKET_PAGE_57,
    title: "Packet",
    extras: [],
    contentType: "application/pdf",
    needsOcr: false,
    redirectChain: [],
    extractionMethod: "unpdf",
    pages: [{ page: 57, text: PACKET_PAGE_57 }],
    notices: [],
  };
}

describe("whole-meeting writer, against the migrated schema", () => {
  it("reads the tape, the agenda alignment and the structured votes into the writer's shapes", async () => {
    const sql = await getSql();
    const material = await loadWholeMeetingInput(sql, {
      newsroomId: NEWSROOM,
      artifactId,
      videoId: VIDEO,
      fallbackTitle: "fallback",
      videoUrl: "https://youtu.be/wr1testVid01",
    });
    assert.equal(material.segments.length, 2, "both stored segments are read");
    assert.deepEqual(
      material.segments.map((segment) => segment.index),
      [0, 1],
      "segments stay in transcript order",
    );
    assert.equal(material.segments[0]!.seconds, 0, "start_seconds arrives as a number, not the numeric string");
    assert.equal(material.segments[1]!.seconds, 12);
    assert.equal(material.segments[1]!.item, "1", "each segment carries the agenda item it was aligned to");
    assert.equal(material.segments[1]!.itemTitle, "Airport noise policy");
    assert.equal(material.votes.length, 1);
    assert.equal(material.votes[0]!.established, true);
    assert.equal(material.votes[0]!.tally, "7-0");
    // The capture record, not the fallback: the desk's own title for this tape.
    assert.equal(material.meeting.title, "City Council Study Session");
    assert.equal(material.meeting.date, "2026-09-29", "the capture's published date is the meeting date");
  });

  it("fetches the packet's page text through the portal, and says so when there is no portal", async () => {
    const sql = await getSql();
    const packet = await loadOrFetchMeetingPacket(
      sql,
      {
        newsroomId: NEWSROOM,
        userId: USER,
        leadId,
        title: "City Council Study Session",
        modelChoice: "auto",
      },
      {
        primeGovOrigin: async () => "https://example.primegov.com",
        packetForTitle: async () => ({ meeting: MEETING, urls: [] }),
        ingest: async () => packetDocument(),
      },
    );
    assert.deepEqual(
      packet.pages.map((page) => page.page),
      [57],
      "the packet arrives as page text the writer can match agenda titles against",
    );
    assert.match(packet.pages[0]!.text, /\$733,170/, "the page text is the packet's own words");
    assert.equal(packet.note, "", "a packet that read cleanly needs no note");

    const none = await loadOrFetchMeetingPacket(
      sql,
      { newsroomId: NEWSROOM, userId: USER, leadId, title: "City Council Study Session", modelChoice: "auto" },
      { primeGovOrigin: async () => null },
    );
    assert.deepEqual(none.pages, [], "no portal means no packet");
    assert.match(none.note, /No PrimeGov portal is configured/, "and the run note says which");
  });

  it("writes the ledger, the claims and the run stats against the draft row", async () => {
    const sql = await getSql();
    const ledger: LedgerItem[] = [
      {
        itemNo: 1,
        kind: "vote",
        text: "Airport noise policy carries unanimously",
        startSeconds: 0,
        packetPage: 57,
        status: "lead",
        reason: "the meeting's main decision",
        sourceExcerpt: "And that carries unanimously.",
      },
      {
        itemNo: 2,
        kind: "staff-report",
        text: "Proposed 2027 airport fund budget totals $733,170",
        startSeconds: 12,
        packetPage: 57,
        status: "roundup",
        reason: "a budget detail",
        sourceExcerpt: "The 2027 proposed Airport Fund budget totals $733,170.",
      },
    ];
    const claims: ClaimCheck[] = [
      {
        claim: "$733,170",
        sourceKind: "primary",
        sourceRef: "packet text",
        checkStatus: "found",
        note: "Dollar figure stated in the body.",
      },
      {
        claim: "$9,999,999",
        sourceKind: "primary",
        sourceRef: "transcript or packet text",
        checkStatus: "flagged",
        note: "Dollar figure stated in the body.",
      },
    ];
    const runStats: RunStats = { wallMs: 1234, modelCalls: 44, inputTokens: 900, outputTokens: 300 };

    await persistWholeMeetingAccounting(sql, {
      newsroomId: NEWSROOM,
      draftId,
      leadId,
      ledger,
      claims,
      meetingNotes: "LEDGER: 2 item(s); 1 lead, 1 roundup, 0 excluded, 0 unread.",
      runStats,
    });

    const rows = await sql.query<{ item_no: number; status: string; reason: string; source_excerpt: string }>(
      `select item_no,status,reason,source_excerpt from meeting_ledger_items
        where draft_id=$1 order by item_no`,
      [draftId],
    );
    assert.equal(rows.length, 2, "every ledger item becomes a row");
    assert.deepEqual(
      rows.map((row) => row.status),
      ["lead", "roundup"],
    );
    assert.equal(rows[0]!.reason, "the meeting's main decision", "the reason travels with the status");
    assert.match(rows[0]!.source_excerpt, /carries unanimously/, "the verbatim excerpt is stored, not the model's clause");

    const checked = await sql.query<{ claim: string; check_status: string }>(
      `select claim,check_status from draft_claims where draft_id=$1 order by id`,
      [draftId],
    );
    assert.deepEqual(
      checked.map((row) => `${row.claim}:${row.check_status}`),
      ["$733,170:found", "$9,999,999:flagged"],
      "what the record holds and what it does not are both recorded",
    );

    const stored = await sql.query<{ meeting_notes: string | null; run_stats: RunStats | null }>(
      `select meeting_notes,run_stats from drafts where id=$1 and newsroom_id=$2`,
      [draftId, NEWSROOM],
    );
    assert.match(stored[0]!.meeting_notes ?? "", /1 lead, 1 roundup/, "the check results land on the draft row");
    assert.equal(stored[0]!.run_stats?.modelCalls, 44, "the run's model-call count is recorded");
    assert.equal(stored[0]!.run_stats?.wallMs, 1234);
  });

  it("files a whole-meeting draft under the lead's section, not the meeting's title", async () => {
    /*
      The run-1 failure: the writer filed the draft under the meeting's title
      ("City Council Study Session"), which no newsroom has a section for, so the
      sections trigger refused the save. A whole-meeting draft belongs to the
      section its lead was filed under. This drives the real pipeline against the
      migrated schema, then proves both halves: the title is rejected by the
      trigger, and the section key the run returns saves.
    */
    const sql = await getSql();
    const chat: ReportChat = async (system) => {
      if (system.includes(INVENTORY_SYSTEM)) {
        return {
          ok: true,
          text: JSON.stringify({
            items: [
              {
                kind: "vote",
                text: "Airport noise policy carries unanimously",
                who: "",
                timestamp: "0:00:00",
                packet_page: 57,
                numbers: "",
                source_words: "And that carries unanimously.",
              },
            ],
          }),
        };
      }
      if (system.includes(LEDGER_STATUS_SYSTEM)) {
        return { ok: true, text: JSON.stringify({ items: [{ item_no: 1, status: "lead", reason: "the vote" }] }) };
      }
      if (system.includes(LEAD_WRITE_SYSTEM)) {
        return {
          ok: true,
          text: JSON.stringify({ headline: "Council takes up airport noise policy", dek: "One line.", lead: "The council voted on the noise policy." }),
        };
      }
      if (system.includes(COLD_CHECK_SYSTEM)) return { ok: true, text: JSON.stringify({ mismatches: [] }) };
      return { ok: false, error: "unexpected stage" };
    };
    const result = await runWholeMeetingDraft(
      {
        sql,
        newsroomId: NEWSROOM,
        userId: USER,
        leadId,
        artifactId,
        videoId: VIDEO,
        fallbackTitle: "fallback",
        topic: "council",
        modelChoice: "auto",
        chat,
      },
      { primeGovOrigin: async () => null },
    );
    assert.equal(result.draft.topic, "council", "the draft carries the lead's own section key");
    assert.notEqual(result.draft.topic, "City Council Study Session", "and not the meeting's title");

    // The run-1 save failure, in one line: the title a newsroom has no section
    // for is refused by the sections trigger.
    await assert.rejects(
      sql.query(
        `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [USER, NEWSROOM, leadId, "T", "", "b", "City Council Study Session"],
      ),
      /Section not found in this newsroom/,
    );

    const saved = await sql.query<{ id: number }>(
      `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic)
       values($1,$2,$3,$4,$5,$6,$7) returning id`,
      [USER, NEWSROOM, leadId, result.draft.headline, result.draft.dek, result.draft.body, result.draft.topic],
    );
    assert.ok(saved[0]!.id, "the draft the run returns saves under that section");
  });

  it("keeps a procedural motion procedural through the real write, read and rewrite", async () => {
    /*
      The concrete round trip the write map used to break: the ledger is written
      by persistWholeMeetingAccounting, read back by the accounting, and handed
      to the rewrite. A motion the run classified procedural -- a vote to extend
      the meeting, to recess, to adjourn -- must stay procedural at every step,
      and its tally must not be borrowed into the item's own vote result.
    */
    const sql = await getSql();
    const lead = await sql.query<{ id: number }>(
      `insert into leads(user_id,newsroom_id,headline,why,topic,source_urls)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [USER, NEWSROOM, "Procedural round trip", "the tape covers it", "council", "[]"],
    );
    const roundTripLead = Number(lead[0]!.id);
    const draft = await sql.query<{ id: number }>(
      `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [USER, NEWSROOM, roundTripLead, "Procedural round trip", "", "body", "council"],
    );
    const roundTripDraft = Number(draft[0]!.id);
    const ledger: LedgerItem[] = [
      {
        itemNo: 1,
        kind: "motion",
        text: "Motion to extend the meeting to 11:00 PM",
        startSeconds: 3600,
        packetPage: null,
        status: "roundup",
        reason: "the meeting running itself",
        sourceExcerpt: "I move we extend to eleven.",
        // A procedural motion: the meeting running itself, never the policy
        // decision. Its tally is recorded, but it is not the item's vote.
        motions: [{ result: "carried", tally: "6-1", unanimous: "", seconds: 3600, kind: "procedural" }],
        voteResult: "",
        voteTally: "",
      },
      {
        itemNo: 2,
        kind: "vote",
        text: "Airport noise policy carries unanimously",
        startSeconds: 0,
        packetPage: 57,
        status: "lead",
        reason: "the meeting's main decision",
        sourceExcerpt: "And that carries unanimously.",
        voteResult: "carried 7-0",
        voteTally: "7-0",
      },
    ];
    await persistWholeMeetingAccounting(sql, {
      newsroomId: NEWSROOM,
      draftId: roundTripDraft,
      leadId: roundTripLead,
      ledger,
      claims: [],
      meetingNotes: "LEDGER: 2 item(s); 1 lead, 1 roundup, 0 excluded, 0 unread.",
      runStats: { wallMs: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1 },
    });

    const accounting = await loadMeetingAccounting(sql, { newsroomId: NEWSROOM, leadId: roundTripLead });
    const procedural = accounting.ledger.find((item) => item.itemNo === 1)!;
    assert.equal(procedural.motions[0]!.kind, "procedural", "the kind survives the insert and the read");
    assert.equal(procedural.voteResult, "", "a procedural motion does not lend its tally to the item's vote result");
    assert.equal(procedural.voteTally, "", "nor to the item's vote tally");

    const rewrite = await loadStoredLedgerForRewrite(sql, { newsroomId: NEWSROOM, leadId: roundTripLead });
    const rewrittenProcedural = rewrite.find((item) => item.itemNo === 1)!;
    assert.equal(rewrittenProcedural.motions![0]!.kind, "procedural", "and it is still procedural in the rewrite's rows");
    assert.equal(rewrittenProcedural.voteResult, "", "the rewrite's row does not gain a vote it never had");
    const rewrittenVote = rewrite.find((item) => item.itemNo === 2)!;
    assert.deepEqual(rewrittenVote.motions, [], "the policy vote carries no procedural motion of its own");
    assert.equal(rewrittenVote.voteResult, "carried 7-0", "and keeps the decision it does hold");
  });

  it("saves and reads back the impact score through the real write and rewrite", async () => {
    /*
      The score the status pass produced has to reach the row and come back: the
      editor's panel reads it from loadMeetingAccounting, and a rewrite hands it
      back to the writer from loadStoredLedgerForRewrite. An item the pass never
      scored stays NULL and reads back with no score -- unranked, not zero.
    */
    const sql = await getSql();
    const lead = await sql.query<{ id: number }>(
      `insert into leads(user_id,newsroom_id,headline,why,topic,source_urls)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [USER, NEWSROOM, "Impact round trip", "the tape covers it", "council", "[]"],
    );
    const impactLead = Number(lead[0]!.id);
    const draft = await sql.query<{ id: number }>(
      `insert into drafts(user_id,newsroom_id,lead_id,headline,dek,body,topic)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [USER, NEWSROOM, impactLead, "Impact round trip", "", "body", "council"],
    );
    const impactDraft = Number(draft[0]!.id);
    const ledger: LedgerItem[] = [
      {
        itemNo: 1,
        kind: "vote",
        text: "Airport noise policy carries unanimously",
        startSeconds: 0,
        packetPage: 57,
        status: "lead",
        reason: "the meeting's main decision",
        sourceExcerpt: "And that carries unanimously.",
        voteResult: "carried 7-0",
        voteTally: "7-0",
        impact: {
          immediacy: 5,
          immediacyReason: "a nighttime flight-path change lands on residents this month",
          impact: 4,
          impactReason: "every household under the approach",
          conflict: 3,
          conflictReason: "the council split on the decibel target",
          novelty: 4,
          noveltyReason: "first time the council set a target",
          total: 16,
        },
      },
      {
        itemNo: 2,
        kind: "proclamation",
        text: "Proclamation Declaring Electrify Longmont Day",
        startSeconds: 120,
        packetPage: null,
        status: "roundup",
        reason: "a proclamation",
        sourceExcerpt: "Now therefore I proclaim",
        // Never scored: stays NULL, and must read back unranked, not as a zero.
      },
    ];
    await persistWholeMeetingAccounting(sql, {
      newsroomId: NEWSROOM,
      draftId: impactDraft,
      leadId: impactLead,
      ledger,
      claims: [],
      meetingNotes: "LEDGER: 2 item(s); 1 lead, 1 roundup, 0 excluded, 0 unread.",
      runStats: { wallMs: 1, modelCalls: 1, inputTokens: 1, outputTokens: 1 },
    });

    const raw = await sql.query<{ item_no: number; impact: number | null }>(
      `select item_no, impact from meeting_ledger_items where draft_id=$1 order by item_no`,
      [impactDraft],
    );
    assert.ok(raw[0]!.impact, "the scored item stores a jsonb score");
    assert.equal(raw[1]!.impact, null, "the unscored item stores NULL, not a zeroed score");

    const accounting = await loadMeetingAccounting(sql, { newsroomId: NEWSROOM, leadId: impactLead });
    const scored = accounting.ledger.find((item) => item.itemNo === 1)!;
    assert.equal(scored.impact!.immediacy, 5, "the dimension arrives as a number");
    assert.match(scored.impact!.immediacyReason, /flight-path/, "and its explanation is kept, not dropped");
    assert.equal(
      accounting.ledger.find((item) => item.itemNo === 2)!.impact,
      null,
      "the unscored item reads back unranked",
    );

    const rewrite = await loadStoredLedgerForRewrite(sql, { newsroomId: NEWSROOM, leadId: impactLead });
    const rewritten = rewrite.find((item) => item.itemNo === 1)!;
    assert.equal(rewritten.impact!.conflict, 3, "the rewrite carries the score back to the writer");
    assert.match(rewritten.impact!.noveltyReason, /set a target/, "with its reason intact");
    assert.equal(
      rewrite.find((item) => item.itemNo === 2)!.impact ?? null,
      null,
      "and an unscored item stays unscored through the rewrite",
    );
  });

  it("picks the portal's packet over its agenda", () => {
    const chosen = packetDocumentForMeeting(MEETING, "https://example.primegov.com");
    assert.ok(chosen, "the packet is found among the meeting's documents");
    assert.match(chosen!.url, /meetingTemplateId=11/, "the compiled URL takes the packet's template id");
    assert.match(chosen!.name, /^Packet - City Council Study Session\.pdf$/, "and the retained name says what it is");
  });
});
