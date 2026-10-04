import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLD_CHECK_SYSTEM,
  EXCLUDED_OVERRULED_REASON,
  INVENTORY_SYSTEM,
  LEAD_WRITE_SYSTEM,
  LEDGER_STATUS_SYSTEM,
  ROUNDUP_HEADING,
  ROUNDUP_WRITE_SYSTEM,
  RULE_ASSIGNED_REASON,
  agendaRanges,
  applyStatuses,
  assembleStory,
  attachVoteResults,
  buildKnownNames,
  buildLedger,
  checkDraftNames,
  editorNamesOneAgendaItem,
  mapCaptionNames,
  mergeNearDuplicates,
  parseInventoryReply,
  rankLeadItems,
  runWholeMeetingWriter,
  scanVoteResults,
  usesWholeMeetingWriter,
  voteResultCount,
  type AgendaListItem,
  type LedgerItem,
  type MeetingSegment,
  type PacketPage,
  type WholeMeetingChat,
  type WindowInventory,
} from "./meeting-whole.ts";

/**
 * WR1's behavior, driven end to end through the pipeline with a fake chat: no
 * model call, no network, no database. The fixtures are short excerpts from the
 * real Longmont City Council study session of Sept. 29, 2026 -- the tape line
 * that carries the noise-policy vote, and the packet page that holds the
 * NextLight and airport budget figures -- trimmed to a few hundred bytes each.
 *
 * Each test states one rule the pipeline has to keep. The rules are the point:
 * a meeting writer that loses an item, invents a vote, or states a figure the
 * record does not hold is worse than no draft at all.
 */

// The real tape, verbatim. The word "unanimously" is here on purpose -- the
// vote-word check has to find a recorded vote and flag an invented one.
const TAPE = `>> Okay. And that carries unanimously. So,
do we have a motion for directing giving direction regarding adding staff
capacity to inform the staff capacity plan?
>> Council Member Popkin.
>> Thank you, Mayor. Um, as I said before,
I would encourage us to not give direction on the staffing plan right now.`;

// Real packet page 57: the NextLight and airport budget summaries, with the
// dollar figures the draft is allowed to state.
const PACKET_PAGE_57 = `S-101
CITY COUNCIL COMMUNICATION
NEXTLIGHT BUDGET SUMMARY
The NextLight 2027 budget reflects $24,907,816 in expenses and $24,197,712 in revenue for
a negative balance of ($710,104). The deficit will be covered by an appropriation from the
fund balance which well exceeds the minimum requirement.
AIRPORT BUDGET SUMMARY
The 2027 proposed Airport Fund budget totals $733,170. This is a $7,796 (1.07%) increase
from the 2026 adopted budget of $725,377. The Airport Fund pays for expenses associated
with maintaining and improving Vance Brand Municipal Airport.`;

const SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: TAPE, item: "1", itemTitle: "Airport noise policy" },
];
const PACKET: PacketPage[] = [{ page: 57, text: PACKET_PAGE_57 }];

/** A chat that answers each stage by which system prompt it was handed. */
function fakeChat(handlers: {
  inventory?: (user: string) => string;
  status?: (user: string) => string;
  lead?: (user: string) => string;
  roundup?: (user: string) => string;
  cold?: (user: string) => string;
}): WholeMeetingChat {
  return async (system, user) => {
    const route: [boolean, (() => string) | undefined][] = [
      [system.includes(INVENTORY_SYSTEM), handlers.inventory ? () => handlers.inventory!(user) : undefined],
      [system.includes(LEDGER_STATUS_SYSTEM), handlers.status ? () => handlers.status!(user) : undefined],
      [system.includes(LEAD_WRITE_SYSTEM), handlers.lead ? () => handlers.lead!(user) : undefined],
      [system.includes(ROUNDUP_WRITE_SYSTEM), handlers.roundup ? () => handlers.roundup!(user) : undefined],
      [system.includes(COLD_CHECK_SYSTEM), handlers.cold ? () => handlers.cold!(user) : undefined],
    ];
    for (const [matches, reply] of route) {
      if (matches) return reply ? { ok: true, text: reply() } : { ok: false, error: "stage not handled" };
    }
    return { ok: false, error: "unknown stage" };
  };
}

const INVENTORY_OK = JSON.stringify({
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
    {
      kind: "staff-report",
      text: "Proposed 2027 airport fund budget totals $733,170",
      who: "staff",
      timestamp: "0:00:10",
      packet_page: 57,
      numbers: "$733,170",
      source_words: "The 2027 proposed Airport Fund budget totals $733,170.",
    },
  ],
});

const STATUS_OK = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", reason: "the meeting's main decision" },
    { item_no: 2, status: "roundup", reason: "a budget detail" },
  ],
});

// The two-item grouping run's statuses: the airport group leads, NextLight
// roundups. Numbering follows the order the groups were built from the tape.
const TWO_ITEM_STATUS = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", reason: "the noise policy vote" },
    { item_no: 2, status: "roundup", reason: "a budget presentation" },
  ],
});

const COLD_OK = JSON.stringify({ mismatches: [] });

/*
  The newsroom's own officials-and-staff list for Sept. 29, 2026, exactly as the
  editor keeps it on the setup screen: the people the captions garble -- "Christ"
  for Crist, "Koffer" for Kalkhofer, "Marcin" for Marsing, "Prito" for Prieto.
*/
const REAL_ROSTER = [
  "Susie Hidalgo-Fahring, Mayor",
  "Diane Crist, Council member",
  "Alex Kalkhofer, Council member",
  "Jake Marsing, Council member",
  "Matthew Popkin, Council member",
  "Crystal Prieto, Council member",
  "Harold Dominguez, City Manager",
  "Jenn Ooton, Assistant City Manager",
].join("\n");

/*
  A two-item meeting from the same Sept. 29 tape: the airport noise item runs
  first (0:00-10:00) and the NextLight budget item second (11:40-21:40), far
  enough apart that the coarse alignment can hold them as two agenda items.
  This is the shape the grouping has to survive -- the real run read 308 raw
  lines off one tape, and those lines must reach the editor as a handful of
  agenda items, not as the inventory they were read from.
*/
const TWO_ITEM_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "The council turned to the airport noise policy.", item: "1", itemTitle: "Airport noise policy" },
  { index: 1, seconds: 600, text: "Public comment followed on the noise policy.", item: "1", itemTitle: "Airport noise policy" },
  { index: 2, seconds: 700, text: "Next, the NextLight budget.", item: "2", itemTitle: "NextLight budget" },
  { index: 3, seconds: 1300, text: "The budget discussion continued.", item: "2", itemTitle: "NextLight budget" },
];

// Five raw lines, two agenda items: three under the airport item (a motion, its
// vote, a budget figure) and two under NextLight. Every line has to survive.
const TWO_ITEM_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the airport noise policy", who: "Council Member Prieto", timestamp: "0:03:00", packet_page: 57, numbers: "", source_words: "I move to approve the airport noise policy." },
    { kind: "vote", text: "The airport noise policy carries unanimously", who: "", timestamp: "0:08:00", packet_page: 57, numbers: "", source_words: "And that carries unanimously." },
    { kind: "staff-report", text: "Airport fund budget totals $733,170", who: "staff", timestamp: "0:09:00", packet_page: 57, numbers: "$733,170", source_words: "The 2027 proposed Airport Fund budget totals $733,170." },
    { kind: "presentation", text: "NextLight budget reflects $24,907,816 in expenses", who: "staff", timestamp: "0:12:00", packet_page: 57, numbers: "$24,907,816", source_words: "The NextLight 2027 budget reflects $24,907,816 in expenses." },
    { kind: "staff-report", text: "NextLight shows a negative balance of ($710,104)", who: "staff", timestamp: "0:16:00", packet_page: 57, numbers: "($710,104)", source_words: "a negative balance of ($710,104)." },
  ],
});

// The voted group is SECOND here: this is the meeting where the model, left to
// itself, leads with the budget because it is a big number.
const OVERRULE_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Next, the NextLight budget.", item: "1", itemTitle: "NextLight budget" },
  { index: 1, seconds: 600, text: "The budget discussion continued.", item: "1", itemTitle: "NextLight budget" },
  { index: 2, seconds: 700, text: "The council turned to the airport noise policy.", item: "2", itemTitle: "Airport noise policy" },
  { index: 3, seconds: 1300, text: "Public comment followed.", item: "2", itemTitle: "Airport noise policy" },
];

// Item 1 (the unvoted NextLight group) two lines; item 2 (the airport group)
// a motion and its vote. Item 1 comes first, so it is the group numbered 1.
const OVERRULE_INVENTORY = JSON.stringify({
  items: [
    { kind: "presentation", text: "NextLight budget reflects $24,907,816 in expenses", who: "staff", timestamp: "0:05:00", packet_page: 57, numbers: "$24,907,816", source_words: "The NextLight 2027 budget reflects $24,907,816 in expenses." },
    { kind: "staff-report", text: "NextLight shows a negative balance of ($710,104)", who: "staff", timestamp: "0:08:00", packet_page: 57, numbers: "($710,104)", source_words: "a negative balance of ($710,104)." },
    { kind: "motion", text: "Move to approve the airport noise policy", who: "Council Member Prieto", timestamp: "0:12:00", packet_page: 57, numbers: "", source_words: "I move to approve the airport noise policy." },
    { kind: "vote", text: "The airport noise policy carries unanimously", who: "", timestamp: "0:15:00", packet_page: 57, numbers: "", source_words: "And that carries unanimously." },
  ],
});

// The model leads with item 1 (the unvoted budget) and roundups item 2 (the
// vote). The code must overrule it.
const OVERRULE_STATUS = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", reason: "the biggest number on the tape" },
    { item_no: 2, status: "roundup", reason: "a noise-policy vote" },
  ],
});

// The real tape line the run-2 report missed: "carries 5 to two" (line ~750).
const TALLY_TAPE = `Council Member Prieto: I move to approve the airport noise policy.
Mayor: All in favor? The motion carries 5 to two.`;
const TALLY_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 300, text: TALLY_TAPE, item: "1", itemTitle: "Airport noise policy" },
];
const TALLY_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the airport noise policy", who: "Council Member Prieto", timestamp: "0:05:00", packet_page: 57, numbers: "", source_words: "I move to approve the airport noise policy." },
  ],
});

function run(
  handlers: Parameters<typeof fakeChat>[0],
  over: {
    segments?: MeetingSegment[];
    votes?: Parameters<typeof runWholeMeetingWriter>[0]["votes"];
    agendaList?: AgendaListItem[];
  } = {},
) {
  return runWholeMeetingWriter({
    meeting: { title: "City Council Study Session", date: "2026-09-29", videoUrl: "https://youtu.be/example" },
    segments: over.segments ?? SEGMENTS,
    packetPages: PACKET,
    votes: over.votes ?? [],
    agendaList: over.agendaList,
    chat: fakeChat(handlers),
  });
}

/*
  The real Sept. 29 agenda as the packet prints it: whole-number items plus the
  lettered sub-items -- 5A (the Electrify Longmont Day proclamation) and 6A/6B
  (the airport monitoring presentation and the budget hearing) -- that the
  capture's whole-number `meeting_agenda_chunks` alignment cannot represent.
*/

const SEPT29_AGENDA: AgendaListItem[] = [
  { id: "1", title: "MEETING CALLED TO ORDER" },
  { id: "5", title: "PROCLAMATIONS AND PRESENTATIONS" },
  { id: "5A", title: "Proclamation Declaring October 2026 Electrify Longmont Day" },
  { id: "6", title: "PRESENTATIONS" },
  {
    id: "6A",
    title:
      "Presentation Of Options To Implement The Airport Monitoring Systems (AMS) Voluntary Noise Abatement Procedures (VNAP) Recommendations For Vance Brand Municipal Airport",
  },
  {
    id: "6B",
    title:
      "2027 Proposed Budget Presentation And First Public Hearing On The 2027 Proposed Budget And The Proposed 2027-2031 Capital Improvement Program",
  },
];

/*
  The Sept. 29 airport stretch of tape. Every line's capture alignment says item
  "1" -- the whole-number alignment files the whole hour under "1. MEETING
  CALLED TO ORDER" -- while the inventory pass, given the packet's agenda, tags
  the airport lines 6A and the budget lines 6B. The tape holds three unanimous
  results under 6A and one 5-2 tally under 6B.
*/
const AIRPORT_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Council Member Prieto: I move to approve the first AMS recommendation.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 1, seconds: 30, text: "Mayor: All in favor? That carries unanimously.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 2, seconds: 60, text: "Mayor: The second recommendation carries unanimously.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 3, seconds: 90, text: "Mayor: And the third carries unanimously.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 4, seconds: 600, text: "Council Member Crist: I move to approve the budget presentation.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 5, seconds: 630, text: "Mayor: The motion carries 5 to two.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
];

const AIRPORT_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the first AMS recommendation", who: "Council Member Prieto", timestamp: "0:00:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the first AMS recommendation." },
    { kind: "vote", text: "The first AMS recommendation carries unanimously", who: "", timestamp: "0:00:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "That carries unanimously." },
    { kind: "vote", text: "The second recommendation carries unanimously", who: "", timestamp: "0:01:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "The second recommendation carries unanimously." },
    { kind: "vote", text: "The third recommendation carries unanimously", who: "", timestamp: "0:01:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "And the third carries unanimously." },
    { kind: "motion", text: "Move to approve the 2027 budget presentation", who: "Council Member Crist", timestamp: "0:10:00", packet_page: 30, numbers: "$2,000,000", agenda: "6B", source_words: "I move to approve the $2,000,000 budget presentation." },
    { kind: "vote", text: "The budget motion carries 5 to 2", who: "", timestamp: "0:10:30", packet_page: 30, numbers: "5-2", agenda: "6B", source_words: "The motion carries 5 to two." },
  ],
});

/** The same six raw lines, handed straight to `buildLedger` as one window. */
const AIRPORT_WINDOWS: WindowInventory[] = [
  { windowIndex: 0, segments: [], items: parseInventoryReply(AIRPORT_INVENTORY).items },
];

/** A ledger row with the fields a merge or status test cares about. */
function row(over: Partial<LedgerItem> & { kind: string; text: string }): LedgerItem {
  return {
    itemNo: 0,
    startSeconds: null,
    endSeconds: null,
    packetPage: null,
    status: "roundup",
    reason: "",
    sourceExcerpt: over.text,
    evidence: [],
    motions: [],
    voteResult: "",
    voteTally: "",
    ...over,
  };
}

describe("whole-meeting writer", () => {
  it("groups hundreds of raw inventory lines into one item per agenda item", async () => {
    /*
      The inventory pass reads every line it finds -- a four-hour meeting gives
      it hundreds, the real Sept. 29 run read 308 -- and that is an inventory,
      not a ledger an editor can read. The ledger groups those lines by the
      agenda item they belong to and keeps every raw line as evidence under its
      group. Five raw lines across two agenda items become two rows, and nothing
      the run read is lost doing it.
    */
    const result = await run(
      {
        inventory: () => TWO_ITEM_INVENTORY,
        status: () => TWO_ITEM_STATUS,
        lead: () => JSON.stringify({ headline: "Airport noise policy set", dek: "One line.", lead: "The council set a noise policy." }),
        roundup: () => JSON.stringify({ paragraph: "The NextLight budget was presented." }),
        cold: () => COLD_OK,
      },
      { segments: TWO_ITEM_SEGMENTS },
    );
    assert.equal(result.ledger.length, 2, "five raw lines group into the meeting's two agenda items");
    assert.deepEqual(result.ledger.map((item) => item.kind), ["agenda-item", "agenda-item"]);
    assert.deepEqual(result.ledger.map((item) => item.itemNo), [1, 2], "groups are numbered in the order the meeting ran");
    assert.match(result.ledger[0]!.text, /Airport noise policy/, "a group is named by the agenda item's own title");
    assert.match(result.ledger[1]!.text, /NextLight budget/);
    assert.deepEqual(
      result.ledger.map((item) => item.evidence!.length),
      [3, 2],
      "each raw line is evidence under the item it belongs to",
    );
    const raw = result.ledger.flatMap((item) => item.evidence!.map((entry) => entry.text));
    assert.equal(raw.length, 5, "every raw inventory line survives as evidence");
    assert.ok(
      raw.some((text) => /Move to approve the airport noise policy/.test(text)),
      "the motion is kept under the item it belongs to",
    );
  });

  it("keeps the public comment in one item whatever the model calls the kind", () => {
    /*
      The real run-2 inventory returned the kind "public comment", with a space.
      The grouping matches the key "public-comment", so the public-comment period
      -- the one stretch of the tape that is the public's own words -- never
      formed as an item: its speakers were scattered into the discussion blocks
      and the roundup had no item to name. The kind is a key, so both spellings
      have to be one key, and the same goes for "withdrawn motion".
    */
    const parsed = parseInventoryReply(
      JSON.stringify({
        items: [
          { kind: "Public Comment", text: "Speaker one asks about the noise program", timestamp: "0:21:09", source_words: "Speaker one asks about the noise program." },
          { kind: "public comment", text: "Speaker two asks about the flight school", timestamp: "0:22:10", source_words: "Speaker two asks about the flight school." },
          { kind: "withdrawn motion", text: "Council member Marcy withdraws the motion", timestamp: "0:33:30", source_words: "Council member Marcy withdraws the motion." },
        ],
      }),
    );
    assert.deepEqual(
      parsed.items.map((item) => item.kind),
      ["public-comment", "public-comment", "withdrawn-motion"],
      "the kind is a key: a space and a hyphen are the same kind",
    );
    const ledger = buildLedger([{ windowIndex: 0, segments: [], items: parsed.items }], [], []);
    assert.deepEqual(
      ledger.map((item) => item.kind),
      ["public-comment", "withdrawn-motion"],
      "the meeting's public comment is one item, not one item per speaker",
    );
    assert.equal(ledger[0]!.evidence!.length, 2, "and both speakers stay under it");
  });

  it("assigns a status by rule when the status pass cannot be read, never excluded", async () => {
    /*
      A batch of the status pass that fails twice must not strand its items. The
      run-2 failure was the opposite: every one of 308 items was "excluded" with
      the reason "The ledger pass proposed no status for this item", so the paper
      dropped an hour of the meeting on an unreadable model reply. Here the
      status call returns prose twice, and both items are still assigned -- the
      one that carries a vote leads, the other roundups -- with a reason that
      says the assignment was by rule.
    */
    const result = await run(
      {
        inventory: () => TWO_ITEM_INVENTORY,
        status: () => "Sorry, I cannot produce that as JSON right now.",
        lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council set a noise policy." }),
        roundup: () => JSON.stringify({ paragraph: "The NextLight budget was presented." }),
        cold: () => COLD_OK,
      },
      { segments: TWO_ITEM_SEGMENTS },
    );
    for (const item of result.ledger) {
      assert.notEqual(item.status, "excluded", "no item is dropped because a model reply could not be read");
      assert.ok(["lead", "roundup"].includes(item.status), `assigned by rule, got ${item.status}`);
      assert.equal(item.reason, RULE_ASSIGNED_REASON);
    }
    assert.equal(result.ledger[0]!.status, "lead", "the group with a vote and a motion leads under the rule");
    assert.equal(result.ledger[1]!.status, "roundup");
    assert.match(
      result.meetingNotes,
      /RULE ASSIGNMENT: 2 item\(s\) had no readable status from the model/,
      "the notes count how many items were assigned by rule",
    );
  });

  it("leads with a voted group over a model pick that had no vote", async () => {
    /*
      A meeting that voted on something cannot lead its story on something it
      did not vote on. The model here picks the budget (item 1); the code sees
      that item 2 carries the motion and the vote and overrules it, and the run
      says so in its notes. This is the Sept. 29 airport case in miniature.
    */
    let leadPrompt = "";
    const result = await run(
      {
        inventory: () => OVERRULE_INVENTORY,
        status: () => OVERRULE_STATUS,
        lead: (user) => {
          leadPrompt = user;
          return JSON.stringify({ headline: "H", dek: "", lead: "The council acted." });
        },
        roundup: () => JSON.stringify({ paragraph: "The budget was presented." }),
        cold: () => COLD_OK,
      },
      { segments: OVERRULE_SEGMENTS },
    );
    const leadSource = leadPrompt.slice(
      leadPrompt.indexOf("LEAD ITEM SOURCE"),
      leadPrompt.indexOf("TRANSCRIPT EXCERPTS"),
    );
    assert.match(leadSource, /Airport noise policy/, "the voted group is the one the writer leads on");
    assert.doesNotMatch(leadSource, /NextLight budget/, "the model's unvoted pick is not the lead source");
    assert.match(
      result.meetingNotes,
      /LEAD: the model's pick had no vote or motion under it/,
      "the run records that it overruled the model",
    );
  });

  it("reads 'carries 5 to two' as a 5-2 tally on the motion before it", async () => {
    /*
      The run-2 story said "no vote tally was recorded" while the tape said
      "carries 5 to two". The result is found in code, attached to the motion
      that precedes it, and handed to the writer as a fact -- the words "two"
      and "2" are the same number. The draft's own "5 to 2" is then found, not
      flagged, because the record holds it.
    */
    let leadPrompt = "";
    const result = await run(
      {
        inventory: () => TALLY_INVENTORY,
        status: () => JSON.stringify({ items: [{ item_no: 1, status: "lead", reason: "the vote" }] }),
        lead: (user) => {
          leadPrompt = user;
          return JSON.stringify({ headline: "H", dek: "", lead: "The airport noise policy carries 5 to 2." });
        },
        cold: () => COLD_OK,
      },
      { segments: TALLY_SEGMENTS },
    );
    const motion = result.ledger[0]!;
    assert.equal(motion.voteResult, "carries", "the result phrase is read off the tape");
    assert.equal(motion.voteTally, "5-2", "the word 'two' is read as the number 2");
    assert.match(leadPrompt, /recorded vote: carries, 5-2/, "the writer is handed the tally as a fact");
    const tallyClaim = result.claims.find((claim) => /5\s*to\s*2/i.test(claim.claim));
    assert.ok(tallyClaim, "the tally in the draft is checked");
    assert.equal(tallyClaim!.checkStatus, "found", "the tally the tape states is not flagged");
  });

  it("corrects a garbled caption name against the newsroom's own list", async () => {
    /*
      Captions spell the council by ear: the real tape calls Council Member
      Marsing "Marcin". With the newsroom's officials-and-staff list, the
      surname is matched by sound and the tape the writer reads carries the
      known spelling -- not the caption's.

      The roster here is the real one, all eight names. A one-name roster would
      pass even if the match were arbitrary: with the real list, "Marcin"'s
      consonant skeleton sits one edit from Crist's and one from Marsing's, and
      the first letter is what decides between them.
    */
    const roster = REAL_ROSTER;
    const known = buildKnownNames({ roster });
    const tape = "Council Member Marcin: I support the NextLight budget.";
    const mapped = mapCaptionNames(tape, known, "");
    assert.ok(
      mapped.mappings.some((row) => row.captioned === "Marcin" && row.known === "Jake Marsing"),
      "the caption's spelling maps to the known name",
    );
    assert.match(mapped.text, /Marsing/, "the corrected tape carries the newsroom's spelling");
    assert.doesNotMatch(mapped.text, /Marcin/, "the garbled spelling is gone");
    assert.deepEqual(mapped.unverified, [], "a name the roster holds is not reported unverified");

    let leadPrompt = "";
    await runWholeMeetingWriter({
      meeting: { title: "City Council Study Session", date: "2026-09-29", videoUrl: "https://youtu.be/example" },
      segments: [{ index: 0, seconds: 0, text: tape, item: "1", itemTitle: "Airport noise policy" }],
      packetPages: [],
      votes: [],
      roster,
      maxWindowChars: 12_000,
      chat: fakeChat({
        inventory: () =>
          JSON.stringify({
            items: [
              { kind: "council-comment", text: "Council Member Marcin supported the budget", who: "Marcin", timestamp: "0:00:00", packet_page: null, numbers: "", source_words: "I support the NextLight budget." },
            ],
          }),
        status: () => JSON.stringify({ items: [{ item_no: 1, status: "lead", reason: "the comment" }] }),
        lead: (user) => {
          leadPrompt = user;
          return JSON.stringify({ headline: "H", dek: "", lead: "A member spoke." });
        },
        cold: () => COLD_OK,
      }),
    });
    assert.match(leadPrompt, /Marsing/, "the writer's tape carries the corrected name");
    // The mapping line names the garbled spelling on purpose ("Marcin ->
    // Jake Marsing"), so the check is the tape itself, not the whole prompt.
    const tapeForWriter = leadPrompt.slice(
      leadPrompt.indexOf("TRANSCRIPT EXCERPTS"),
      leadPrompt.indexOf("PACKET EXCERPTS"),
    );
    assert.doesNotMatch(tapeForWriter, /Marcin\b/, "the tape the writer reads never carries the garbled name");
  });

  it("flags a name the record and the newsroom's list do not hold, and leaves it as captioned", async () => {
    /*
      Name correction never invents. A caption name that matches nothing the
      newsroom knows stays exactly as captioned and is reported unverified; a
      name in the draft that is in neither the record nor the list is flagged
      for review, never silently corrected.
    */
    const known = buildKnownNames({ roster: "Jake Marsing, Council member" });
    const tape = "Mayor Hidalgo-Fahring called the meeting to order.\nAnna Blomqvist: I have a question about the budget.";
    const mapped = mapCaptionNames(tape, known, "");
    assert.ok(
      mapped.unverified.includes("Anna Blomqvist"),
      "a caption name the newsroom does not know is reported unverified",
    );
    assert.match(mapped.text, /Anna Blomqvist/, "an unmatched name is left exactly as captioned");

    const claims = checkDraftNames({
      body: "Officials said Rachel Thornquist would review it.",
      transcriptText: tape,
      packetText: "",
      knownNames: known,
    });
    const flagged = claims.find((claim) => claim.claim === "Rachel Thornquist");
    assert.ok(flagged, "a name written into the draft is checked");
    assert.equal(flagged!.checkStatus, "flagged", "a name the record does not hold is flagged, not dropped");
    assert.match(flagged!.note, /verify the spelling/i);
  });

  it("accounts for a window it could not parse as unread rather than losing it", async () => {
    /*
      A window whose inventory reply is not valid JSON is retried once; when the
      retry is also unusable the window must still appear in the ledger as an
      `unread` row naming what it covered. Dropping it silently would let a
      whole stretch of the meeting vanish from the accounting.
    */
    const result = await run({
      inventory: () => "I could not read this window, sorry.",
      status: () => JSON.stringify({ items: [] }),
      lead: () => JSON.stringify({ headline: "H", dek: "", lead: "Body." }),
      cold: () => COLD_OK,
    });
    assert.equal(result.unreadWindows, 1, "one window went unread");
    assert.equal(result.ledger.length, 1, "the unread window is still a ledger row");
    const [row] = result.ledger;
    assert.equal(row!.status, "unread");
    assert.equal(row!.kind, "unread-window");
    assert.match(row!.text, /Window 1 could not be inventoried/);
    assert.ok(row!.sourceExcerpt.length > 0, "the unread row keeps a source excerpt from the tape");
  });

  it("flags a dollar figure the record does not hold and keeps one it does", async () => {
    /*
      The zero-invented-figures pass mark: a figure stated in the body is found
      in the transcript or packet text, or it is flagged. Both outcomes are
      recorded -- the check never drops a figure it cannot match.
    */
    const result = await run({
      inventory: () => INVENTORY_OK,
      status: () => STATUS_OK,
      lead: () =>
        JSON.stringify({
          headline: "Airport budget",
          dek: "",
          lead: "The airport fund budget totals $733,170, and the city also holds $9,999,999 in reserve.",
        }),
      roundup: () => JSON.stringify({ paragraph: "Details followed." }),
      cold: () => COLD_OK,
    });
    const found = result.claims.find((claim) => claim.claim.startsWith("$733,170"));
    const invented = result.claims.find((claim) => claim.claim.startsWith("$9,999,999"));
    assert.ok(found, "the packet figure must be checked");
    assert.equal(found!.checkStatus, "found", "$733,170 is in the packet text");
    assert.ok(invented, "the invented figure must be checked");
    assert.equal(invented!.checkStatus, "flagged", "$9,999,999 is nowhere in the record");
  });

  it("flags an invented vote word and finds a recorded one", async () => {
    /*
      A vote may be stated only as the record states it. "unanimously" appears in
      the tape, so a body that says it is not flagged; a body that claims a tally
      the record never holds is flagged, because inferring an outcome is the
      failure this rule exists to stop.
    */
    const recorded = await run({
      inventory: () => INVENTORY_OK,
      status: () => STATUS_OK,
      lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council voted unanimously on the noise policy." }),
      roundup: () => JSON.stringify({ paragraph: "More." }),
      cold: () => COLD_OK,
    });
    const recordedWord = recorded.claims.find((claim) => /unanimous/i.test(claim.claim));
    assert.ok(recordedWord, "the vote word must be checked");
    assert.equal(recordedWord!.checkStatus, "found", "the tape says 'carries unanimously'");

    const invented = await run({
      inventory: () => INVENTORY_OK,
      status: () => STATUS_OK,
      lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council voted 5 to 2 on the noise policy." }),
      roundup: () => JSON.stringify({ paragraph: "More." }),
      cold: () => COLD_OK,
    });
    const inventedWord = invented.claims.find((claim) => /5\s*to\s*2/i.test(claim.claim));
    assert.ok(inventedWord, "the invented tally must be checked");
    assert.equal(inventedWord!.checkStatus, "flagged", "no source records a 5 to 2 vote");
    assert.match(inventedWord!.note, /do not infer a vote or outcome/i);
  });

  it("puts the ALSO AT THE MEETING heading before the roundup paragraphs", async () => {
    /*
      The assembled body is the lead story, then the heading, then one paragraph
      per roundup item, each starting with the item's name. A reader must meet
      the heading before the list it introduces.
    */
    const body = assembleStory({
      lead: "The council set a noise policy.",
      roundups: [
        { name: "Airport fund budget", text: "The 2027 airport fund budget totals $733,170." },
        { name: "NextLight budget", text: "NextLight reflected $24,907,816 in expenses." },
      ],
    });
    const leadAt = body.indexOf("The council set a noise policy.");
    const headingAt = body.indexOf(ROUNDUP_HEADING);
    const firstItemAt = body.indexOf("Airport fund budget:");
    assert.ok(leadAt >= 0 && headingAt >= 0 && firstItemAt >= 0, "all three parts must be present");
    assert.ok(headingAt > leadAt, "the heading follows the lead story");
    assert.ok(firstItemAt > headingAt, "the roundup items follow the heading");
    assert.match(body, /ALSO AT THE MEETING\n\nAirport fund budget: /, "the heading leads the list");
  });

  it("rewrites from the stored ledger without reading the tape again", async () => {
    /*
      Rewrite from ledger: the editor read the ledger a first run built and set
      the statuses, and the rewrite reuses those rows. No window is inventoried
      again, and no status pass runs -- the editor's decisions are the input. An
      item moved to `excluded` is absent from the new body; the lead item is in
      it. The chat counts every call by the system prompt it was handed, so a
      single inventory call fails this test.
    */
    const handled = fakeChat({
      inventory: () => INVENTORY_OK,
      status: () => STATUS_OK,
      lead: () =>
        JSON.stringify({
          headline: "Airport noise policy set",
          dek: "One line.",
          lead: "The council set a noise policy.",
        }),
      roundup: () => JSON.stringify({ paragraph: "The airport fund budget was discussed." }),
      cold: () => COLD_OK,
    });
    const calls: string[] = [];
    const counting: WholeMeetingChat = async (system, user, maxTokens) => {
      calls.push(system.includes(INVENTORY_SYSTEM) ? "inventory" : "write");
      return handled(system, user, maxTokens);
    };
    const stored: LedgerItem[] = [
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
        startSeconds: 10,
        packetPage: 57,
        status: "excluded",
        reason: "covered in a separate story",
        sourceExcerpt: "The 2027 proposed Airport Fund budget totals $733,170.",
      },
    ];

    const result = await runWholeMeetingWriter({
      meeting: { title: "City Council Study Session", date: "2026-09-29", videoUrl: "https://youtu.be/example" },
      segments: SEGMENTS,
      packetPages: PACKET,
      votes: [],
      chat: counting,
      prebuiltLedger: stored,
    });

    assert.equal(
      calls.filter((kind) => kind === "inventory").length,
      0,
      "a rewrite makes no inventory call",
    );
    // The lead write and the cold check are the only calls left: no inventory
    // pass, no status pass. Before the prebuilt ledger this was four calls.
    assert.equal(calls.length, 2, "only the lead write and the cold check spend a call");
    assert.deepEqual(
      result.ledger.map((item) => item.status),
      ["lead", "excluded"],
      "the editor's statuses are used as-is",
    );
    assert.equal(result.ledger[1]!.reason, "covered in a separate story", "with the editor's reason");
    assert.match(result.body, /The council set a noise policy\./, "the lead item is in the new body");
    assert.doesNotMatch(result.body, /airport fund budget was discussed/i, "an excluded item is not written");
    assert.doesNotMatch(result.body, new RegExp(ROUNDUP_HEADING), "no roundup items means no roundup heading");
  });

  it("sends a lead that names one agenda item to the old one-item path", async () => {
    /*
      The whole-meeting writer is the default, but an editor's note that names an
      ordinance, a resolution or an item id asks for THAT item and gets the
      one-item path. A note that only says how to write names nothing, so it
      still gets the whole meeting.
    */
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: true, editorialAssignment: "Lead with the main decision." }), true);
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: true, editorialAssignment: "Write about item 9B2." }), false);
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: true, editorialAssignment: "Cover Ordinance 2026-46." }), false);
    assert.equal(usesWholeMeetingWriter({ hasMeetingMaterial: false, editorialAssignment: "Item 3." }), false);
    // The predicate the wiring reads must agree with the helper it names.
    assert.equal(editorNamesOneAgendaItem("Resolution 2026-12 sets the fee"), true);
    assert.equal(editorNamesOneAgendaItem("plain note with no item"), false);
  });

  it("groups by the inventory's own agenda label, so the airport lines become item 6A", () => {
    /*
      This is the run-3 failure itself. Every airport line's CAPTURE alignment
      says agenda item "1" -- the capture knows whole-number items only, so the
      whole airport hour was filed under "1. MEETING CALLED TO ORDER" and thrown
      away as routine procedure. Grouping by the label the inventory pass put on
      each line (from the packet's own agenda, sub-items included) is what fixes
      it: the six raw lines become the meeting's two real items, 6A and 6B.

      The same lines with no agenda list -- the old behaviour -- collapse into
      the single misnamed "1. MEETING CALLED TO ORDER" item, which is the bug.
    */
    const ledger = buildLedger(AIRPORT_WINDOWS, [], agendaRanges(AIRPORT_SEGMENTS), SEPT29_AGENDA);
    assert.equal(ledger.length, 2, "the airport lines are two agenda items, not one");
    assert.deepEqual(ledger.map((item) => item.kind), ["agenda-item", "agenda-item"]);
    assert.match(ledger[0]!.text, /^6A\. Presentation Of Options/, "6A is named by its own agenda title");
    assert.match(ledger[1]!.text, /^6B\. 2027 Proposed Budget/, "and 6B by its own");
    assert.deepEqual(
      ledger.map((item) => item.evidence!.length),
      [4, 2],
      "all six raw lines survive under the item each belongs to",
    );

    // The bug, kept as a witness: without the labels the alignment buries them.
    const withoutLabels = buildLedger(AIRPORT_WINDOWS, [], agendaRanges(AIRPORT_SEGMENTS), []);
    assert.equal(withoutLabels.length, 1, "the old whole-number grouping makes one item of everything");
    assert.match(withoutLabels[0]!.text, /MEETING CALLED TO ORDER/, "and names it routine procedure");
  });

  it("gives every inventory call the packet's own agenda, sub-items included", async () => {
    /*
      The label is only as good as the list the pass is handed: if the inventory
      prompt does not name 6A, the model cannot tag a line 6A and the grouping
      has nothing to work with. The agenda block must reach every inventory call
      -- one per window -- with the lettered ids the capture cannot see.
    */
    const inventoryUsers: string[] = [];
    await run(
      {
        inventory: (user) => {
          inventoryUsers.push(user);
          return AIRPORT_INVENTORY;
        },
        status: () => JSON.stringify({ items: [{ item_no: 1, status: "lead", reason: "the airport vote" }] }),
        lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council acted." }),
        cold: () => COLD_OK,
      },
      { segments: AIRPORT_SEGMENTS, agendaList: SEPT29_AGENDA },
    );
    assert.ok(inventoryUsers.length > 0, "the inventory pass ran");
    for (const user of inventoryUsers) {
      assert.match(user, /\b6A\b/, "6A is offered to the inventory pass");
      assert.match(user, /\b6B\b/, "and 6B");
      assert.match(user, /\b5A\b/, "and the proclamation sub-item 5A");
    }
  });

  it("ranks an item holding three recorded votes above one holding a single vote", () => {
    /*
      The airport presentation carries three unanimous results; the budget item
      one tally. How many times the meeting decided is what ranks the lead, so
      the three-vote item outranks the one-vote item -- which is why 6A, not the
      big-budget 6B, is the story's lead once the votes are counted.
    */
    const ledger = attachVoteResults(
      buildLedger(AIRPORT_WINDOWS, [], agendaRanges(AIRPORT_SEGMENTS), SEPT29_AGENDA),
      scanVoteResults(AIRPORT_SEGMENTS),
    );
    assert.equal(voteResultCount(ledger[0]!), 3, "6A holds all three unanimous results");
    assert.equal(voteResultCount(ledger[1]!), 1, "6B holds one tally");
    assert.equal(ledger[0]!.motions!.length, 3, "and the motions are kept in tape order");
    // Statuses are assigned first, as the pipeline does before it ranks; every
    // item still starts "excluded" straight out of `buildLedger`.
    const statused = applyStatuses(ledger, []);
    assert.match(rankLeadItems(statused)[0]!.text, /^6A\./, "the three-vote item ranks first");
  });

  it("overrules a model that excludes an item holding a recorded vote", async () => {
    /*
      The hard rule, in code: an item with a vote is reported. The model is
      handed item 1 (6A, three votes) and drops it as "routine procedure" -- the
      exact call run 3 made about the airport. The run keeps it, as the lead
      because it outranks everything, and records that it overruled the model.
    */
    const result = await run(
      {
        inventory: () => AIRPORT_INVENTORY,
        status: () =>
          JSON.stringify({
            items: [
              { item_no: 1, status: "excluded", reason: "routine procedure" },
              { item_no: 2, status: "roundup", reason: "a budget presentation" },
            ],
          }),
        lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council acted." }),
        roundup: () => JSON.stringify({ paragraph: "The budget was presented." }),
        cold: () => COLD_OK,
      },
      { segments: AIRPORT_SEGMENTS, agendaList: SEPT29_AGENDA },
    );
    const voted = result.ledger[0]!;
    assert.notEqual(voted.status, "excluded", "an item with a vote is never dropped");
    assert.equal(voted.status, "lead", "and it outranks the rest, so it leads");
    assert.equal(voted.reason, EXCLUDED_OVERRULED_REASON, "the run records that it overruled the model");
    assert.match(
      result.meetingNotes,
      /EXCLUDED OVERRULED: 1 item\(s\)/,
      "the notes count how many excluded items were kept",
    );
  });

  it("merges six near-identical fund rows into one and keeps every reading", () => {
    /*
      The inventory reads in overlapping windows, so the extraction's
      "City Council Contingency Fund: $91,569" row comes back once per window
      and became six separate ledger items in run 3. Six near-identical rows of
      the same kind merge to one; the union of their evidence survives on the
      one item. A same-kind row that is a different line -- the airport budget
      figure -- stays separate.
    */
    const fund = "City Council Contingency Fund: $91,569";
    const rows: LedgerItem[] = [];
    for (let i = 0; i < 6; i += 1) {
      rows.push(
        row({
          kind: "staff-report",
          text: i % 2 === 0 ? fund : "City Council Contingency Fund $91,569",
          startSeconds: i * 600,
          packetPage: 2,
          // Each window read the row with a little of its own context around
          // it, so the evidence differs even where the row text matches.
          evidence: [{ kind: "staff-report", text: `${fund} (window ${i + 1})`, who: "staff", startSeconds: i * 600, packetPage: 2, numbers: "$91,569", sourceExcerpt: fund, agenda: "" }],
        }),
      );
    }
    rows.push(
      row({
        kind: "staff-report",
        text: "Airport fund budget totals $733,170",
        startSeconds: 7200,
        evidence: [{ kind: "staff-report", text: "Airport fund budget totals $733,170", who: "staff", startSeconds: 7200, packetPage: 57, numbers: "$733,170", sourceExcerpt: "The 2027 proposed Airport Fund budget totals $733,170.", agenda: "" }],
      }),
    );

    const { items, merged } = mergeNearDuplicates(rows);
    assert.equal(merged, 5, "five of the six fund rows fold into the first");
    assert.equal(items.length, 2, "one fund item and the unrelated airport row");
    assert.equal(items[0]!.kind, "staff-report");
    assert.match(items[0]!.text, /Contingency Fund/, "the fund item is the survivor");
    assert.equal(items[0]!.evidence!.length, 6, "and it keeps every one of the six readings");
    assert.deepEqual(items.map((item) => item.itemNo), [1, 2], "the kept items are renumbered in order");
    assert.match(items[1]!.text, /Airport fund budget/, "the different line stays its own item");
  });
});
