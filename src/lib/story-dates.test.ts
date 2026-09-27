import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectStoryDates, hostOnly, structuredDate } from "./story-dates.ts";

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
