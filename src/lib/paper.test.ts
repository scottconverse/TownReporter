import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatClockTime, formatDate, formatDateTime, formatShortDate, slugify } from "./paper.ts";
import { APP_VERSION } from "./version.ts";

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
    assert.equal(formatDateTime("2026-08-27T02:10:00.000Z"), "Aug 26, 2026, 8:10 p.m.");
    assert.equal(formatClockTime("2026-08-27T02:10:00.000Z"), "8:10 p.m.");
    // Midnight and noon are the two the 12-hour clock gets wrong by one.
    assert.equal(formatClockTime("2026-08-27T06:00:00.000Z"), "12:00 a.m.");
    assert.equal(formatClockTime("2026-08-27T18:00:00.000Z"), "12:00 p.m.");
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
