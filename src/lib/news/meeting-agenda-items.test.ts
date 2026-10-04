import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { packetAgendaFromPages, packetAgendaFromText } from "./meeting-agenda-items.ts";

/**
 * WR1 fix list 2, fix 1: the agenda comes from the packet's own agenda pages.
 *
 * The writer used to group the ledger with `meeting_agenda_chunks`, which only
 * knows whole-number items, and `packetItemsFromAgendaText` could not read the
 * real packet either -- it wants the number and the title on ONE line, and the
 * Sept. 29, 2026 Longmont packet prints them on separate lines with lettered
 * sub-items ("6A"). The airport noise-abatement presentation, the meeting's
 * main news and the item holding its three unanimous votes, has no whole-number
 * id of its own, so the writer filed it inside "1. MEETING CALLED TO ORDER"
 * (whose chunk covers 8424.8-14720.96 s) and excluded it as routine procedure.
 *
 * The fixture is the real text, copied verbatim from the packet extraction of
 * that meeting (`packet-sept29.txt`, pages 1-2), including the running footer
 * that appears on both pages. Nothing here would fail against the old parser
 * by accident: it sees exactly three items ("2. ROLL CALL..." has no title on
 * its line at all) and none of the sub-items.
 */

/** Page 1 of the real packet, verbatim. */
const PAGE_1 = `
PACKET
City Council Study Session
September 29, 2026, 7:00 PM
City Council Chambers, 350 Kimbark St., Longmont, CO

If you need special assistance in order to participate in this meeting, please contact the City Clerk’s
Office at 303-651-8649 in advance of the meeting to make arrangements.
1.
MEETING CALLED TO ORDER
The Longmont City Council meets in person for two regular session meetings and
one study session meeting each month.
Regular and study session meetings are live-streamed and can be watched at:
•
The City’s Agenda Management Portal webpage
at
https://www.longmontcolorado.gov/online-services/agendas-and-
minutes/agenda-management-portal

•
The City’s YouTube channel at
https://Bit.Ly/Longmontyoutubelive

All City Council meetings are open to the public.
Anyone wishing to speak during Public Invited To Be Heard must sign up prior to
the meeting. Each speaker will have three minutes and must state their name and
address for the record.
2.
ROLL CALL AND PLEDGE OF ALLEGIANCE

City Council Study Session, September 29, 2026
Page 1
`;

/** Page 2 of the real packet, verbatim. */
const PAGE_2 = `
3.
MOTIONS TO DIRECT THE CITY MANAGER TO ADD AGENDA ITEMS TO FUTURE
AGENDAS
4.
PUBLIC INVITED TO BE HEARD (3 minute limitation per speaker)
5.
SPECIAL REPORTS AND PRESENTATIONS
A.
A Proclamation Designating October 4, 2026, As "Electrify Longmont Day" In
Longmont, Colorado.
6.
STUDY SESSION ITEMS
A.
Presentation Of Options To Implement The Airport Monitoring Systems (AMS)
Voluntary Noise Abatement Procedures (VNAP) Recommendations For Vance
Brand Municipal Airport
B.
2027 Proposed Budget Presentation
And
First Public Hearing On The 2027 Proposed Budget And The Proposed 2027-2031
Capital Improvement Program
7.
MAYOR AND COUNCIL COMMENTS
8.
CITY MANAGER REMARKS
9.
CITY ATTORNEY REMARKS
10.
ADJOURN
City Council Contingency Fund: $91,569
To view upcoming meeting dates and agendas, please visit:
https://www.longmontcolorado.gov/agendas

City Council Study Session, September 29, 2026
Page 2
`;

/** Page 3 is the appendix; nothing after it is an agenda item. */
const PAGE_3 = `
Appendix of Informational Items
1.
City Council Calendar Of Upcoming Meetings And Events

City Council Study Session, September 29, 2026
Page 3
`;

const PAGES = [
  { page: 1, text: PAGE_1 },
  { page: 2, text: PAGE_2 },
  { page: 3, text: PAGE_3 },
];

const AIRPORT_TITLE =
  "Presentation Of Options To Implement The Airport Monitoring Systems (AMS) Voluntary Noise Abatement Procedures (VNAP) Recommendations For Vance Brand Municipal Airport";

describe("the packet's agenda pages become the full item list", () => {
  it("reads the 13 ids of the real Sept. 29 agenda, sub-items included", () => {
    const items = packetAgendaFromPages(PAGES);
    assert.deepEqual(
      items.map((item) => item.itemNumber),
      ["1", "2", "3", "4", "5", "5A", "6", "6A", "6B", "7", "8", "9", "10"],
    );
  });

  it("joins a split number and title, and keeps the sub-items' own titles", () => {
    const items = packetAgendaFromPages(PAGES);
    const byId = new Map(items.map((item) => [item.itemNumber, item.title]));
    assert.equal(byId.get("1"), "MEETING CALLED TO ORDER");
    assert.equal(byId.get("2"), "ROLL CALL AND PLEDGE OF ALLEGIANCE");
    assert.equal(byId.get("3"), "MOTIONS TO DIRECT THE CITY MANAGER TO ADD AGENDA ITEMS TO FUTURE AGENDAS");
    assert.equal(byId.get("4"), "PUBLIC INVITED TO BE HEARD (3 minute limitation per speaker)");
    assert.equal(byId.get("5"), "SPECIAL REPORTS AND PRESENTATIONS");
    assert.equal(
      byId.get("5A"),
      'A Proclamation Designating October 4, 2026, As "Electrify Longmont Day" In Longmont, Colorado.',
    );
    assert.equal(byId.get("6"), "STUDY SESSION ITEMS");
    assert.equal(byId.get("6A"), AIRPORT_TITLE);
    assert.equal(
      byId.get("6B"),
      "2027 Proposed Budget Presentation And First Public Hearing On The 2027 Proposed Budget And The Proposed 2027-2031 Capital Improvement Program",
    );
    assert.equal(byId.get("10"), "ADJOURN");
  });

  it("drops the running footer and stops at the appendix", () => {
    const items = packetAgendaFromPages(PAGES);
    for (const item of items) {
      assert.doesNotMatch(item.title, /City Council Study Session/);
      assert.doesNotMatch(item.title, /Contingency Fund/);
      assert.doesNotMatch(item.title, /Appendix/);
    }
    assert.ok(!items.some((item) => item.title.includes("Calendar")));
  });

  it("still reads an agenda printed as one number-and-title line", () => {
    const items = packetAgendaFromText("1. MEETING CALLED TO ORDER\n2. ROLL CALL AND PLEDGE OF ALLEGIANCE\n");
    assert.deepEqual(items, [
      { itemNumber: "1", title: "MEETING CALLED TO ORDER" },
      { itemNumber: "2", title: "ROLL CALL AND PLEDGE OF ALLEGIANCE" },
    ]);
  });
});
