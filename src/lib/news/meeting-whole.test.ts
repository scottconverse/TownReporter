import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLD_CHECK_MAX,
  COLD_CHECK_SYSTEM,
  COLD_WINDOW_HITS,
  EXCLUDED_OVERRULED_REASON,
  INVENTORY_SYSTEM,
  LEAD_WRITE_SYSTEM,
  LEDGER_STATUS_SYSTEM,
  REPAIR_VOTE_SYSTEM,
  ROUNDUP_HEADING,
  ROUNDUP_WRITE_SYSTEM,
  RULE_ASSIGNED_REASON,
  SECOND_LEAD_REASON,
  SECTION_DOLLAR_MIN,
  SECTION_MAX,
  SECTION_SECONDS_MIN,
  SECTION_WORD_CAP,
  agendaRanges,
  applyPacketSpellings,
  applyStatuses,
  assembleStory,
  attachVoteResults,
  bareMoneyNumbers,
  buildKnownNames,
  buildLedger,
  capWords,
  checkDraftNames,
  chooseSectionItems,
  coldCheckParagraphSource,
  deservesOwnSection,
  editorNamesOneAgendaItem,
  isProceduralItem,
  mapCaptionNames,
  mergeNearDuplicates,
  mergeRelatedItems,
  motionLines,
  packetTerms,
  parseInventoryReply,
  plainLabel,
  rankLeadItems,
  runWholeMeetingWriter,
  scanVoteResults,
  termSpellingBlock,
  usesWholeMeetingWriter,
  voteResultCount,
  voteWordsIn,
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
  repair?: (user: string) => string;
  cold?: (user: string) => string;
}): WholeMeetingChat {
  return async (system, user) => {
    const route: [boolean, (() => string) | undefined][] = [
      [system.includes(REPAIR_VOTE_SYSTEM), handlers.repair ? () => handlers.repair!(user) : undefined],
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

// The same tape, but with the packet's agenda so the motion's group is named by
// the agenda item ("Airport noise policy") rather than by the motion's own
// clause -- the label the repair call and the story are written under.
const TALLY_AGENDA: AgendaListItem[] = [{ id: "1", title: "Airport noise policy" }];
const TALLY_AGENDA_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the airport noise policy", who: "Council Member Prieto", timestamp: "0:05:00", packet_page: 57, numbers: "", agenda: "1", source_words: "I move to approve the airport noise policy." },
  ],
});

function run(
  handlers: Parameters<typeof fakeChat>[0],
  over: {
    segments?: MeetingSegment[];
    votes?: Parameters<typeof runWholeMeetingWriter>[0]["votes"];
    agendaList?: AgendaListItem[];
    packetPages?: PacketPage[];
    roster?: string;
  } = {},
) {
  return runWholeMeetingWriter({
    meeting: { title: "City Council Study Session", date: "2026-09-29", videoUrl: "https://youtu.be/example" },
    segments: over.segments ?? SEGMENTS,
    packetPages: over.packetPages ?? PACKET,
    votes: over.votes ?? [],
    agendaList: over.agendaList,
    roster: over.roster,
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

/*
  Fix 1 -- one lead. Run 4's status pass called three items "lead": the library
  motions (item 1), the airport presentation (6A) and the budget (6B). The code
  must leave exactly one item leading -- the top-ranked one, 6A, which carries
  three unanimous results -- and move the other two into the roundup with a
  reason the editor can read, instead of writing the story about the library item
  and dropping 6A entirely.
*/
const THREE_LEAD_AGENDA: AgendaListItem[] = [
  { id: "3", title: "MOTIONS AND RESOLUTIONS Library Business Classes" },
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

// Library (three motions) first so it is numbered 1; then the three-vote airport
// item (6A) and the one-vote budget (6B). First-seen order is ledger order.
const THREE_LEAD_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the library business classes", who: "Council Member Crist", timestamp: "0:20:00", packet_page: 40, numbers: "", agenda: "3", source_words: "I move to approve the library business classes." },
    { kind: "amendment", text: "Amendment to add a second session", who: "", timestamp: "0:21:00", packet_page: 40, numbers: "", agenda: "3", source_words: "I move to amend it to add a second session." },
    { kind: "motion", text: "Move to approve the first AMS recommendation", who: "Council Member Prieto", timestamp: "0:00:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the first AMS recommendation." },
    { kind: "vote", text: "The first AMS recommendation carries unanimously", who: "", timestamp: "0:00:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "That carries unanimously." },
    { kind: "vote", text: "The second recommendation carries unanimously", who: "", timestamp: "0:01:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "The second recommendation carries unanimously." },
    { kind: "vote", text: "The third recommendation carries unanimously", who: "", timestamp: "0:01:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "And the third carries unanimously." },
    { kind: "motion", text: "Move to approve the 2027 budget presentation", who: "Council Member Crist", timestamp: "0:10:00", packet_page: 30, numbers: "$2,000,000", agenda: "6B", source_words: "I move to approve the $2,000,000 budget presentation." },
    { kind: "vote", text: "The budget motion carries 5 to 2", who: "", timestamp: "0:10:30", packet_page: 30, numbers: "5-2", agenda: "6B", source_words: "The motion carries 5 to two." },
  ],
});

const THREE_LEAD_STATUS = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", label: "Library business classes", reason: "the library motions" },
    { item_no: 2, status: "lead", label: "Airport noise rules", reason: "the airport votes" },
    { item_no: 3, status: "lead", label: "2027 city budget", reason: "the budget hearing" },
  ],
});

/*
  Fix 3 -- procedural votes. The real tape's line ~5522, "carries six to one",
  is a vote to EXTEND THE MEETING: the fee motion before it was withdrawn ("that
  is withdrawn"), and the only motion alive in the 800 characters before the
  result is the one to extend. A result like that is the meeting running itself,
  not the item's vote -- it must never be written as 6B's vote, never counted for
  rank, and must never trip the "an item with a vote is reported" rule.
*/
const PROCEDURAL_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 200, text: "Council Member Crist: I move to approve the fee schedule.", item: "6B", itemTitle: "2027 Proposed Budget" },
  { index: 1, seconds: 260, text: "Council Member Kalkhofer: That is withdrawn. So um I will move to extend the meeting.", item: "6B", itemTitle: "2027 Proposed Budget" },
  { index: 2, seconds: 300, text: "Mayor: And that carries six to one with council member Christ in opposition.", item: "6B", itemTitle: "2027 Proposed Budget" },
];

// The control: the same shape, but the motion before the result is the item's
// own -- so the tally is a real decision and belongs to 6B.
const SUBSTANTIVE_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 600, text: "Council Member Crist: I move to approve the budget presentation.", item: "6B", itemTitle: "2027 Proposed Budget" },
  { index: 1, seconds: 630, text: "Mayor: The motion carries 5 to two.", item: "6B", itemTitle: "2027 Proposed Budget" },
];

/*
  Fix 5 -- names. The dev roster now reads "Jake Marsing, Mayor Pro Tem"
  (the tape's "Mayor Prom, are you comfortable with a withdrawal" is answered by
  the member who made and withdrew the fee motion). The packet names people and
  headings in the same capitalized shape, so a packet name is added only when it
  sits where a person sits and appears at least twice.
*/
const MAYOR_PRO_TEM_ROSTER = REAL_ROSTER.replace("Jake Marsing, Council member", "Jake Marsing, Mayor Pro Tem");

const MESSY_PACKET = [
  "Proclamation Declaring October 2026 Electrify Longmont Day",
  "Council member Jim Berthold.",
  "Jim Berthold, Council member, was recognized.",
  "The Fair Board met on Tuesday.",
  "Home Comfort was discussed.",
  "Proposed Budget Presentation",
].join("\n");

const NAME_TAPE = [
  "Mayor doggoering: The meeting will come to order.",
  "Council member Calcer: I move to approve the library item.",
  "Council member Christ: Second.",
  "Council member Koffer: Aye.",
  "Council member Coloffer: Aye.",
  "Council member Marcen: Aye.",
  "Council member Marc: Aye.",
  "Council member Marine: Aye.",
  "Mayor Hadel Fairing: Thank you.",
  "Mayor Prom, are you comfortable with a withdrawal?",
  "Mayor promoy: All in favor?",
  "Council member Zbyrowski: Aye.",
].join("\n");

/*
  Fix 6 -- the cold check's excerpts. The check has to be handed the tape of the
  written items' own time ranges, not a ledger digest: run 4 flagged SBDC, Data
  Axle, "20 to 60 students" and a staff quote as "not in the excerpts" when every
  one was in the tape it had never been shown.
*/
const COLD_PACKET: PacketPage[] = [
  { page: 12, text: "AMS VOLUNTARY NOISE ABATEMENT\nThe airport monitoring recommendations were presented." },
  { page: 30, text: "2027 PROPOSED BUDGET\nThe budget presentation and first public hearing." },
];

const COLD_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Council Member Prieto: I move to approve the first AMS recommendation.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 1, seconds: 30, text: "Mayor: All in favor? That carries unanimously.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 2, seconds: 60, text: "Mayor: The second recommendation carries unanimously.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 3, seconds: 90, text: "Mayor: And the third carries unanimously.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 4, seconds: 600, text: "Council Member Crist: I move to approve the budget presentation.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 5, seconds: 620, text: "Council Member Crist: SBDC can help 20 to 60 students.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
  { index: 6, seconds: 630, text: "Mayor: The motion carries 5 to two.", item: "1", itemTitle: "MEETING CALLED TO ORDER" },
];

const COLD_STATUS = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", label: "Airport noise rules", reason: "the airport votes" },
    { item_no: 2, status: "roundup", label: "2027 city budget", reason: "a budget hearing" },
  ],
});

/*
  Fix 1 -- the second section. Run 5's status pass called 6B (the 2027 budget and
  its first public hearing) a lead as well; the single-lead rule moved it to the
  roundup, where it got one short line and every dollar figure the tape held --
  the $511,000 shortfall, the $15,330 human services cut, the $495,670 savings,
  NextLight's budget -- was lost. A moved lead pick, or any item with five dollar
  figures or twenty minutes of tape, is written as its own short section under
  its plain label, after the lead story and before ALSO AT THE MEETING, at most
  two of them.
*/
const SECTIONS_AGENDA: AgendaListItem[] = [
  { id: "6A", title: "Presentation Of Airport Monitoring Systems Recommendations" },
  { id: "6B", title: "2027 Proposed Budget Presentation And First Public Hearing" },
  { id: "3", title: "MOTIONS AND RESOLUTIONS Library Business Classes" },
  { id: "5", title: "PROCLAMATIONS AND PRESENTATIONS" },
];

const SECTIONS_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Council Member Prieto: I move to approve the airport recommendation.", item: "6A", itemTitle: "Airport" },
  { index: 1, seconds: 30, text: "Mayor: That carries unanimously.", item: "6A", itemTitle: "Airport" },
  { index: 2, seconds: 1200, text: "Staff: the budget shortfall is $511,000.", item: "6B", itemTitle: "Budget" },
  { index: 3, seconds: 2400, text: "Staff: the library classes cost $10,000.", item: "3", itemTitle: "Library" },
  { index: 4, seconds: 3600, text: "Mayor: the proclamation was read.", item: "5", itemTitle: "Proclamations" },
];

const SECTIONS_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the airport recommendation", who: "Council Member Prieto", timestamp: "0:00:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the airport recommendation." },
    { kind: "vote", text: "The airport recommendation carries unanimously", who: "", timestamp: "0:00:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "That carries unanimously." },
    { kind: "staff-report", text: "The property tax shortfall is $511,000", who: "staff", timestamp: "0:20:00", packet_page: 30, numbers: "$511,000", agenda: "6B", source_words: "a $511,000 shortfall." },
    { kind: "staff-report", text: "A human services cut of $15,330", who: "staff", timestamp: "0:20:10", packet_page: 30, numbers: "$15,330", agenda: "6B", source_words: "a $15,330 cut." },
    { kind: "staff-report", text: "Savings of $495,670", who: "staff", timestamp: "0:20:20", packet_page: 30, numbers: "$495,670", agenda: "6B", source_words: "$495,670 in savings." },
    { kind: "staff-report", text: "NextLight's $24,907,816 budget", who: "staff", timestamp: "0:20:30", packet_page: 30, numbers: "$24,907,816", agenda: "6B", source_words: "$24,907,816." },
    { kind: "staff-report", text: "The airport fund totals $733,170", who: "staff", timestamp: "0:20:40", packet_page: 30, numbers: "$733,170", agenda: "6B", source_words: "$733,170." },
    { kind: "staff-report", text: "Library materials cost $10,000, and staffing $75,000", who: "staff", timestamp: "0:40:00", packet_page: 40, numbers: "$10,000", agenda: "3", source_words: "$10,000 and $75,000." },
    { kind: "staff-report", text: "A second session adds $30,000, supplies $100,000, travel $1.6", who: "staff", timestamp: "0:40:10", packet_page: 40, numbers: "$30,000", agenda: "3", source_words: "$30,000, $100,000, $1.6." },
    { kind: "proclamation", text: "Proclamation Declaring October 2026 Electrify Longmont Day", who: "", timestamp: "1:00:00", packet_page: 41, numbers: "", agenda: "5", source_words: "Proclamation Declaring October 2026 Electrify Longmont Day." },
  ],
});

const SECTIONS_STATUS = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", label: "Airport noise rules", reason: "the airport vote" },
    { item_no: 2, status: "roundup", label: "2027 city budget", reason: "a budget hearing" },
    { item_no: 3, status: "roundup", label: "Library business classes", reason: "library motions" },
    { item_no: 4, status: "roundup", label: "Electrify Longmont Day", reason: "a proclamation" },
  ],
});

const SECTIONS_PACKET: PacketPage[] = [
  { page: 12, text: "AMS VOLUNTARY NOISE ABATEMENT" },
  { page: 30, text: "2027 PROPOSED BUDGET" },
  { page: 40, text: "LIBRARY BUSINESS CLASSES" },
  { page: 41, text: "ELECTRIFY LONGMONT DAY" },
];

/*
  Fix 2 -- names from the packet. The packet prints each presenter's staff credit
  once ("Levi Brown, Airport Manager"; "Sandra Sifuentes, Budget"), and a person
  of record is a person even when the tape introduces them once. A caption that
  puts a different surname behind an office only one person holds ("Assistant
  city manager Jan Newton") is that person; a name the record cannot place is
  reported, never guessed at.
*/
const NAMES_PACKET = [
  "AIRPORT MONITORING",
  "Levi Brown, Airport Manager, Levi.Brown@longmontcolorado.gov",
  "Sandra Sifuentes, Budget",
  "",
].join("\n");

const NAMES_CAPTIONS = [
  "Assistant city manager Jan Newton walked them through the numbers.",
  "Sandra Cu Fuentes, budget manager, presented the fund.",
  "Grant Penelman, Planning and Development Services, described the fair.",
  "Debbie Odman ODM, sorry.",
].join("\n");

const NAMES_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Assistant city manager Jan Newton walked them through the numbers.", item: "6A", itemTitle: "Airport" },
  { index: 1, seconds: 30, text: "Sandra Cu Fuentes, budget manager, presented the fund.", item: "6A", itemTitle: "Airport" },
  { index: 2, seconds: 60, text: "Grant Penelman, Planning and Development Services, described the fair.", item: "6A", itemTitle: "Airport" },
  { index: 3, seconds: 90, text: "Debbie Odman ODM, sorry.", item: "6A", itemTitle: "Airport" },
];

const NAMES_INVENTORY = JSON.stringify({
  items: [
    { kind: "staff-report", text: "Assistant city manager Jan Newton walked them through the numbers", who: "", timestamp: "0:00:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "Assistant city manager Jan Newton walked them through the numbers." },
    { kind: "staff-report", text: "Sandra Cu Fuentes presented the fund", who: "", timestamp: "0:00:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "Sandra Cu Fuentes, budget manager, presented the fund." },
    { kind: "staff-report", text: "Grant Penelman described the fair", who: "", timestamp: "0:01:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "Grant Penelman, Planning and Development Services, described the fair." },
    { kind: "staff-report", text: "Debbie Odman spoke", who: "", timestamp: "0:01:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "Debbie Odman ODM, sorry." },
  ],
});

/*
  Fix 3 -- the packet's spellings for the tape's sound-alikes, and fix 6 -- the
  number the captions strip of its dollar sign and point. The packet writes the
  airport's easements as "Avigation" (the captions hear "navigation easement"),
  and the tape's "135 for seniors" is $1.35: a bare number beside a money word is
  flagged for the editor, never silently guessed.
*/
const TERMS_PACKET_TEXT =
  "AMS VOLUNTARY NOISE ABATEMENT\nThe Avigation easement protects the approach.\nAn avigation easement was recorded for the runway.";

const TERMS_PACKET: PacketPage[] = [{ page: 12, text: TERMS_PACKET_TEXT }];

const TERMS_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Council Member Prieto: I move to approve the airport recommendation.", item: "6A", itemTitle: "Airport" },
  { index: 1, seconds: 30, text: "Mayor: That carries unanimously.", item: "6A", itemTitle: "Airport" },
];

const TERMS_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the airport recommendation", who: "Council Member Prieto", timestamp: "0:00:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the airport recommendation." },
    { kind: "vote", text: "The airport recommendation carries unanimously", who: "", timestamp: "0:00:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "That carries unanimously." },
  ],
});

const TERMS_STATUS = JSON.stringify({
  items: [{ item_no: 1, status: "lead", label: "Airport noise rules", reason: "the vote" }],
});

const TERMS_AGENDA: AgendaListItem[] = [
  { id: "6A", title: "Presentation Of Airport Monitoring Systems Recommendations" },
];

/*
  Fix 5 -- the motions of the lead item as a numbered list. Run 5's story said of
  the AWOS motion that "a vote on a prior motion carried unanimously, with no
  tally recorded" -- two motions blurred into one sentence. The writer is given
  the item's motions in tape order, each with its own result, and states each
  motion's own result once.
*/
const MOTIONS_AGENDA: AgendaListItem[] = [
  { id: "6A", title: "Presentation Of Airport Monitoring Systems Recommendations" },
];

const MOTIONS_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 300, text: "Council Member Prieto: I move to approve the first AMS recommendation.", item: "6A", itemTitle: "Airport" },
  { index: 1, seconds: 330, text: "Mayor: All in favor? That carries unanimously.", item: "6A", itemTitle: "Airport" },
  { index: 2, seconds: 600, text: "Council Member Popkin: I move to approve the saturated pattern language.", item: "6A", itemTitle: "Airport" },
  { index: 3, seconds: 630, text: "Mayor: The motion carries 5 to two.", item: "6A", itemTitle: "Airport" },
];

const MOTIONS_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the first AMS recommendation", who: "Council Member Prieto", timestamp: "0:05:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the first AMS recommendation." },
    { kind: "vote", text: "The first AMS recommendation carries unanimously", who: "", timestamp: "0:05:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "That carries unanimously." },
    { kind: "motion", text: "Move to approve the saturated pattern language", who: "Council Member Popkin", timestamp: "0:10:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the saturated pattern language." },
    { kind: "vote", text: "The saturated pattern language carries 5 to 2", who: "", timestamp: "0:10:30", packet_page: 12, numbers: "5-2", agenda: "6A", source_words: "The motion carries 5 to two." },
  ],
});

const MOTIONS_PACKET: PacketPage[] = [{ page: 12, text: "AMS VOLUNTARY NOISE ABATEMENT" }];

/*
  Fix 4 -- the cold check's noise. Run 5's reader denied a tally the code had
  found ("no vote tally recorded") and called real tape facts absent from
  excerpts that were too narrow. The check runs paragraph by paragraph, and a
  line that denies a vote the code found is dropped.
*/
const COLD2_AGENDA: AgendaListItem[] = [
  { id: "6A", title: "Presentation Of Airport Monitoring Systems Recommendations" },
  { id: "6B", title: "2027 Proposed Budget Presentation" },
];

const COLD2_SEGMENTS: MeetingSegment[] = [
  { index: 0, seconds: 0, text: "Council Member Prieto: I move to approve the airport recommendation.", item: "6A", itemTitle: "Airport" },
  { index: 1, seconds: 30, text: "Mayor: That carries unanimously.", item: "6A", itemTitle: "Airport" },
  { index: 2, seconds: 1200, text: "Staff: the property tax shortfall is $511,000.", item: "6B", itemTitle: "Budget" },
];

const COLD2_INVENTORY = JSON.stringify({
  items: [
    { kind: "motion", text: "Move to approve the airport recommendation", who: "Council Member Prieto", timestamp: "0:00:00", packet_page: 12, numbers: "", agenda: "6A", source_words: "I move to approve the airport recommendation." },
    { kind: "vote", text: "The airport recommendation carries unanimously", who: "", timestamp: "0:00:30", packet_page: 12, numbers: "", agenda: "6A", source_words: "That carries unanimously." },
    { kind: "staff-report", text: "The property tax shortfall is $511,000", who: "staff", timestamp: "0:20:00", packet_page: 30, numbers: "$511,000", agenda: "6B", source_words: "a $511,000 shortfall." },
  ],
});

const COLD2_STATUS = JSON.stringify({
  items: [
    { item_no: 1, status: "lead", label: "Airport noise rules", reason: "the vote" },
    { item_no: 2, status: "roundup", label: "2027 city budget", reason: "a budget" },
  ],
});

const COLD2_PACKET: PacketPage[] = [
  { page: 12, text: "AMS VOLUNTARY NOISE ABATEMENT" },
  { page: 30, text: "2027 PROPOSED BUDGET\nBudget documents describe a $511,000 shortfall." },
];

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
          // The lead handler also writes the second-section stories (the section
          // writer is the lead writer with a subhead), so the lead story's own
          // call is the one that carries the lead item source.
          if (user.includes("LEAD ITEM SOURCE")) leadPrompt = user;
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
    assert.match(leadPrompt, /RESULT: carries, 5-2/, "the writer is handed the tally as a fact");
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
      mapped.mappings.some((row) => row.captioned === "Council Member Marcin" && row.known === "Jake Marsing"),
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

  it("leaves exactly one lead and writes the status pass's other picks as their own short sections", async () => {
    /*
      Run 4's status pass called three items "lead" -- the library motions (1),
      the airport presentation (6A) and the budget (6B) -- and the story was
      written about the library while 6A, three unanimous results and the top
      item by rank, appeared nowhere. Exactly one item leads: the top-ranked one.
      The two the model also picked were moved into the roundup by run 5 and got
      one short line each -- and 6B's budget facts were lost that way -- so each
      moved pick is written as a short section of its own under its plain name,
      after the lead story, up to two of them.
    */
    const leadPrompts: string[] = [];
    const result = await run(
      {
        inventory: () => THREE_LEAD_INVENTORY,
        status: () => THREE_LEAD_STATUS,
        lead: (user) => {
          leadPrompts.push(user);
          // The section writer is the lead writer with a subhead, so this one
          // handler answers both; its reply answers the call it was given.
          return JSON.stringify({
            headline: "Airport rules",
            dek: "",
            lead: user.includes("SECTION ITEM SOURCE")
              ? "The item was discussed at length."
              : "The council adopted the airport monitoring recommendations.",
          });
        },
        roundup: () => JSON.stringify({ paragraph: "The item was discussed." }),
        cold: () => COLD_OK,
      },
      { segments: AIRPORT_SEGMENTS, agendaList: THREE_LEAD_AGENDA },
    );
    const leadPrompt = leadPrompts.find((prompt) => prompt.includes("LEAD ITEM SOURCE"))!;
    const sectionPrompts = leadPrompts.filter((prompt) => prompt.includes("SECTION ITEM SOURCE"));
    assert.equal(sectionPrompts.length, 2, "one lead story, and a section for each of the two moved picks");
    assert.match(leadPrompt, /6A\. Presentation Of Options/, "the lead source is the top-ranked item, not the model's first pick");
    assert.ok(
      result.body.startsWith("The council adopted the airport monitoring recommendations."),
      "the body's first paragraph is about the top-ranked item",
    );
    assert.equal(result.ledger.filter((item) => item.status === "lead").length, 1, "exactly one item leads");
    assert.equal(result.ledger[1]!.itemNo, 2);
    assert.equal(result.ledger[1]!.status, "lead");
    assert.equal(result.ledger[0]!.reason, SECOND_LEAD_REASON, "the library pick's reason says it was moved");
    assert.equal(result.ledger[2]!.reason, SECOND_LEAD_REASON, "the budget pick's reason says it was moved");
    // A moved pick the model called a lead is an item it thought was big, so it
    // is written as its own short section under its plain name -- not squeezed
    // into one roundup line. At most two such sections.
    assert.match(
      result.body,
      /\n\nLibrary business classes\n\nThe item was discussed at length\./,
      "the library pick is written under its own subhead, not in the roundup list",
    );
    assert.match(
      result.body,
      /\n\n2027 city budget\n\nThe item was discussed at length\./,
      "and so is the budget pick",
    );
    assert.ok(
      result.body.indexOf("Library business classes") > result.body.indexOf("adopted the airport monitoring"),
      "the sections come after the lead story",
    );
    assert.match(result.meetingNotes, /SECOND LEADS: 2 item\(s\)/, "the run records the two moved picks");
    assert.match(result.meetingNotes, /SECTIONS: 2 item\(s\)/, "and gives each a section of its own");
  });

  it("rewrites a paragraph that says no vote was recorded when the item holds a result", async () => {
    /*
      The run-4 story said "No vote was recorded in the source" for a motion the
      ledger recorded as "carries, 5-2". The writer is handed each result as a
      fact; when a paragraph still denies it, one repair call rewrites that
      paragraph from the record, and what survives is flagged, not silently kept.
    */
    let repairCalls = 0;
    let repairUser = "";
    const result = await run(
      {
        inventory: () => TALLY_AGENDA_INVENTORY,
        status: () => JSON.stringify({ items: [{ item_no: 1, status: "lead", reason: "the vote" }] }),
        lead: () =>
          JSON.stringify({
            headline: "H",
            dek: "",
            lead: "The council took up the airport noise policy. No vote was recorded in the source for the motion.",
          }),
        repair: (user) => {
          repairCalls += 1;
          repairUser = user;
          return JSON.stringify({ paragraph: "The council took up the airport noise policy. The motion carries 5-2." });
        },
        cold: () => COLD_OK,
      },
      { segments: TALLY_SEGMENTS, agendaList: TALLY_AGENDA },
    );
    assert.equal(repairCalls, 1, "exactly one repair call is made for the flagged paragraph");
    assert.match(repairUser, /ITEM: Airport noise policy/, "the repair call is scoped to the item");
    assert.match(repairUser, /RECORD: carries, 5-2, at 00:05:00/, "the repair call hands over the record's result as a fact");
    assert.doesNotMatch(result.body, /no vote was recorded/i, "the repaired body no longer denies the vote");
    assert.match(result.body, /carries 5-2/, "the body carries the record's tally");
    assert.match(result.meetingNotes, /VOTE REPAIRS: 1 paragraph/, "the run counts the repair");
    assert.ok(
      !result.claims.some((claim) => /Contradicts the record/.test(claim.note)),
      "a paragraph the repair fixed is not left as a contradiction",
    );
  });

  it("reads a vote to extend the meeting as procedural, not as the item's vote", async () => {
    /*
      The tape's "carries six to one" (line ~5522) is a vote to EXTEND THE
      MEETING: the fee motion before it was withdrawn ("that is withdrawn"), and
      the only motion alive in the 800 characters before the result is the one to
      extend. The old code put 6-1 on the budget and wrote the budget's vote as
      "carries, 6-1". A procedural result is never the item's vote, never counted
      for rank, and never trips the rule that keeps a voted item off the drop
      list.
    */
    const findings = scanVoteResults(PROCEDURAL_SEGMENTS);
    assert.equal(findings.length, 1, "one result phrase is read off the tape");
    assert.equal(findings[0]!.tally, "6-1", "the six-to-one tally is normalized");
    assert.equal(findings[0]!.procedural, true, "the result is marked procedural from the tape before it");

    const budget = row({
      itemNo: 1,
      kind: "agenda-item",
      text: "6B. 2027 Proposed Budget",
      startSeconds: 200,
      endSeconds: 400,
      packetPage: 30,
      evidence: [
        { kind: "motion", text: "Move to approve the fee schedule.", who: "Council Member Crist", startSeconds: 210, packetPage: 30, numbers: "", sourceExcerpt: "I move to approve the fee schedule." },
        { kind: "withdrawn-motion", text: "The fee motion was withdrawn.", who: "", startSeconds: 260, packetPage: 30, numbers: "", sourceExcerpt: "That is withdrawn." },
      ],
    });
    const withdrawnOnly = row({
      kind: "agenda-item",
      text: "6B. Fee schedule",
      startSeconds: 200,
      endSeconds: 400,
      evidence: [
        { kind: "withdrawn-motion", text: "The fee motion was withdrawn.", who: "", startSeconds: 260, packetPage: 30, numbers: "", sourceExcerpt: "That is withdrawn." },
      ],
    });
    const attached = attachVoteResults([budget, withdrawnOnly], findings);
    assert.equal(attached[0]!.motions!.length, 1, "the result attaches to the item that holds the motion");
    assert.equal(attached[0]!.motions![0]!.kind, "procedural", "and it is marked procedural");
    assert.equal(attached[0]!.motions![0]!.tally, "6-1");
    assert.equal(attached[0]!.voteTally, "", "a procedural result never becomes the item's flat tally");
    assert.equal(attached[0]!.voteResult, "", "nor its flat result");
    assert.equal(voteResultCount(attached[0]!), 0, "a procedural result is never counted for rank");
    assert.equal(isProceduralItem(attached[0]!), true);
    assert.equal(attached[1]!.motions!.length, 0, "an item with only a withdrawn motion takes no result");

    const kept = applyStatuses(
      [attached[0]!],
      [{ itemNo: 1, status: "excluded", label: "2027 city budget", reason: "the meeting's own procedure" }],
    );
    assert.equal(kept[0]!.status, "excluded", "an item whose only result is procedural stays off the drop list's override");

    // The control: the same shape with the item's own motion before the result.
    const substantive = scanVoteResults(SUBSTANTIVE_SEGMENTS);
    assert.equal(substantive[0]!.procedural, false, "an item's own motion is not procedural");
    const decided = attachVoteResults(
      [row({ kind: "agenda-item", text: "6B. 2027 Proposed Budget", startSeconds: 600, endSeconds: 700, evidence: [{ kind: "motion", text: "Move to approve the budget presentation.", who: "Council Member Crist", startSeconds: 600, packetPage: 30, numbers: "", sourceExcerpt: "I move to approve the budget presentation." }] })],
      substantive,
    );
    assert.equal(decided[0]!.motions![0]!.kind, "decision");
    assert.equal(decided[0]!.voteTally, "5-2");
    assert.equal(voteResultCount(decided[0]!), 1, "a real decision is still counted");
  });

  it("labels a roundup item in plain words and folds an item's own record into it", async () => {
    /*
      Run 4's roundup paragraphs opened with the raw agenda line cut mid-word
      ("2. ROLL CALL AND PLEDGE OF ALLEGIANCE City Council Study Session,
      September 29,:"). The status pass's own plain label is used when it gives
      one; otherwise the agenda title is stripped of its number and footer and
      cut at a word boundary. Before the write, an item's own record -- its
      motion, amendment and discussion block -- and its own proclamation are
      folded under it.
    */
    assert.equal(
      plainLabel(row({ kind: "agenda-item", text: "2. ROLL CALL AND PLEDGE OF ALLEGIANCE City Council Study Session, September 29, 2026 Page 1 [Packet Page 1]" })),
      "ROLL CALL AND PLEDGE OF ALLEGIANCE",
      "the agenda number and the session footer are stripped",
    );
    const longTitle = plainLabel(
      row({
        kind: "agenda-item",
        text: "6A. Presentation Of Options To Implement The Airport Monitoring Systems (AMS) Voluntary Noise Abatement Procedures (VNAP) Recommendations For Vance Brand Municipal Airport",
      }),
    );
    assert.match(longTitle, /^Presentation Of Options/, "the label starts at the title, not the agenda number");
    assert.ok(longTitle.length <= 60, "the label is cut short enough to open a paragraph");
    assert.match(longTitle, /[A-Za-z]$/, "and it is cut at a word boundary, not mid-word");

    const keptLabel = applyStatuses(
      [row({ itemNo: 1, kind: "agenda-item", text: "3. MOTIONS AND RESOLUTIONS Library Business Classes" })],
      [{ itemNo: 1, status: "roundup", label: "Library business classes", reason: "a library item" }],
    );
    assert.equal(keptLabel[0]!.label, "Library business classes", "the status pass's plain label wins");
    const fallbackLabel = applyStatuses(
      [row({ itemNo: 1, kind: "agenda-item", text: "2. ROLL CALL AND PLEDGE OF ALLEGIANCE City Council Study Session, September 29, 2026 Page 1" })],
      [],
    );
    assert.equal(fallbackLabel[0]!.label, "ROLL CALL AND PLEDGE OF ALLEGIANCE", "with no model label, the agenda title is the label");

    const merged = mergeRelatedItems([
      row({ kind: "agenda-item", text: "3. MOTIONS AND RESOLUTIONS Library Business Classes", startSeconds: 10800, endSeconds: 12000, packetPage: 40 }),
      row({ kind: "motion", text: "Move to approve the library business classes", startSeconds: 10860, packetPage: 40 }),
      row({ kind: "amendment", text: "Amendment to add a second session", startSeconds: 10920, packetPage: 40 }),
      row({ kind: "block", text: "Discussion from 03:00:00", startSeconds: 11000, endSeconds: 11500, packetPage: 40 }),
      row({ kind: "agenda-item", text: "5A. Proclamation Declaring October 2026 Electrify Longmont Day", startSeconds: 12000, endSeconds: 12300, packetPage: 41 }),
      row({ kind: "proclamation", text: "Proclamation Declaring October 2026 Electrify Longmont Day", startSeconds: 12030, packetPage: 41 }),
      row({ kind: "tribute", text: "Tribute to Jim Berthold", startSeconds: 15000, packetPage: 42 }),
    ]);
    assert.equal(merged.merged, 4, "the motion, amendment, block and proclamation are folded into their items");
    assert.equal(merged.items.length, 3);
    assert.equal(merged.items[0]!.evidence!.length, 3, "the library item keeps its motion, amendment and block");
    assert.equal(merged.items[1]!.evidence!.length, 1, "5A keeps its own proclamation");
    assert.match(merged.items[2]!.text, /Tribute to Jim Berthold/, "a tribute with no matching item stays its own entry");
  });

  it("corrects the tape's garbled names, maps a title to its holder, and flags a name it cannot verify", async () => {
    /*
      Run 4's mapping printed junk: "Hadel Fairing -> The Fair", "Prom McCoy ->
      Based Decision Making", "Koffer -> Home Comfort". The known-names list is
      the newsroom's officials-and-staff list plus people of record the packet
      names; a packet heading is not a person. The dev roster now reads "Jake
      Marsing, Mayor Pro Tem" (the tape's "Mayor Prom" is answered by the member
      who made and withdrew the fee motion), so a garbled title resolves to the
      person the roster says holds it.
    */
    const known = buildKnownNames({ roster: MAYOR_PRO_TEM_ROSTER, packetText: MESSY_PACKET });
    assert.deepEqual(
      known.filter((entry) => entry.from === "packet").map((entry) => entry.name),
      ["Jim Berthold"],
      "only the packet's person, not its headings, joins the list",
    );

    const mapped = mapCaptionNames(NAME_TAPE, known, MESSY_PACKET);
    const knownFor = new Map(mapped.mappings.map((entry) => [entry.captioned, entry.known]));
    assert.equal(knownFor.get("Council member Koffer"), "Alex Kalkhofer");
    assert.equal(knownFor.get("Council member Coloffer"), "Alex Kalkhofer");
    assert.equal(knownFor.get("Council member Calcer"), "Alex Kalkhofer");
    assert.equal(knownFor.get("Council member Christ"), "Diane Crist");
    assert.equal(knownFor.get("Council member Marcen"), "Jake Marsing");
    assert.equal(knownFor.get("Council member Marc"), "Jake Marsing");
    assert.equal(knownFor.get("Council member Marine"), "Jake Marsing");
    assert.equal(knownFor.get("Mayor doggoering"), "Susie Hidalgo-Fahring");
    assert.equal(knownFor.get("Mayor Hadel Fairing"), "Susie Hidalgo-Fahring", "a garbled name is never mapped to a phrase");
    assert.equal(knownFor.get("Mayor Prom"), "Mayor Pro Tem Jake Marsing", "the title resolves to the person who holds it");
    assert.equal(knownFor.get("Mayor promoy"), "Mayor Pro Tem Jake Marsing");
    assert.equal(knownFor.get("Council member Zbyrowski"), "a council member", "an unverifiable name is written as the title only");
    assert.ok(mapped.unverified.includes("Council member Zbyrowski"), "and it is flagged, not invented");
    assert.ok(!knownFor.has("Hadel Fairing"), "no mapping names the garbled phrase as the person");
  });

  it("cold-reads one paragraph at a time against that paragraph's own tape windows and packet page", async () => {
    /*
      Run 4's cold check reported SBDC, Data Axle, "20 to 60 students" and a
      staff quote as "not in the excerpts" when every one was in the tape it had
      never been shown: it was handed a ledger digest, not the tape. Run 5's
      reader was handed the lead item's whole span -- about three hours of tape
      for the airport item -- and only its first 40,000 characters, so it called
      the complaint system, the 88%/66% conformance figures and Crist's question
      "absent from the excerpts". A paragraph is a small thing: each paragraph is
      checked on its own, against the tape windows whose words overlap it most
      and the packet page of the item it was written from.
    */
    const coldUsers: string[] = [];
    await run(
      {
        inventory: () => AIRPORT_INVENTORY,
        status: () => COLD_STATUS,
        lead: () => JSON.stringify({ headline: "Airport rules", dek: "", lead: "The council acted." }),
        roundup: () => JSON.stringify({ paragraph: "The budget was presented." }),
        cold: (user) => {
          coldUsers.push(user);
          return COLD_OK;
        },
      },
      { segments: COLD_SEGMENTS, packetPages: COLD_PACKET, agendaList: SEPT29_AGENDA },
    );
    assert.equal(COLD_CHECK_MAX, 15, "the reader's list is capped at 15, most serious first");
    assert.equal(coldUsers.length, 2, "each written paragraph is checked on its own, not as one digest");
    const leadCheck = coldUsers.find((user) => user.startsWith("ITEM: Airport noise rules\nEXCERPTS:"));
    const roundupCheck = coldUsers.find((user) => user.startsWith("ITEM: 2027 city budget\nEXCERPTS:"));
    assert.ok(leadCheck, "the lead paragraph is checked under the lead item's plain name");
    assert.ok(roundupCheck, "and the roundup paragraph under its own name");
    assert.match(
      leadCheck,
      /\[00:00:00\] Council Member Prieto: I move to approve the first AMS recommendation\./,
      "the lead paragraph's own tape windows are handed over",
    );
    assert.match(
      roundupCheck,
      /\[00:10:20\] Council Member Crist: SBDC can help 20 to 60 students\./,
      "the paragraph's own tape windows reach the line run 4 called absent",
    );
    assert.match(leadCheck, /PACKET PAGES:\nAMS VOLUNTARY NOISE ABATEMENT/, "the lead item's packet page is handed over");
    assert.match(roundupCheck, /PACKET PAGES:\n2027 PROPOSED BUDGET/, "and the roundup item's own packet page");
    assert.equal(
      (leadCheck.match(/TAPE:\n/g) ?? []).length <= COLD_WINDOW_HITS,
      true,
      "no more than the best few tape windows per paragraph",
    );
    assert.match(leadCheck, /PARAGRAPH:\nThe council acted\./, "the paragraph itself is what the reader is asked about");
  });

  it("counts a tally as a vote word only near a vote verb, and never a year range", async () => {
    /*
      Run 4 flagged "20 to 60" (students), "10 to 2" (hours) and "2027-2031"
      (years) as vote words. A tally is a vote word only within a few words of a
      vote verb, and a year range is a year range.
    */
    assert.deepEqual(voteWordsIn("SBDC can help 20 to 60 students."), [], "a count of students is not a vote");
    assert.deepEqual(voteWordsIn("The fair runs from 10 to 2 hours."), [], "hours are not a vote");
    assert.deepEqual(voteWordsIn("The 2027-2031 capital improvement plan was presented."), [], "a year range is not a vote");
    assert.deepEqual(voteWordsIn("The council voted, 5 to 2, but no vote was recorded in the source."), [], "a sentence that denies a vote is never read as one");
    assert.deepEqual(voteWordsIn("The council voted on the 20 to 60 plan in 2027."), [], "a tally beside a year is not the item's vote");
    assert.deepEqual(voteWordsIn("The council voted 5 to 2."), ["5 to 2"], "a tally next to a vote verb is a vote word");
    assert.deepEqual(voteWordsIn("The council acted unanimously."), ["unanimously"], "a unanimous vote is found too");
  });

  it("writes a big non-lead item as its own section after the lead, capped at two", async () => {
    /*
      Fix 1. Run 5 led on 6A and moved its own second lead pick, 6B, to the
      roundup: a $511,000 shortfall, a $15,330 human services cut, a $495,670
      savings and NextLight's budget became one short paragraph. An item the
      status pass called a lead, or one with five dollar figures or twenty
      minutes of tape, gets its own section -- a plain subhead and up to 450
      words -- after the lead and before ALSO AT THE MEETING, at most two.
    */
    assert.equal(SECTION_MAX, 2, "at most two items get their own section");
    assert.equal(SECTION_DOLLAR_MIN, 5, "five dollar figures earn a section");
    assert.equal(SECTION_SECONDS_MIN, 1200, "and twenty minutes of tape earns one");

    const small: LedgerItem = {
      itemNo: 9,
      kind: "staff-report",
      text: "small",
      startSeconds: 0,
      endSeconds: 60,
      packetPage: null,
      status: "roundup",
      reason: "",
      sourceExcerpt: "one $5",
      evidence: [],
      motions: [],
    };
    assert.equal(deservesOwnSection(small), false, "one figure and a minute of tape do not earn a section");
    assert.equal(
      deservesOwnSection({ ...small, sourceExcerpt: "$1 $2 $3 $4 $5" }),
      true,
      "five dollar figures earn a section",
    );
    assert.equal(
      deservesOwnSection({ ...small, sourceExcerpt: "", startSeconds: 0, endSeconds: 1300 }),
      true,
      "twenty minutes of tape earn a section",
    );
    assert.equal(
      deservesOwnSection({ ...small, sourceExcerpt: "", reason: SECOND_LEAD_REASON }),
      true,
      "an item the status pass called a lead earns a section even with no figures",
    );
    assert.equal(
      deservesOwnSection({ ...small, sourceExcerpt: "$1 $2 $3 $4 $5", status: "lead" }),
      false,
      "the lead itself is the lead, not a section",
    );

    const many = [1, 2, 3, 4].map((n) => ({
      ...small,
      itemNo: n,
      sourceExcerpt: Array.from({ length: 4 + n }, (_, i) => `$${i}`).join(" "),
    }));
    const chosen = chooseSectionItems(many);
    assert.equal(chosen.length, SECTION_MAX, "sections are capped at two");
    assert.deepEqual(chosen.map((item) => item.itemNo), [4, 3], "the most-figured items are chosen first");
    assert.equal(chooseSectionItems([]).length, 0, "nothing to choose when nothing deserves a section");

    const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} has several words in it.`).join(" ");
    const capped = capWords(long);
    assert.ok(capped.split(/\s+/).length <= SECTION_WORD_CAP, "a section is capped at 450 words");
    assert.match(capped, /\.$/, "and the cap cuts back to a sentence end, not mid-word");

    const sectionPrompts: string[] = [];
    const leadPrompts: string[] = [];
    const result = await run(
      {
        inventory: () => SECTIONS_INVENTORY,
        status: () => SECTIONS_STATUS,
        lead: (user) => {
          if (user.includes("SECTION ITEM SOURCE")) {
            sectionPrompts.push(user);
            return JSON.stringify({ headline: "H", dek: "", lead: `Section body. ${user.includes("budget") ? "budget" : "library"}` });
          }
          leadPrompts.push(user);
          return JSON.stringify({ headline: "Airport rules", dek: "", lead: "The council adopted the airport recommendation." });
        },
        roundup: () => JSON.stringify({ paragraph: "A short roundup line." }),
        cold: () => COLD_OK,
      },
      { segments: SECTIONS_SEGMENTS, agendaList: SECTIONS_AGENDA, packetPages: SECTIONS_PACKET },
    );
    assert.equal(sectionPrompts.length, SECTION_MAX, "exactly two items were written as sections");
    assert.equal(leadPrompts.length, 1, "the lead story is written once");
    const budgetPrompt = sectionPrompts.find((prompt) => prompt.includes("$511,000"));
    assert.ok(budgetPrompt, "the budget item, not just the smaller one, is written as a section");
    assert.match(budgetPrompt, /\$511,000/, "the section writer sees the item's own dollar figures");
    assert.ok(
      !result.body.includes("$511,000"),
      "the roundup line is short -- the figures live in the section, not the roundup",
    );

    const leadAt = result.body.indexOf("The council adopted the airport recommendation.");
    const libraryAt = result.body.indexOf("Library business classes");
    const budgetAt = result.body.indexOf("2027 city budget");
    const roundupAt = result.body.indexOf(ROUNDUP_HEADING);
    assert.ok(leadAt >= 0 && libraryAt > leadAt, "the sections come after the lead story");
    assert.ok(budgetAt > leadAt, "both sections come after the lead story");
    assert.ok(roundupAt > libraryAt && roundupAt > budgetAt, "and both come before ALSO AT THE MEETING");
    assert.match(result.body.slice(roundupAt), /Electrify Longmont Day: A short roundup line\./, "the small item stays a short roundup line");
    assert.match(
      result.meetingNotes,
      new RegExp(`SECTIONS: ${SECTION_MAX} item\\(s\\) got their own section after the lead`),
      "the notes count the sections",
    );
  });

  it("takes a name the packet prints once with its title, and maps a title to its one holder", async () => {
    /*
      Fix 2. The packet prints each presenter's staff credit exactly once
      ("Levi Brown, Airport Manager"; "Sandra Sifuentes, Budget"), and that one
      credit names a person of record. A caption that puts a strange surname
      behind an office only one person holds -- "Assistant city manager Jan
      Newton" -- is that person (Jenn Ooton). A name the record cannot place is
      reported under "Names not verified", never printed as if sourced.
    */
    const known = buildKnownNames({ roster: REAL_ROSTER, packetText: NAMES_PACKET });
    const packetPeople = known.filter((entry) => entry.from === "packet");
    assert.deepEqual(
      packetPeople.map((entry) => `${entry.name} <${entry.title}>`),
      ["Levi Brown <Airport Manager>", "Sandra Sifuentes <Budget>"],
      "a single \"First Last, Title\" staff credit is a person of record",
    );

    const mapped = mapCaptionNames(NAMES_CAPTIONS, known, NAMES_PACKET);
    const knownFor = new Map(mapped.mappings.map((entry) => [entry.captioned, entry.known]));
    assert.equal(knownFor.get("Assistant city manager Jan Newton"), "Jenn Ooton", "a title maps to the sole person who holds it");
    assert.equal(knownFor.get("Sandra Cu Fuentes"), "Sandra Sifuentes", "a garbled caption surname maps to the packet's spelling");
    assert.deepEqual(mapped.unverified, ["Grant Penelman", "Debbie Odman"], "a name the record cannot place is flagged, not invented");

    const prompts: string[] = [];
    const result = await run(
      {
        inventory: () => NAMES_INVENTORY,
        status: () => TERMS_STATUS,
        lead: (user) => {
          prompts.push(user);
          return JSON.stringify({ headline: "H", dek: "", lead: "Jenn Ooton and Sandra Sifuentes presented." });
        },
        cold: () => COLD_OK,
      },
      {
        segments: NAMES_SEGMENTS,
        agendaList: TERMS_AGENDA,
        packetPages: [{ page: 12, text: NAMES_PACKET }],
        roster: REAL_ROSTER,
      },
    );
    assert.match(prompts[0]!, /NAMES AS THE RECORD SPELLS THEM[\s\S]*- Assistant city manager Jan Newton -> Jenn Ooton/, "the writer is given the corrected spelling");
    assert.match(result.meetingNotes, /Names corrected from the newsroom's list: Assistant city manager Jan Newton -> Jenn Ooton/, "the notes record the correction");
    assert.match(result.meetingNotes, /Names not verified: Grant Penelman, Debbie Odman\./, "and flag the names it could not place");
  });

  it("gives every writer the packet's spellings and sweeps a sound-alike from the body", async () => {
    /*
      Fix 3. The captions mishear the packet's terms: "AWAS" for AWOS, and
      "navigation easement" for the packet's "avigation easement". The term list
      is built from the packet (acronyms and rare words, named twice) and handed
      to every writer; a code pass over the body then replaces a sound-alike and
      records each replacement in the notes.
    */
    assert.deepEqual(packetTerms(TERMS_PACKET_TEXT), ["Avigation"], "the packet's rare term, named twice, is the term list");
    assert.equal(
      termSpellingBlock(["Avigation"]),
      "PACKET SPELLINGS: when the tape has a sound-alike for one of these packet terms, use the packet's spelling: Avigation.",
      "the term list becomes a block for the writer",
    );

    const spelled = applyPacketSpellings("The AWAS messages and a navigation easement were discussed.", TERMS_PACKET_TEXT);
    assert.equal(spelled.text, "The AWOS messages and a avigation easement were discussed.", "the caption's sound-alikes are replaced with the packet's spellings");
    assert.deepEqual(spelled.changes, ["awas -> AWOS", "navigation easement -> avigation easement"], "each replacement is recorded");

    assert.equal(
      applyPacketSpellings("The navigation system was upgraded.", "The packet describes the airport navigation.").text,
      "The navigation system was upgraded.",
      "a bare \"navigation\" is left alone -- only \"navigation easement\" is the packet's sound-alike",
    );

    const prompts: string[] = [];
    const result = await run(
      {
        inventory: () => TERMS_INVENTORY,
        status: () => TERMS_STATUS,
        lead: (user) => {
          prompts.push(user);
          return JSON.stringify({ headline: "H", dek: "", lead: "The airport uses AWAS messages and a navigation easement." });
        },
        cold: () => COLD_OK,
      },
      { segments: TERMS_SEGMENTS, agendaList: TERMS_AGENDA, packetPages: TERMS_PACKET },
    );
    assert.match(prompts[0]!, /PACKET SPELLINGS:[\s\S]*Avigation/, "every writer call gets the packet's spellings");
    assert.match(result.body, /The airport uses AWOS messages and a avigation easement\./, "the body carries the packet's spellings, not the captions'");
    assert.match(
      result.meetingNotes,
      /PACKET SPELLINGS: awas -> AWOS; navigation easement -> avigation easement\./,
      "the notes record each replacement",
    );
  });

  it("flags a bare number beside a money word for the editor rather than guessing the fix", async () => {
    /*
      Fix 6. The tape says "135 for seniors"; the real fare is $1.35 -- the
      captions drop the dollar sign and the point. The code cannot know which
      bare number is money, so it flags every bare number next to a money word
      that carries no "$", for the editor.
    */
    assert.deepEqual(
      bareMoneyNumbers("Fares are $10 for adults and 135 for seniors."),
      ['135 (near "fares")'],
      "a bare number beside a money word is flagged",
    );
    assert.deepEqual(
      bareMoneyNumbers("The adult fare is $2.50 and children ride free."),
      [],
      "a number that already carries its dollar sign is not flagged",
    );
    assert.deepEqual(
      bareMoneyNumbers("The 2027 budget hearing was held in October."),
      [],
      "a year is not a money figure",
    );

    const result = await run(
      {
        inventory: () => TERMS_INVENTORY,
        status: () => TERMS_STATUS,
        lead: () => JSON.stringify({ headline: "H", dek: "", lead: "Fares are $10 for adults and 135 for seniors." }),
        cold: () => COLD_OK,
      },
      { segments: TERMS_SEGMENTS, agendaList: TERMS_AGENDA, packetPages: TERMS_PACKET },
    );
    assert.match(
      result.meetingNotes,
      /NUMBER CHECK: a bare number sits next to a money word with no "\$" \(135 \(near "fares"\)\)/,
      "the notes hand the editor the bare number, not a guessed correction",
    );
    assert.match(result.body, /135 for seniors/, "the code does not silently rewrite the number");
  });

  it("hands the writer the lead item's motions in order, each with its own result", async () => {
    /*
      Fix 5. Run 5's story blurred two motions into one sentence: "A vote on a
      prior motion carried unanimously, with no tally recorded." The lead item's
      motions are given the writer as a numbered list in tape order, each with
      its own mover, text, result and time, so each motion's own result is stated
      once.
    */
    const result = await run(
      {
        inventory: () => MOTIONS_INVENTORY,
        status: () => TERMS_STATUS,
        lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council approved the recommendations." }),
        cold: () => COLD_OK,
      },
      { segments: MOTIONS_SEGMENTS, agendaList: MOTIONS_AGENDA, packetPages: MOTIONS_PACKET },
    );
    assert.equal(result.ledger[0]!.motions.length, 2, "both motions are found");
    assert.deepEqual(
      result.ledger[0]!.motions.map((motion) => [motion.seconds, motion.result, motion.tally || motion.unanimous]),
      [
        [330, "carries", "unanimous"],
        [630, "carries", "5-2"],
      ],
      "each motion keeps its own result",
    );

    const lines = motionLines(result.ledger[0]!);
    assert.equal(lines.length, 2, "the motions are a numbered list");
    assert.match(lines[0]!, /^1\. .*unanimous, at 00:05:30$/, "the first motion states its own unanimous result");
    assert.match(lines[1]!, /^2\. .*5-2, at 00:10:30$/, "the second motion states its own 5-2 result");

    const prompts: string[] = [];
    await run(
      {
        inventory: () => MOTIONS_INVENTORY,
        status: () => TERMS_STATUS,
        lead: (user) => {
          prompts.push(user);
          return JSON.stringify({ headline: "H", dek: "", lead: "The council approved the recommendations." });
        },
        cold: () => COLD_OK,
      },
      { segments: MOTIONS_SEGMENTS, agendaList: MOTIONS_AGENDA, packetPages: MOTIONS_PACKET },
    );
    assert.match(prompts[0]!, /MOTIONS UNDER THIS ITEM[\s\S]*1\. [\s\S]*unanimous, at 00:05:30[\s\S]*2\. [\s\S]*5-2, at 00:10:30/, "the writer is given the motions in order, each with its own result");
  });

  it("cold-reads each paragraph against its own tape windows and drops a line that denies a found vote", async () => {
    /*
      Fix 4. Run 5's reader called real tape facts "absent from the excerpts"
      because it saw one item's first 40,000 characters, and it reported "no
      vote tally" for a motion the code had found. The check runs paragraph by
      paragraph against the windows that share the paragraph's words and the
      item's packet page, and a line that denies a vote the code found is
      dropped.
    */
    const budgetParagraph = "The proposed budget reflects NextLight expenses and a property tax shortfall.";
    const budgetSource = coldCheckParagraphSource({
      paragraph: budgetParagraph,
      item: null,
      segments: COLD2_SEGMENTS,
      packetPages: COLD2_PACKET,
      packetText: COLD2_PACKET.map((page) => page.text).join("\n"),
      maxWindowChars: 120,
    });
    assert.match(budgetSource, /the property tax shortfall is \$511,000/, "the paragraph's own tape window is retrieved");
    assert.ok(!budgetSource.includes("airport recommendation"), "and the windows it does not share words with are not");

    const prompts: string[] = [];
    const result = await run(
      {
        inventory: () => COLD2_INVENTORY,
        status: () => COLD2_STATUS,
        lead: () => JSON.stringify({ headline: "H", dek: "", lead: "The council adopted the airport recommendation unanimously." }),
        roundup: () => JSON.stringify({ paragraph: "The budget shortfall is $511,000." }),
        cold: (user) => {
          prompts.push(user);
          if (user.includes("ITEM: Airport noise rules")) {
            return JSON.stringify({ mismatches: ["the draft says no vote tally was recorded for the motion", "the draft gives a figure the packet does not hold"] });
          }
          return JSON.stringify({ mismatches: ["the draft says the hearing was Wednesday; the tape says Tuesday"] });
        },
      },
      { segments: COLD2_SEGMENTS, agendaList: COLD2_AGENDA, packetPages: COLD2_PACKET },
    );
    assert.equal(prompts.length, 2, "each paragraph is checked on its own");
    assert.ok(prompts[0]!.startsWith("ITEM: Airport noise rules\nEXCERPTS:"), "the lead paragraph is checked under the lead item's name");
    assert.match(prompts[0]!, /PARAGRAPH:\nThe council adopted the airport recommendation unanimously\./, "the paragraph itself is what is asked about");
    assert.match(prompts[0]!, /PACKET PAGES:\nAMS VOLUNTARY NOISE ABATEMENT/, "the item's packet page is handed over");
    assert.match(result.meetingNotes, /the draft gives a figure the packet does not hold/, "a real mismatch is kept");
    assert.match(result.meetingNotes, /the draft says the hearing was Wednesday; the tape says Tuesday/, "so is the other paragraph's");
    assert.ok(
      !result.meetingNotes.includes("no vote tally was recorded"),
      "a line that denies a vote the code found is dropped",
    );
    assert.match(result.meetingNotes, /COLD CHECK:/, "the surviving mismatches are reported to the editor");
  });
});
