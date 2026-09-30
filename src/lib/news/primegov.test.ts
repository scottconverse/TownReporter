import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bestMeetingMatch,
  catalogAndExtras,
  compiledDocumentUrl,
  dateFromTitle,
  fetchPrimeGovMeetings,
  ingestPrimeGov,
  minutesGap,
  preferredDocuments,
  primeGovDocumentsForTitle,
  readPrimeGovPortal,
  sameMeetingTitle,
  scoreMeetingMatch,
  sharedBodyNames,
  type PrimeGovMeeting,
} from "./primegov.ts";
import { setFetchImplForTests } from "./fetch-url.ts";

/*
  ANOTHER CITY'S PORTAL, for the tests that actually reach the fetch.

  The fetch itself is injected, so no request leaves this process; the address
  is a literal because `assertPublicHttpUrl` resolves real hostnames and only a
  tenant that exists resolves, which would make a `.primegov.com` stand-in
  either a live lookup or a flake. The host RULE -- which watch-list source is
  a portal at all -- is tested directly, through `primeGovOriginFromSources`
  (./primegov-source.test.ts), where no socket is involved.
*/
const OTHER_CITY = "https://93.184.216.34";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/*
  U13: this fixture's title now carries a body name. The real row read
  "VIRTUAL - Neighborhood Meeting Notice - Avis Car Rental, 206 S. Main St",
  and the pair that used to match it was accepted on the `/206/` address bonus
  -- a bonus that only ever fired for this fixture, and that made a street
  number an identification. The body name is added so the pair still has a
  legitimate title token to agree on; it is fixture data, not a claim about the
  portal's row. A notice that names no body and no date is no longer joined to
  anything (see "refuses a notice with no body and no date").
*/
const avis: PrimeGovMeeting = {
  id: 3781,
  title: "VIRTUAL - Planning and Zoning Commission Neighborhood Meeting Notice - Avis Car Rental, 206 S. Main St",
  date: "Aug 27, 2026",
  dateTime: "2026-08-27T18:00:00",
  time: "06:00 PM",
  location: "",
  documentList: [
    {
      id: 18556,
      templateId: 17162,
      compileOutputType: 1,
      templateName: "Agenda",
      link: null,
    },
  ],
};

const council: PrimeGovMeeting = {
  id: 3700,
  title: "City Council Regular Session",
  date: "Aug 25, 2026",
  dateTime: "2026-08-25T19:00:00",
  time: "07:00 PM",
  location: "Chambers",
  documentList: [
    { id: 1, templateId: 16373, compileOutputType: 3, templateName: "HTML Agenda", link: null },
    { id: 2, templateId: 16373, compileOutputType: 1, templateName: "Agenda", link: null },
    { id: 3, templateId: 16375, compileOutputType: 1, templateName: "Packet", link: null },
  ],
};

/** The same night as the council session, a different body. */
const historic: PrimeGovMeeting = {
  id: 3701,
  title: "Historic Preservation Commission",
  date: "Aug 25, 2026",
  dateTime: "2026-08-25T17:00:00",
  time: "05:00 PM",
  location: "",
  documentList: [{ id: 4, templateId: 9, compileOutputType: 1, templateName: "Agenda", link: null }],
};

describe("PrimeGov document URLs", () => {
  it("uses templateId on CompiledDocument, not the row id", () => {
    const href = compiledDocumentUrl("https://longmont.primegov.com", avis.documentList[0]!);
    assert.equal(
      href,
      "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=17162&compileOutputType=1",
    );
  });

  it("prefers packet and minutes over HTML agenda", () => {
    const names = preferredDocuments(council).map((d) => d.templateName);
    assert.equal(names[0], "Packet");
    assert.ok(!names.includes("HTML Agenda") || names.indexOf("Packet") < names.indexOf("HTML Agenda"));
  });
});

describe("meeting match", () => {
  it("parses YouTube-style dates", () => {
    assert.equal(dateFromTitle("City Council Regular Session - 08/25/2026"), "2026-08-25");
    assert.equal(dateFromTitle("Aug 27, 2026"), "2026-08-27");
  });

  it("joins council session by date and title", () => {
    const hit = bestMeetingMatch("City Council Regular Session - 08/25/2026", [avis, council]);
    assert.equal(hit?.id, 3700);
    assert.ok(scoreMeetingMatch("City Council Regular Session - 08/25/2026", council) >= 40);
  });

  it("joins a neighborhood meeting notice by its date and body name", () => {
    const title = "Planning and Zoning Commission Neighborhood Meeting - 08/27/2026";
    assert.equal(bestMeetingMatch(title, [avis, council])?.id, 3781);
    assert.equal(sameMeetingTitle(title, avis), true);
    assert.deepEqual(sharedBodyNames(title, avis), ["commission", "planning", "zoning"]);
  });

  it("refuses a notice with no body and no date, however much of it matches", () => {
    // The pair the `/206/` bonus used to accept: the address is in both titles
    // and nothing else identifies the meeting.
    const title = "206 S. Main Street Neighborhood Meeting";
    assert.deepEqual(sharedBodyNames(title, avis), []);
    assert.equal(sameMeetingTitle(title, avis), false);
    assert.equal(bestMeetingMatch(title, [avis, council]), null);
  });

  it("refuses a date alone, even against the same night's other body", () => {
    // "Historic Preservation Commission" and "City Council Regular Session" are
    // both on Aug 25, 2026. A date coincidence used to be worth 40 points, and
    // 40 was the floor, so this attached the wrong agenda.
    const hit = bestMeetingMatch("Historic Preservation Commission - 08/25/2026", [council]);
    assert.equal(hit, null);
    assert.equal(scoreMeetingMatch("Historic Preservation Commission - 08/25/2026", council), 0);
    assert.equal(sameMeetingTitle("Historic Preservation Commission - 08/25/2026", council), false);
  });

  it("refuses a shared body name whose dates disagree", () => {
    assert.equal(sameMeetingTitle("City Council Regular Session - 09/08/2026", council), false);
    assert.equal(bestMeetingMatch("City Council Regular Session - 09/08/2026", [council, historic]), null);
  });

  it("accepts a date and a body name together", () => {
    const hit = bestMeetingMatch("City Council Regular Session - 08/25/2026", [council, historic]);
    assert.equal(hit?.id, 3700);
    const commission = bestMeetingMatch("Historic Preservation Commission - 08/25/2026", [council, historic]);
    assert.equal(commission?.id, 3701);
  });

  it("refuses a title with no date at all", () => {
    assert.equal(sameMeetingTitle("City Council Regular Session", council), false);
    assert.equal(sameMeetingTitle("Planning and Zoning Commission", historic), false);
  });
});

describe("the catalog", () => {
  it("lists meetings and emits packet extras", () => {
    const { text, extras } = catalogAndExtras("https://longmont.primegov.com", [avis, council]);
    assert.match(text, /206 S\. Main/);
    assert.match(text, /City Council Regular Session/);
    assert.ok(extras.some((u) => u.includes("16375") || u.includes("17162")));
  });

  it("notes when council minutes have not been posted", () => {
    const old = { ...council, dateTime: "2026-08-20T19:00:00", date: "Aug 20, 2026" };
    const gap = minutesGap(old, new Date("2026-08-26T20:00:00Z"));
    assert.equal(gap, "minutes not posted");
    const withMinutes = {
      ...old,
      documentList: [
        ...old.documentList,
        { id: 9, templateId: 1, compileOutputType: 1, templateName: "Minutes", link: null },
      ],
    };
    assert.equal(minutesGap(withMinutes, new Date("2026-08-26T20:00:00Z")), null);
  });

  it("says the catalog is partial when one of the two lists could not be read", () => {
    const { text } = catalogAndExtras("https://city.primegov.com", [council], "archived: the portal answered 503");
    assert.match(text, /PARTIAL/);
    assert.match(text, /archived: the portal answered 503/);
    const whole = catalogAndExtras("https://city.primegov.com", [council]).text;
    assert.doesNotMatch(whole, /PARTIAL/);
  });
});

describe("reading a portal", () => {
  it("queries the portal it was given, and never Longmont's", async () => {
    const asked: string[] = [];
    setFetchImplForTests(async (url) => {
      asked.push(url.toString());
      return jsonResponse([]);
    });
    try {
      await primeGovDocumentsForTitle("City Council Regular Session - 08/25/2026", OTHER_CITY);
    } finally {
      setFetchImplForTests(null);
    }
    assert.equal(asked.length, 2);
    assert.ok(asked.every((u) => u.startsWith(`${OTHER_CITY}/api/v2/PublicPortal/`)));
    assert.ok(asked.every((u) => !/primegov\.com/i.test(u)), "no other city's portal is contacted");
  });

  it("returns the documents for the matching meeting, from the configured origin", async () => {
    setFetchImplForTests(async (url) =>
      jsonResponse(url.toString().includes("ListUpcomingMeetings") ? [council] : []),
    );
    try {
      const hit = await primeGovDocumentsForTitle("City Council Regular Session - 08/25/2026", OTHER_CITY);
      assert.equal(hit?.meeting.id, 3700);
      assert.ok(hit!.urls.every((u) => u.startsWith(OTHER_CITY)));
      assert.equal(await primeGovDocumentsForTitle("City Council Regular Session - 09/08/2026", OTHER_CITY), null);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("fails the read, with the portal's own reason, when both calls fail", async () => {
    setFetchImplForTests(async () => new Response("upstream is down", { status: 503 }));
    try {
      const read = await readPrimeGovPortal(OTHER_CITY);
      assert.equal(read.ok, false);
      assert.equal(read.status, 503);
      assert.match(read.failure ?? "", /503/);
      assert.deepEqual(read.meetings, []);
      await assert.rejects(() => fetchPrimeGovMeetings(OTHER_CITY), /503/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("reports a timeout as a timeout, not as an empty portal", async () => {
    setFetchImplForTests(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    try {
      const read = await readPrimeGovPortal(OTHER_CITY);
      assert.equal(read.ok, false);
      assert.match(read.failure ?? "", /timed out/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("keeps the list that answered when only one call fails", async () => {
    setFetchImplForTests(async (url) =>
      url.toString().includes("ListUpcomingMeetings")
        ? jsonResponse([council])
        : new Response("no", { status: 500 }),
    );
    try {
      const read = await readPrimeGovPortal(OTHER_CITY);
      assert.equal(read.ok, true);
      assert.equal(read.meetings.length, 1);
      assert.equal(read.meetings[0]?.id, 3700);
      assert.equal(read.status, 500);
      assert.match(read.failure ?? "", /archived/);
      assert.match(read.failure ?? "", /500/);
    } finally {
      setFetchImplForTests(null);
    }
  });

  it("names the portal it read in the title, not a city", async () => {
    // The title used to be the constant "Longmont agendas, packets, and
    // minutes (PrimeGov)" whatever portal answered. Longmont's host is used
    // here only because `ingestPrimeGov` is entered by a PrimeGov URL and the
    // host has to resolve; the fetch is still injected.
    setFetchImplForTests(async () => jsonResponse([]));
    try {
      const pg = await ingestPrimeGov(new URL("https://longmont.primegov.com/public/portal"));
      assert.equal(pg?.title, "longmont.primegov.com agendas, packets, and minutes (PrimeGov)");
      assert.doesNotMatch(pg!.title, /Longmont agendas/);
      assert.match(pg!.text, /PrimeGov portal https:\/\/longmont\.primegov\.com\/public\/portal/);
    } finally {
      setFetchImplForTests(null);
    }
  });
});
