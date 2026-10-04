import assert from "node:assert/strict";
import { test } from "node:test";
import { noEventVerdict, standingPageStamp } from "./lead-newsworthiness.ts";

/*
 * The cheap standing-page rules, checked against REAL headlines and URLs from
 * the editor's own 30-day lead export (run 66 and the published set), not
 * invented examples. Two things have to be true at once:
 *
 *   - the standing pages the scan kept filing (an obituaries index, a
 *     nonprofit projects index, a cafe's hours-and-events page) are stamped and
 *     dropped;
 *   - the news the editor actually published survives -- including leads whose
 *     titles read like listings ("... Lists Regular Hours"), because a bare
 *     "Lists" or "Hours" token is not proof of a page.
 *
 * Each assertion names the rule it is pinning (R1-R5). Deleting that rule from
 * lead-newsworthiness.ts fails its test: the stamp comes back null (or from a
 * different rule), so the `rule` check fails.
 */

test("R1: an obituaries index page is dropped (run 66, lead 419)", () => {
  const stamp = standingPageStamp({
    headline: "Longmont Leader Obituaries Page Lists Recent Death Notices, Including Patrick Joseph Travis",
    source_urls: ["https://www.longmontleader.com/obituaries"],
  });
  assert.equal(stamp?.rule, "R1");
  assert.match(stamp!.reason, /obituar/i);
});

test("R1: the obituaries URL alone stamps it, even with a neutral title", () => {
  const stamp = standingPageStamp({
    headline: "Deaths and services around Longmont",
    source_urls: ["https://www.longmontleader.com/obituaries"],
  });
  assert.equal(stamp?.rule, "R1");
});

test("R2/R3: a foundation projects index is dropped (run 66, lead 425)", () => {
  const stamp = standingPageStamp({
    headline: "Longmont Community Foundation Projects Index Lists Local Funds and Nonprofits",
    source_urls: [
      "https://longmontfoundation.org/projects/lcf-projects/",
      "https://longmontfoundation.org/projects/lcf-projects/feed/",
    ],
  });
  assert.ok(stamp, "a projects index is a standing page and must be stamped");
  assert.ok(stamp!.rule === "R2" || stamp!.rule === "R3", `unexpected rule ${stamp!.rule}`);
});

test("R2 alone: a directory page with an ordinary URL is stamped by the title", () => {
  // Lead 425 trips BOTH R2 (the word "Index") and R3 (the /projects/ URL), so
  // it cannot show that R2 works on its own. This fixture carries only the
  // page-noun title. The Longmont chamber keeps a business directory of this
  // shape; it is a page that exists, with no event.
  const stamp = standingPageStamp({
    headline: "Longmont Area Chamber of Commerce Business Directory",
    source_urls: ["https://www.longmontchamber.org/"],
  });
  assert.equal(stamp?.rule, "R2");
});

test("R3 alone: the projects index URL with an index-free title is stamped", () => {
  // The other half of lead 425: same real URLs, but a title that never says
  // "index" or "directory", so only R3's URL rule can catch it. This is what
  // makes R3's removal observable.
  const stamp = standingPageStamp({
    headline: "Longmont Community Foundation lists its local funds and nonprofits",
    source_urls: [
      "https://longmontfoundation.org/projects/lcf-projects/",
      "https://longmontfoundation.org/projects/lcf-projects/feed/",
    ],
  });
  assert.equal(stamp?.rule, "R3");
});

test("R3: a single project's page is NOT the index (published lead 286 stays)", () => {
  const stamp = standingPageStamp({
    headline: "Longmont Community Foundation lists Ascend St. Vrain scholarship for SVVSD and BOCES graduates",
    source_urls: [
      "https://longmontfoundation.org/project/ascend-scholarship-program/",
      "https://longmontfoundation.org/projects/lcf-projects/feed/",
    ],
  });
  assert.equal(stamp, null, "a /project/<slug> page is one project, not the projects index");
});

test("R4: an events listing with no dated event is dropped (run 66, lead 426)", () => {
  const stamp = standingPageStamp({
    headline: "Recovery Café Longmont Lists Weekday Hours and October Recovery Circles",
    source_urls: [
      "https://recoverycafelongmont.org/",
      "https://recoverycafelongmont.org/event/recovery-circle-301/",
      "https://recoverycafelongmont.org/event/yerba-mate-circle-94/",
    ],
  });
  assert.equal(stamp?.rule, "R4");
});

test("R4: the same event pages WITH a dated event survive (published lead 211 stays)", () => {
  const stamp = standingPageStamp({
    headline: "Recovery Café Longmont lists meditation, film and recovery-circle sessions for Sept. 25",
    source_urls: [
      "https://recoverycafelongmont.org/event/transcendent-meditation-44/",
      "https://recoverycafelongmont.org/event/inspirational-movie-4/",
      "https://recoverycafelongmont.org/event/recovery-circle-296/",
    ],
  });
  assert.equal(stamp, null, "a title with a dated event beats the listing pattern");
});

test("a bare 'Lists' or 'Hours' token is not enough: published listing-style leads stay", () => {
  // Published lead 364: two funds named, no event, no page artifact in the URL
  // path -- the editor published it, so the cheap layer must not drop it.
  assert.equal(
    standingPageStamp({
      headline: "Longmont Community Foundation Lists Two Local Funds: Gun Violence Reduction and HOPE Direct",
      source_urls: [
        "https://longmontfoundation.org/project/gun-violence-reduction/",
        "https://longmontfoundation.org/project/hope-direct/",
      ],
    }),
    null,
  );
  // Published lead 314: "... Lists Regular Hours and Shoutbomb Text Notification Signup".
  assert.equal(
    standingPageStamp({
      headline: "Longmont Public Library Lists Regular Hours and Shoutbomb Text Notification Signup",
      source_urls: [
        "https://longmontcolorado.gov/library/",
        "https://longmontcolorado.gov/library/access-my-library-account/",
      ],
    }),
    null,
  );
  // Published lead 362: the Salud clinic's hours page.
  assert.equal(
    standingPageStamp({
      headline:
        "Salud Family Health's Longmont Clinic Lists Extended Medical Hours and After-Hours Pharmacy Lockers",
      source_urls: ["https://www.saludclinic.org/longmont"],
    }),
    null,
  );
});

test("R5: the five routine meeting records a real dev scan filed are all dropped", () => {
  // Leads 437-439, 442 and 443 of the 2026-10-04 dev scan (REAL-SCAN-DEV-2.md §3,
  // "routine meeting records 5"). Each headline is a public body, a date and the
  // fact that a meeting is posted, set or scheduled -- an agenda, a session, a
  // hearing notice, a meeting notice. None says what was decided in it.
  const records = [
    "Planning and Zoning Commission 9/16/26",
    "Historic Preservation Commission - October 1, 2026",
    "Longmont Housing Board Opens Human Services Funding Hearings Oct. 15",
    "Longmont Council Regular Session Set for Oct. 6",
    "Planning and Zoning Commission Sets Oct. 21 Meeting",
  ];
  for (const headline of records) {
    const stamp = standingPageStamp({ headline, source_urls: [] });
    assert.equal(stamp?.rule, "R5", `record not dropped: ${headline}`);
    assert.match(stamp!.reason, /meeting/i);
  }
  // Qualifier words before the body are fine: still only a name and a date.
  assert.equal(
    standingPageStamp({ headline: "Longmont Urban Renewal Authority (LURA) Meeting, August 18, 2026" })?.rule,
    "R5",
  );
  // A clock time is the other way a notice says when: still only a record.
  assert.equal(standingPageStamp({ headline: "City Council meeting Oct. 6 at 7 p.m." })?.rule, "R5");
});

test("R5: a published meeting story survives while the same meeting's bare record drops", () => {
  // Published lead 221 says what happened -- the board cancelled a meeting --
  // beside the record (dev lead 439) that only says hearings are on.
  assert.equal(
    standingPageStamp({
      headline: "Human Services funding hearings set for Oct. 1 and Oct. 8; Oct. 8 regular board meeting cancelled",
      source_urls: [],
    }),
    null,
    "a cancelled meeting is news, not a record",
  );
  assert.equal(
    standingPageStamp({ headline: "Longmont Housing Board Opens Human Services Funding Hearings Oct. 15" })?.rule,
    "R5",
  );
});

test("R5: a published board story survives while the set-a-session record drops", () => {
  // Published lead 174: the board lists hearings "despite cancelling its regular
  // Oct. 8 meeting" -- a change. Dev lead 442 is the same body announcing a
  // session, which is not.
  assert.equal(
    standingPageStamp({
      headline:
        "Longmont’s housing and human-services board lists October funding hearings despite cancelling its regular Oct. 8 meeting",
      source_urls: [],
    }),
    null,
    "a change to a meeting is news, not a record",
  );
  assert.equal(
    standingPageStamp({ headline: "Longmont Council Regular Session Set for Oct. 6" })?.rule,
    "R5",
  );
});

test("R5: 'Council Chambers' is a venue, not a body holding a meeting", () => {
  // The dev scan filed this one as real news (lead 446, "real news (event)"),
  // and it is right to: the event is the screening, and the council only owns
  // the room. The same words with the record's shape (dev lead 443) are not.
  assert.equal(
    standingPageStamp({
      headline: "Free Screening of 'Join or Die' at Council Chambers Oct. 7",
      source_urls: [],
    }),
    null,
    "a venue named after a council is not a council meeting",
  );
  assert.equal(
    standingPageStamp({ headline: "Planning and Zoning Commission Sets Oct. 21 Meeting" })?.rule,
    "R5",
  );
});

test("R5: 'Pumpkins & Panels' is an event, not a board", () => {
  // The dev scan filed this one as real news too (lead 457, held, "New facts").
  // "Panels" here is hay-bale art, not a public body; the meeting notice beside
  // it is what drops.
  assert.equal(
    standingPageStamp({
      headline: "Jack’s Solar Garden Hosts 'Pumpkins & Panels' Halloween Event Oct. 24",
      source_urls: [],
    }),
    null,
    "an event's name is not a public body",
  );
  assert.equal(standingPageStamp({ headline: "Planning and Zoning Commission Sets Oct. 21 Meeting" })?.rule, "R5");
});

test("R5: a meeting record that says something is news and survives", () => {
  for (const headline of [
    "Board of Adjustment denies the variance for 350 Kimbark Street",
    "City Council Approves 2027 Budget",
    "Boulder County Commissioners Confirm $13.2M in 2027 Reductions and Oct. 22 Public Hearing",
    "Historic Preservation Commission meets Oct. 1, 2026; first item is approval of Sept. 3 minutes",
    // Published lead 65: the council's session is in the minutes backlog -- a
    // fact about the record, not the meeting.
    "Sept. 1 council session joins the minutes backlog; portal now shows no approved minutes since July 22",
  ]) {
    assert.equal(standingPageStamp({ headline, source_urls: [] }), null, `news was stamped: ${headline}`);
  }
});

test("R5: the meeting-capture transcript-story form is left to the model", () => {
  // Published leads 297 and 298 carry the parenthesized capture stamp written
  // by meeting-lead.ts `meetingLeadCopy`. That form means the desk holds an
  // aligned transcript, so the lead is a transcript-story, not a bare record.
  // Without the stamp, the same title is a bare record and must drop.
  for (const headline of [
    "City Council Regular Session - September 22, 2026 (2026-09-23)",
    "Arts in Public Places Commission - September 17, 2026 (2026-09-18)",
  ]) {
    assert.equal(standingPageStamp({ headline, source_urls: [] }), null, `transcript-story stamped: ${headline}`);
  }
  assert.equal(
    standingPageStamp({ headline: "City Council Regular Session - October 6, 2026" })?.rule,
    "R5",
    "the same title with no capture stamp is a bare record",
  );
});

test("real published news is never stamped (spot check across the published set)", () => {
  const published: { headline: string; source_urls: string[] }[] = [
    {
      headline: "Longmont Senior Center to offer free evening meals beginning Oct. 2",
      source_urls: ["https://longmontcolorado.gov/news/free-evening-meals-at-the-senior-center/"],
    },
    {
      headline: "City Council Regular Session - September 22, 2026 (2026-09-23)",
      source_urls: ["https://www.youtube.com/watch?v=zREvH6v072E"],
    },
    {
      headline: "U.S. Supreme Court to Hear Boulder County Climate Suit Oct. 5",
      source_urls: ["https://bouldercounty.gov/"],
    },
    {
      headline: "Longmont police respond to stabbing at Loomiller Park",
      source_urls: ["https://www.dailycamera.com/news/crime-public-safety/"],
    },
  ];
  for (const lead of published) {
    assert.equal(standingPageStamp(lead), null, `published lead was stamped: ${lead.headline}`);
  }
});

test("the model's own verdict drops only an explicit is_event: false", () => {
  assert.deepEqual(noEventVerdict({ is_event: false, event: "" })?.reason, "the scan read no news event");
  assert.match(noEventVerdict({ is_event: false, event: "the page lists the cafe's hours" })!.reason, /lists the cafe/);
  assert.equal(noEventVerdict({ is_event: true }), null);
  assert.equal(noEventVerdict({}), null, "an absent answer is not a verdict");
  assert.equal(noEventVerdict({ event: "council voted" }), null);
});
