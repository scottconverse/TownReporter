import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDate, formatDateTime, formatShortDate, slugify } from "./paper.ts";
import { APP_VERSION } from "./version.ts";

describe("Longmont dates", () => {
  it("prints the masthead in America/Denver, not UTC", () => {
    // 8:10pm Wednesday MDT is already Thursday in UTC.
    assert.equal(formatDate("2026-08-27T02:10:00.000Z"), "Wednesday, August 26, 2026");
  });

  it("keeps short dates and datetimes on Mountain Time", () => {
    assert.equal(formatShortDate("2026-08-27T02:10:00.000Z"), "Aug 26, 2026");
    assert.match(formatDateTime("2026-08-27T02:10:00.000Z"), /Aug 26, 2026, 8:10 PM/);
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
