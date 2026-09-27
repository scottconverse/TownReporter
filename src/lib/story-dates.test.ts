import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectStoryDates,
  hostOnly,
  storyDateRows,
  structuredDate,
  type StoryDateSource,
} from "./story-dates.ts";

/**
 * The panel's domain line, and the dates it hangs on.
 *
 * Unit BD3: "Dates in this story" printed a whole URL where the design prints a
 * domain, and the event text above it broke mid-word. `hostOnly` is the first
 * half of that fix; the second is CSS (`overflow-wrap: break-word` on
 * `.datewhat`, `anywhere` kept on `.datenote`) and is measured in a browser by
 * `scripts/paper-panels.mjs`.
 */
describe("hostOnly", () => {
  it("reduces a URL to its host, without www", () => {
    assert.equal(
      hostOnly("https://www.longmontcolorado.gov/agenda-1.pdf?rev=2#page=4"),
      "longmontcolorado.gov",
    );
    assert.equal(
      hostOnly("http://agendas.longmont.primegov.com/View.ashx?M=F&ID=1&GUID=abc"),
      "agendas.longmont.primegov.com",
    );
  });

  it("leaves a bare host, a name and junk exactly as they came", () => {
    assert.equal(hostOnly("longmont.primegov.com"), "longmont.primegov.com");
    assert.equal(hostOnly("Longmont City Council"), "Longmont City Council");
    assert.equal(hostOnly("  Boulder County  "), "Boulder County");
    assert.equal(hostOnly("not a url at all"), "not a url at all");
  });
});

describe("collectStoryDates notes", () => {
  it("prints the host for a URL-shaped organization and the name otherwise", () => {
    const items = collectStoryDates([
      {
        slug: "story-1",
        section: "council",
        records: [
          {
            title: "Council packet",
            organization: "https://www.longmontcolorado.gov/agenda-1.pdf",
            document_date: "2026-09-28",
          },
          {
            title: "Staff report",
            organization: "Longmont City Council",
            document_date: "2026-09-29",
          },
        ],
      },
    ]);
    assert.deepEqual(
      items.map((i) => i.note),
      ["longmontcolorado.gov", "Longmont City Council"],
    );
  });

  it("still drops a record with no usable date", () => {
    const items = collectStoryDates([
      {
        slug: "story-1",
        section: "council",
        records: [
          { title: "Undated", organization: "longmontcolorado.gov", document_date: "early Sept" },
        ],
      },
    ]);
    assert.deepEqual(items, []);
    assert.equal(structuredDate("2026-02-31"), "");
  });
});

/**
 * Unit BX: the dates a printed story's records actually carry.
 *
 * The live front page printed "No published story carries a date in the next
 * seven days" over a grid whose own stories named Oct. 1, Oct. 3 and Sept. 29.
 * The records were there; the reader only accepted a value that STARTED with an
 * ISO day. `document_date` is a free-form string (`report.ts` stores
 * `String(o.document_date ?? "")` and asks for no format), so these are the
 * shapes it arrives in.
 */
describe("structuredDate: days written out", () => {
  it("reads the forms a document bears", () => {
    assert.equal(structuredDate("2026-10-01"), "2026-10-01");
    assert.equal(structuredDate("2026-10-01T09:00:00-06:00"), "2026-10-01");
    assert.equal(structuredDate("10/1/2026"), "2026-10-01");
    assert.equal(structuredDate("October 1, 2026"), "2026-10-01");
    assert.equal(structuredDate("Oct. 1, 2026"), "2026-10-01");
    assert.equal(structuredDate("Thursday, October 1st, 2026"), "2026-10-01");
    assert.equal(structuredDate("1 October 2026"), "2026-10-01");
    assert.equal(structuredDate("Oct 1 26"), "2026-10-01");
    // A first number that cannot be a month is the day, not the month.
    assert.equal(structuredDate("17/10/2026"), "2026-10-17");
  });

  it("reads a day with no year against the reference day, and drops it without one", () => {
    assert.equal(structuredDate("Sept. 29", "2026-09-27"), "2026-09-29");
    assert.equal(structuredDate("10/1", "2026-09-27"), "2026-10-01");
    assert.equal(structuredDate("Sept. 29"), "");
  });

  it("still refuses a value that names no day, or no real day", () => {
    assert.equal(structuredDate("early Sept"), "");
    assert.equal(structuredDate("September 2026"), "");
    assert.equal(structuredDate("last week"), "");
    assert.equal(structuredDate("2026-02-31"), "");
    assert.equal(structuredDate("2026-11-31"), "");
    assert.equal(structuredDate("13/45/2026"), "");
  });

  it("prints the days printed stories name, inside the next seven days", () => {
    const items = collectStoryDates(
      [
        {
          slug: "hearing",
          section: "council",
          records: [
            {
              title: "Funding hearing packet",
              organization: "longmontcolorado.gov",
              document_date: "October 1, 2026",
            },
          ],
        },
        {
          slug: "event",
          section: "events",
          records: [
            { title: "Canvassing day", organization: "Example", document_date: "Oct. 3, 2026" },
          ],
        },
        {
          slug: "deadline",
          section: "council",
          records: [
            {
              title: "Applications close",
              organization: "longmontcolorado.gov",
              document_date: "Sept. 29",
            },
          ],
        },
        {
          slug: "later",
          section: "council",
          records: [
            { title: "Second reading", organization: "Example", document_date: "Oct. 6, 2026" },
          ],
        },
      ],
      { from: "2026-09-27", days: 7 },
    );
    // The second reading is on day nine and stays out; the other three are in.
    assert.deepEqual(
      items.map((i) => i.date),
      ["2026-09-29", "2026-10-01", "2026-10-03"],
    );
  });
});

/**
 * Unit BX2: the dates a printed story names in its own words.
 *
 * The live paper's twelve newest published articles carry no `document_date` at
 * all -- every record's value is `''` -- so the panel beside them stayed empty
 * while the stories named their own dates out loud. These are the five strings
 * the coordinator quoted off the live page, plus the three cases that keep the
 * reader honest: a date inside the story but outside the week, a date that
 * belongs to the coming year, and text that only looks like a date.
 */
describe("the story's own words (unit BX2)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  it("reads the dates the live stories name in their headlines and deks", () => {
    const items = collectStoryDates(
      [
        story({
          slug: "hiring",
          headline:
            "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
          published_on: "2026-09-27",
        }),
        story({
          slug: "ranked",
          headline:
            "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D",
          published_on: "2026-09-25",
        }),
        story({
          slug: "reading",
          dek: "The unanimous vote sends the plan to an Oct. 6 public hearing and second reading at the council.",
          published_on: "2026-09-25",
        }),
        story({
          slug: "packet",
          dek: "The board has posted an Oct. 1 funding hearing packet ahead of the meeting.",
          published_on: "2026-09-26",
        }),
        story({
          slug: "class",
          headline:
            "Longmont Public Media lists beginner DaVinci Resolve editing class for Sept. 29",
          published_on: "2026-09-27",
        }),
      ],
      // Ten days so the Oct. 6 second reading is inside the sweep; the Sept. 26
      // canvassing day is behind the window's first day either way.
      { from: "2026-09-27", days: 10 },
    );
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [
        // The 29th twice: two different printed stories name it.
        ["2026-09-29", "Applications Close"],
        [
          "2026-09-29",
          "Longmont Public Media lists beginner DaVinci Resolve editing class for Sept. 29",
        ],
        ["2026-10-01", "funding hearing packet"],
        ["2026-10-03", "Brighton event"],
        ["2026-10-06", "public hearing and second reading"],
      ],
    );
    // Every item links back to the story whose words printed it.
    assert.deepEqual(
      items.map((i) => i.slug),
      ["hiring", "class", "packet", "ranked", "reading"],
    );
  });

  it("gives the 26th its own line and its own day when the window is open", () => {
    // Sept. 26 is inside the story and outside the week the front page prints.
    const headline =
      "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D";
    const source = story({ slug: "ranked", headline, published_on: "2026-09-25" });
    assert.deepEqual(
      collectStoryDates([source], { from: "2026-09-27", days: 7 }).map((i) => i.date),
      ["2026-10-03"],
    );
    assert.deepEqual(
      collectStoryDates([source]).map((i) => [i.date, i.what]),
      [
        ["2026-09-26", "canvassing day"],
        ["2026-10-03", "Brighton event"],
      ],
    );
  });

  it("reads a year-less day against the story's own publish day", () => {
    // Filed in December, "Jan. 5" cannot mean the January eleven months gone.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "budget",
          headline: "Council sets the budget adoption vote for Jan. 5",
          published_on: "2026-12-15",
        }),
      ]).map((i) => [i.date, i.what]),
      // The words before the date are the line: the day rolls, the clause does not.
      [["2027-01-05", "Council sets the budget adoption vote"]],
    );
    // A day a month or two behind its story is still this year's.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "august",
          headline: "The council revisited its Aug. 1 decision",
          published_on: "2026-09-27",
        }),
      ]).map((i) => i.date),
      ["2026-08-01"],
    );
    // A written year is the date's own and is never rolled.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "written",
          headline: "Records for the Oct. 8, 2026 hearing are posted",
          published_on: "2026-12-15",
        }),
      ]).map((i) => [i.date, i.what]),
      [["2026-10-08", "hearing"]],
    );
  });

  it("reads no date out of words that only look like one", () => {
    const noise = [
      "Section 8 of the code covers the fee",
      "Prop 123 is on the ballot",
      "3C and 3D are the two questions",
      "The March 2026 packet is posted",
      "Mayor Ferrell said the plan may need 5 more weeks",
    ];
    for (const text of noise) {
      assert.deepEqual(
        collectStoryDates([story({ headline: text, published_on: "2026-09-27" })]),
        [],
        `read a date out of: ${text}`,
      );
    }
  });

  it("prints one day once for a story whose record and headline name it", () => {
    const items = collectStoryDates(
      [
        story({
          slug: "hearing",
          headline: "Council sets an Oct. 1 hearing on the rate study",
          dek: "The Oct. 1 hearing is the second of two readings.",
          published_on: "2026-09-27",
          records: [
            {
              title: "Funding hearing packet",
              organization: "longmontcolorado.gov",
              document_date: "2026-10-01",
            },
          ],
        }),
      ],
      { from: "2026-09-27", days: 7 },
    );
    // The record's own title is the better line, and it is printed alone.
    assert.deepEqual(
      items.map((i) => [i.date, i.what, i.note]),
      [["2026-10-01", "Funding hearing packet", "longmontcolorado.gov"]],
    );
  });

  it("links a row to its story, except on the page the story is printed on", () => {
    const items = collectStoryDates([
      story({
        slug: "reading",
        headline: "Council takes up the rate study",
        dek: "The vote sends the plan to an Oct. 6 public hearing and second reading.",
        published_on: "2026-09-27",
      }),
    ]);
    // The front page splits the day into the panel's two columns and links the
    // row back to the story whose words named it...
    assert.deepEqual(
      storyDateRows(items).map((r) => [r.dow, r.day, r.what, r.slug]),
      [["Tue", "6", "public hearing and second reading", "reading"]],
    );
    // ...and the article page, which IS that story, prints the same row plain.
    assert.deepEqual(
      storyDateRows(items, "reading").map((r) => [r.dow, r.day, r.slug]),
      [["Tue", "6", undefined]],
    );
  });
});
