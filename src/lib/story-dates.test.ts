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
