import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLD_CHECK_SYSTEM,
  INVENTORY_SYSTEM,
  LEAD_WRITE_SYSTEM,
  LEDGER_STATUS_SYSTEM,
  ROUNDUP_HEADING,
  ROUNDUP_WRITE_SYSTEM,
  assembleStory,
  editorNamesOneAgendaItem,
  runWholeMeetingWriter,
  usesWholeMeetingWriter,
  type MeetingSegment,
  type PacketPage,
  type LedgerItem,
  type WholeMeetingChat,
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

const COLD_OK = JSON.stringify({ mismatches: [] });

function run(
  handlers: Parameters<typeof fakeChat>[0],
  over: { segments?: MeetingSegment[]; votes?: Parameters<typeof runWholeMeetingWriter>[0]["votes"] } = {},
) {
  return runWholeMeetingWriter({
    meeting: { title: "City Council Study Session", date: "2026-09-29", videoUrl: "https://youtu.be/example" },
    segments: over.segments ?? SEGMENTS,
    packetPages: PACKET,
    votes: over.votes ?? [],
    chat: fakeChat(handlers),
  });
}

describe("whole-meeting writer", () => {
  it("keeps every inventory item and gives each one a status", async () => {
    /*
      The ledger is the whole point of WR1: every item the meeting covered is a
      row, and every row has an editorial status. An item the status pass never
      names is still in the ledger -- defaulted to excluded with a reason -- so
      an omission is a decision the editor can read, not a silent loss.
    */
    const result = await run({
      inventory: () => INVENTORY_OK,
      status: () => STATUS_OK,
      lead: () => JSON.stringify({ headline: "Airport noise policy set", dek: "One line.", lead: "The council set a noise policy." }),
      roundup: () => JSON.stringify({ paragraph: "The airport fund budget was discussed." }),
      cold: () => COLD_OK,
    });
    assert.equal(result.ledger.length, 2, "both inventory items must be in the ledger");
    assert.deepEqual(result.ledger.map((item) => item.itemNo), [1, 2], "items must be numbered in order");
    for (const item of result.ledger) {
      assert.ok(
        ["lead", "roundup", "excluded", "unread"].includes(item.status),
        `every ledger item needs a status, got ${item.status}`,
      );
      assert.ok(item.reason.length > 0, "every status carries a reason");
    }
    assert.equal(result.ledger[0]!.status, "lead");
    assert.equal(result.ledger[1]!.status, "roundup");
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
});
