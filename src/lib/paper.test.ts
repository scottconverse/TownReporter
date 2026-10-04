import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatClockTime,
  formatDate,
  formatDateTime,
  formatListDate,
  formatListDateTime,
  formatShortDate,
  slugify,
} from "./paper.ts";
import { APP_VERSION } from "./version.ts";

/** The year on the paper's own clock -- the one `formatListDate` compares to. */
const CURRENT_YEAR = Number(
  new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "America/Denver" }).format(new Date()),
);

describe("Longmont dates", () => {
  it("prints the masthead in America/Denver, not UTC", () => {
    // 8:10pm Wednesday MDT is already Thursday in UTC.
    assert.equal(formatDate("2026-08-27T02:10:00.000Z"), "Wednesday, August 26, 2026");
  });

  it("keeps short dates and datetimes on Mountain Time", () => {
    assert.equal(formatShortDate("2026-08-27T02:10:00.000Z"), "Aug 26, 2026");
    /*
      UI1b-5: "8:10 p.m.", not "8:10 PM". The desk's clock face is lower case
      with periods (README §7 -- "6 p.m." on the paper, "8:14 a.m." on the
      desk), and this pin used to encode `toLocaleString`'s upper-case
      `en-US` form. See `formatClockTime` in ./paper.ts.
    */
    assert.equal(formatClockTime("2026-08-27T02:10:00.000Z"), "8:10 p.m.");
    // Midnight and noon are the two the 12-hour clock gets wrong by one.
    assert.equal(formatClockTime("2026-08-27T06:00:00.000Z"), "12:00 a.m.");
    assert.equal(formatClockTime("2026-08-27T18:00:00.000Z"), "12:00 p.m.");
  });
});

/*
  UI1b-6. The designer: "Dates in lists read 'Oct. 2, 6:43 a.m.', never ISO."
  The style has three rules and each is asserted on its own, so one of them
  drifting cannot hide behind the other two.
*/
describe("the designer's list dates", () => {
  const at = (month: number, year = CURRENT_YEAR) =>
    `${year}-${String(month).padStart(2, "0")}-15T18:00:00.000Z`;

  it("abbreviates the months AP style, and spells out the short ones", () => {
    assert.equal(formatListDate(at(1)), "Jan. 15");
    assert.equal(formatListDate(at(2)), "Feb. 15");
    assert.equal(formatListDate(at(3)), "March 15", "March is spelled out, not 'Mar.'");
    assert.equal(formatListDate(at(4)), "April 15");
    assert.equal(formatListDate(at(5)), "May 15");
    assert.equal(formatListDate(at(6)), "June 15");
    assert.equal(formatListDate(at(7)), "July 15");
    assert.equal(formatListDate(at(8)), "Aug. 15");
    assert.equal(formatListDate(at(9)), "Sept. 15", "September is 'Sept.', never 'Sep'");
    assert.equal(formatListDate(at(10)), "Oct. 15");
    assert.equal(formatListDate(at(11)), "Nov. 15");
    assert.equal(formatListDate(at(12)), "Dec. 15");
  });

  it("drops the year in the current year and keeps it on any other", () => {
    assert.equal(formatListDate(at(10)), "Oct. 15");
    assert.equal(formatListDate(at(10, CURRENT_YEAR - 1)), `Oct. 15, ${CURRENT_YEAR - 1}`);
    assert.equal(formatListDate("2019-03-05T19:00:00.000Z"), "March 5, 2019");
  });

  it("is the date half of the desk's LIST date-time, with the desk's clock", () => {
    assert.equal(formatListDateTime(at(10)), "Oct. 15, 12:00 p.m.");
    assert.equal(formatListDateTime(at(10, 2019)), "Oct. 15, 2019, 12:00 p.m.");
    // The designer's own example, on the paper's clock: 12:43 UTC is 6:43 a.m. MDT.
    assert.equal(formatListDateTime(`${CURRENT_YEAR}-10-02T12:43:00.000Z`), "Oct. 2, 6:43 a.m.");
  });

  it("is never ISO, on any day of the year", () => {
    for (let month = 1; month <= 12; month += 1) {
      const drawn = formatListDateTime(at(month));
      assert.doesNotMatch(drawn, /\d{4}-\d{2}-\d{2}/, `${drawn} is an ISO string`);
      assert.match(drawn, /^[A-Z][a-z]+\.? \d{1,2}, \d{1,2}:\d{2} [ap]\.m\.$/, drawn);
    }
  });
});

/*
  UI1b-8. THE YEAR BELONGS ON AN EVIDENCE RECORD.

  UI1b-6 pushed the designer's list face ("Oct. 2, 6:43 a.m.", year dropped in
  the current year) through `formatDateTime` itself. But `formatDateTime` is
  not a desk-list formatter: the provenance block, `/evidence/$versionId` and
  `/evidence/compare` print capture and observation times, which are immutable
  archival facts. "Oct. 2" with no year on a captured record is ambiguous the
  moment the desk has been running for a year -- a reader cannot tell this
  year's capture from last year's. So the full date comes back and the list
  face moves to its own function.
*/
describe("the full date-time keeps its year", () => {
  const at = (month: number, year = CURRENT_YEAR) =>
    `${year}-${String(month).padStart(2, "0")}-15T18:00:00.000Z`;

  it("prints the year on a CURRENT-YEAR instant, which the list face drops", () => {
    assert.equal(
      formatDateTime(at(10)),
      `Oct 15, ${CURRENT_YEAR}, 12:00 p.m.`,
      "an archival capture time must carry its year even in the current year",
    );
    assert.equal(formatListDateTime(at(10)), "Oct. 15, 12:00 p.m.", "the list row still drops it");
  });

  it("is the old full date plus the desk's p.m. clock face", () => {
    assert.equal(formatDateTime(at(10, 2019)), "Oct 15, 2019, 12:00 p.m.");
    // The same instant the list face renders as "Oct 2, 6:43 a.m." keeps its year.
    assert.equal(formatDateTime(`${CURRENT_YEAR}-10-02T12:43:00.000Z`), `Oct 2, ${CURRENT_YEAR}, 6:43 a.m.`);
  });

});

describe("version", () => {
  it("matches package.json so the chrome and the tag cannot drift", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    assert.equal(APP_VERSION, pkg.version);
  });
});

describe("slugify length cut", () => {
  it("does not end a slug on a severed word", () => {
    const slug = slugify(
      "San Lazaro residents have until December to match a $42.5 million offer. Their public fundraiser has $8,600.",
    );
    assert.equal(slug.endsWith("-t"), false);
    assert.ok(slug.length <= 72);
    assert.match(slug, /^san-lazaro-residents/);
  });

  it("leaves a short headline exactly as it is", () => {
    assert.equal(slugify("Council raises the water rate"), "council-raises-the-water-rate");
  });

  it("keeps a short real word when the headline was not cut", () => {
    // Well under the limit, so nothing is dropped even though it ends short.
    assert.equal(slugify("City drops the tax"), "city-drops-the-tax");
  });

  it("never returns empty", () => {
    assert.equal(slugify("!!!"), "item");
  });
});
