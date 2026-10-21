/**
 * READING THE CITY'S SITEMAP (A5), against fake XML and a fake fetcher.
 *
 * WHAT THIS PINS:
 *
 *   1. An index is followed to its children and the children's `<loc>`s come
 *      back -- the read the "Use this instead" panel was missing.
 *   2. A fetcher that fails yields `[]` and never throws, because the panel
 *      still has siblings to draw and an editor press must not crash.
 *   3. An address the newsroom already holds is dropped, whatever its status,
 *      because the proposal door refuses it.
 *   4. What comes out is labelled `via: "sitemap"`, which is what makes
 *      `candidateIsWatchedSource` false and the press appear at all.
 *
 * MUTATION: make `readSitemapLocs` return the index's own children instead of
 * reading them and case 1 fails; skip `dropKnownSourceUrls` and case 3 fails.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateIsWatchedSource,
  sitemapCandidates,
} from "./source-replacements.ts";
import {
  dropKnownSourceUrls,
  normalizeSourceUrl,
  readSitemapLocs,
  type SitemapTextFetcher,
} from "./source-sitemap.ts";

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.gov/sitemap-planning.xml</loc></sitemap>
  <sitemap><loc>https://example.gov/sitemap-council.xml</loc></sitemap>
</sitemapindex>`;

const PLANNING = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.gov/planning/agenda-2027-03.pdf</loc></url>
  <url><loc>https://example.gov/planning/dog-park-hours</loc></url>
</urlset>`;

const COUNCIL = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.gov/council/minutes-2027-01.pdf</loc></url>
</urlset>`;

function fetcherOver(pages: Record<string, string>): SitemapTextFetcher {
  return async (url) => {
    const page = pages[url];
    if (page === undefined) throw new Error(`404 ${url}`);
    return page;
  };
}

describe("readSitemapLocs", () => {
  it("follows a sitemap index to its children and returns their locations", async () => {
    const locs = await readSitemapLocs(
      "example.gov",
      fetcherOver({
        "https://example.gov/sitemap.xml": INDEX,
        "https://example.gov/sitemap-planning.xml": PLANNING,
        "https://example.gov/sitemap-council.xml": COUNCIL,
      }),
    );
    assert.deepEqual(locs, [
      "https://example.gov/planning/agenda-2027-03.pdf",
      "https://example.gov/council/minutes-2027-01.pdf",
    ]);
  });

  it("reads robots.txt when sitemap.xml is missing, still within the child cap", async () => {
    const locs = await readSitemapLocs(
      "example.gov",
      fetcherOver({
        "https://example.gov/robots.txt": "User-agent: *\nSitemap: https://example.gov/sitemap-planning.xml\n",
        "https://example.gov/sitemap-planning.xml": PLANNING,
      }),
    );
    assert.deepEqual(locs, ["https://example.gov/planning/agenda-2027-03.pdf"]);
  });

  it("returns [] rather than throwing when every fetch fails", async () => {
    const locs = await readSitemapLocs("example.gov", async () => {
      throw new Error("ECONNREFUSED");
    });
    assert.deepEqual(locs, []);
  });
});

describe("dropKnownSourceUrls", () => {
  it("drops an address the newsroom already holds, ignoring a trailing slash", () => {
    assert.deepEqual(
      dropKnownSourceUrls(
        [
          "https://example.gov/planning/agenda-2027-03.pdf",
          "https://example.gov/council",
        ],
        ["https://example.gov/council/"],
      ),
      ["https://example.gov/planning/agenda-2027-03.pdf"],
    );
    assert.equal(normalizeSourceUrl("https://Example.gov/council/#top"), "https://example.gov/council");
  });
});

describe("sitemap candidates reach the panel as a press", () => {
  it("are labelled via: sitemap, so candidateIsWatchedSource is false", async () => {
    const locs = await readSitemapLocs(
      "example.gov",
      fetcherOver({
        "https://example.gov/sitemap.xml": INDEX,
        "https://example.gov/sitemap-planning.xml": PLANNING,
        "https://example.gov/sitemap-council.xml": COUNCIL,
      }),
    );
    const candidates = sitemapCandidates(
      dropKnownSourceUrls(locs, ["https://example.gov/council/minutes-2027-01.pdf"]),
      { beats: ["planning"] },
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.url, "https://example.gov/planning/agenda-2027-03.pdf");
    assert.equal(candidates[0]!.via, "sitemap");
    assert.equal(candidateIsWatchedSource(candidates[0]!), false);
  });
});
