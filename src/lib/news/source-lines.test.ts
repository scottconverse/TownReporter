import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSourceLines } from "./source-lines.ts";

/**
 * The bulk "add sources" box. Tier matters editorially, not cosmetically: it is
 * what tells the model an official record may support publication while a
 * newspaper story is only a lead to be corroborated. Getting the header wrong
 * silently files a competitor's reporting as publication-grade evidence, so
 * these cases are worth pinning down.
 */
describe("parseSourceLines — tier headers", () => {
  it("applies a TIER header to every URL beneath it", () => {
    const rows = parseSourceLines(`
TIER B
https://www.timescall.com/
https://www.dailycamera.com/
https://coloradosun.com/
`);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.tier === "B"), JSON.stringify(rows.map((r) => r.tier)));
  });

  it("switches tier when a new header appears", () => {
    const rows = parseSourceLines(`
TIER B
https://www.timescall.com/
TIER A
https://www.longmontcolorado.gov/
TIER C
https://www.reddit.com/r/Longmont/
`);
    assert.deepEqual(
      rows.map((r) => [r.tier, new URL(r.url).hostname]),
      [
        ["B", "www.timescall.com"],
        ["A", "www.longmontcolorado.gov"],
        ["C", "www.reddit.com"],
      ],
    );
  });

  it("defaults to Tier A when no header is given — the wrong default for news", () => {
    const rows = parseSourceLines("https://www.timescall.com/");
    assert.equal(rows[0]?.tier, "A");
  });

  it("accepts lower case and mixed case headers", () => {
    for (const header of ["tier b", "Tier B", "TIER B", "TierB"]) {
      const rows = parseSourceLines(`${header}\nhttps://www.timescall.com/`);
      assert.equal(rows[0]?.tier, "B", `header "${header}" should set Tier B`);
    }
  });

  it("allows a note after the header letter", () => {
    const rows = parseSourceLines("TIER B — local news outlets\nhttps://www.timescall.com/");
    assert.equal(rows[0]?.tier, "B");
  });

  it("does NOT treat a line containing a URL as a header", () => {
    // Otherwise "TIER B https://..." would set the tier and drop the URL.
    const rows = parseSourceLines("TIER B https://www.timescall.com/");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tier, "B");
  });

  it("sets kind from the tier, so news is not filed as official", () => {
    const rows = parseSourceLines("TIER B\nhttps://www.timescall.com/\nTIER A\nhttps://example.gov/");
    assert.equal(rows[0]?.kind, "news");
    assert.equal(rows[1]?.kind, "official");
  });

  it("always calls YouTube youtube, whatever the tier", () => {
    const rows = parseSourceLines("TIER B\nhttps://www.youtube.com/@LongmontPublicMedia");
    assert.equal(rows[0]?.kind, "youtube");
  });
});

describe("parseSourceLines — titles and tidying", () => {
  it("takes a title from text beside the URL", () => {
    const rows = parseSourceLines("TIER B\nLongmont Times-Call | https://www.timescall.com/");
    assert.equal(rows[0]?.title, "Longmont Times-Call");
  });

  it("falls back to the hostname when there is no title", () => {
    const rows = parseSourceLines("https://www.timescall.com/");
    assert.equal(rows[0]?.title, "www.timescall.com");
  });

  it("strips list bullets and numbering", () => {
    const rows = parseSourceLines("TIER B\n- Times-Call https://www.timescall.com/\n2. Camera https://www.dailycamera.com/");
    assert.equal(rows[0]?.title, "Times-Call");
    assert.equal(rows[1]?.title, "Camera");
  });

  it("ignores blank lines and # comments", () => {
    const rows = parseSourceLines("# dailies\n\nTIER B\n\nhttps://www.timescall.com/\n\n# weeklies\n");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tier, "B");
  });

  it("drops a duplicate URL within one paste", () => {
    const rows = parseSourceLines("TIER B\nhttps://www.timescall.com/\nhttps://www.timescall.com/");
    assert.equal(rows.length, 1);
  });

  it("does NOT collapse trailing-slash or www variants — they stay separate", () => {
    const rows = parseSourceLines("TIER B\nhttps://timescall.com\nhttps://www.timescall.com/");
    assert.equal(rows.length, 2, "near-duplicates are not merged; check the list after a bulk add");
  });

  it("accepts a bare hostname and adds https://", () => {
    const rows = parseSourceLines("TIER B\ntimescall.com");
    assert.equal(rows.length, 1, "a pasted domain without a scheme must still register");
    assert.equal(rows[0]?.url, "https://timescall.com/");
    assert.equal(rows[0]?.tier, "B");
  });

  it("accepts a bare hostname with a path", () => {
    const rows = parseSourceLines("TIER B\nwww.dailycamera.com/news");
    assert.equal(rows[0]?.url, "https://www.dailycamera.com/news");
  });

  it("accepts a bare hostname beside a title", () => {
    const rows = parseSourceLines("TIER B\nColorado Sun | coloradosun.com");
    assert.equal(rows[0]?.url, "https://coloradosun.com/");
    assert.equal(rows[0]?.title, "Colorado Sun");
  });

  it("does NOT turn ordinary prose into a source", () => {
    for (const line of ["see page 4.Section two", "a sentence. Another sentence", "TBD", "no sources yet"]) {
      assert.equal(parseSourceLines(line).length, 0, `"${line}" should not parse as a URL`);
    }
  });

  it("trims trailing punctuation off a pasted URL", () => {
    const rows = parseSourceLines("TIER B\nSee https://www.timescall.com/,");
    assert.equal(rows[0]?.url, "https://www.timescall.com/");
  });
});
