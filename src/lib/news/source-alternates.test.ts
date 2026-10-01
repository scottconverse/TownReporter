import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  canonicalFromHtml,
  DOC_PATH_WORDS,
  feedFromHtml,
  locsFromSitemap,
  looksLikeDocumentPath,
  probePlanFor,
  PROBE_MAX_STEPS,
  SITEMAP_CAP,
  SITEMAP_CHILD_CAP,
  SITEMAP_LOC_CAP,
  sitemapsFromRobots,
} from "./source-alternates.ts";

/*
  READING A SITE'S SIGNPOSTS (SH0-5), against fixtures that are the shapes real
  sites actually publish.

  THE MUTATION THIS FILE IS BUILT FOR. `ingest.ts` reads the feed pointer with
  a regex that requires `rel=` before `type=` before `href=`. Swap that regex
  in for `feedFromHtml` and the reversed-order fixture below stops being found
  -- which is the whole bug: the same declaration, written in the other order,
  is invisible to the desk. The attribute-order cases are therefore not
  decoration, they are the point.
*/

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/source-alternates/${name}`, import.meta.url), "utf8");
}

const PAGE = "https://example.test/news/index.html";

describe("feedFromHtml", () => {
  it("finds the feed the page declares in the order the desk already understood", () => {
    assert.equal(
      feedFromHtml(fixture("head-standard-order.html"), PAGE),
      "https://example.test/feed.xml",
    );
  });

  it("finds it in the REVERSED attribute order -- the case the old regex misses", () => {
    // <link type="application/rss+xml" rel="alternate" href="/rss/">
    assert.equal(
      feedFromHtml(fixture("head-reversed-order.html"), PAGE),
      "https://example.test/rss/",
    );
  });

  it("finds an atom feed, single-quoted, in a third order, and resolves it", () => {
    assert.equal(
      feedFromHtml(fixture("head-atom-single-quoted.html"), PAGE),
      "https://example.test/atom.xml",
    );
  });

  it("ignores a commented-out feed and resolves a relative href against the page", () => {
    // The commented-out /commented-out.xml is a declaration nobody can use.
    assert.equal(
      feedFromHtml(fixture("head-commented-and-relative.html"), "https://example.test/a/b/page.html"),
      "https://example.test/a/feed/atom.xml",
    );
  });

  it("accepts rel as a token list and a type with a charset", () => {
    // Both spellings are legal HTML and both are in the fixture above.
    const html =
      '<link rel="alternate home" type="application/rss+xml; charset=utf-8" href="https://example.test/f.xml">';
    assert.equal(feedFromHtml(html, PAGE), "https://example.test/f.xml");
  });

  it("says nothing when the page declares no feed", () => {
    assert.equal(feedFromHtml(fixture("head-no-feed.html"), PAGE), null);
    assert.equal(feedFromHtml("<html><body>plain</body></html>", PAGE), null);
  });

  it("does not treat an hreflang alternate as a feed", () => {
    const html = '<link rel="alternate" type="text/html" hreflang="es" href="/es/">';
    assert.equal(feedFromHtml(html, PAGE), null);
  });

  it("refuses a non-http href rather than returning something unfetchable", () => {
    assert.equal(feedFromHtml('<link rel="alternate" type="application/rss+xml" href="data:x">', PAGE), null);
    assert.equal(feedFromHtml('<link rel="alternate" type="application/rss+xml" href="#top">', PAGE), null);
  });
});

describe("canonicalFromHtml", () => {
  it("reads the canonical address in either order", () => {
    assert.equal(
      canonicalFromHtml(fixture("head-standard-order.html"), PAGE),
      "https://example.test/news",
    );
    assert.equal(
      canonicalFromHtml(fixture("head-atom-single-quoted.html"), PAGE),
      "https://example.test/canonical-here",
    );
  });

  it("says nothing when the page declares none", () => {
    assert.equal(canonicalFromHtml(fixture("head-no-feed.html"), PAGE), null);
  });
});

describe("sitemapsFromRobots", () => {
  it("takes the Sitemap: lines, in order, and stops at the cap", () => {
    const found = sitemapsFromRobots(fixture("robots-three-sitemaps.txt"));
    assert.deepEqual(found, [
      "https://example.test/sitemap.xml",
      "https://example.test/agendas-sitemap.xml",
      "https://example.test/budget-sitemap.xml",
    ]);
    assert.equal(found.length, SITEMAP_CAP, "the fourth line is past the cap");
  });

  it("is case-insensitive and tolerates space around the colon", () => {
    // `sitemap:   https://...` is the third line of the fixture, and it is
    // found -- the directive is not case- or whitespace-sensitive.
    assert.ok(sitemapsFromRobots(fixture("robots-three-sitemaps.txt")).includes(
      "https://example.test/budget-sitemap.xml",
    ));
  });

  it("does not read a sitemap out of a comment", () => {
    const found = sitemapsFromRobots(fixture("robots-three-sitemaps.txt"));
    assert.ok(!found.some((u) => u.includes("not-a-declaration")));
  });

  it("returns nothing for a robots.txt that lists none", () => {
    assert.deepEqual(sitemapsFromRobots(fixture("robots-none.txt")), []);
    assert.deepEqual(sitemapsFromRobots(""), []);
  });

  it("drops a relative Sitemap: line and keeps the absolute one", () => {
    // A relative address in robots.txt names nothing a reader could fetch.
    assert.deepEqual(sitemapsFromRobots(fixture("robots-relative-sitemap.txt")), [
      "https://example.test/real.xml",
    ]);
  });

  it("deduplicates repeats", () => {
    const text = "Sitemap: https://example.test/a.xml\nSitemap: https://example.test/a.xml\n";
    assert.deepEqual(sitemapsFromRobots(text), ["https://example.test/a.xml"]);
  });
});

describe("locsFromSitemap", () => {
  it("reads an index's children, capped", () => {
    const read = locsFromSitemap(fixture("sitemap-index.xml"));
    assert.equal(read.kind, "index");
    assert.deepEqual(read.locs, [
      "https://example.test/news-sitemap.xml",
      "https://example.test/agendas-sitemap.xml",
      "https://example.test/budget-sitemap.xml",
    ]);
    assert.equal(read.locs.length, SITEMAP_CHILD_CAP, "the parks child is past the cap");
  });

  it("reads a urlset's document links and drops the ordinary pages", () => {
    const read = locsFromSitemap(fixture("sitemap-urlset.xml"));
    assert.equal(read.kind, "urlset");
    assert.deepEqual(read.locs, [
      "https://example.test/council/agenda-2026-10-07",
      "https://example.test/council/minutes-2026-09-16",
      "https://example.test/budget/2027-adopted-budget.pdf",
      "https://example.test/planning/ordinance-2044",
    ]);
    // The home page, /about and the dog-park page are not the public record.
    assert.ok(!read.locs.includes("https://example.test/"));
    assert.ok(!read.locs.some((u) => u.includes("dog-park")));
  });

  it("unwraps CDATA in a <loc>", () => {
    assert.ok(locsFromSitemap(fixture("sitemap-urlset.xml")).locs.includes(
      "https://example.test/planning/ordinance-2044",
    ));
  });

  it("returns empty, and says urlset, for something that is not a sitemap", () => {
    const read = locsFromSitemap("<html><body>404</body></html>");
    assert.deepEqual(read, { kind: "urlset", locs: [] });
  });

  it("looksLikeDocumentPath uses the same vocabulary discoverDocLinks does", () => {
    assert.equal(looksLikeDocumentPath("https://example.test/a/agenda-1"), true);
    assert.equal(looksLikeDocumentPath("https://example.test/a/packet.pdf"), true);
    assert.equal(looksLikeDocumentPath("https://example.test/a/dog-park"), false);
    assert.equal(looksLikeDocumentPath("not a url"), false);
  });

  it("the vocabulary cannot drift from ingest.ts's own", () => {
    /*
      `ingest.ts` is not importable under `node --test`, so the two lists are
      written twice. This is what stops them becoming two different answers:
      every word this module filters on must still be in `discoverDocLinks`'
      regex over there.
    */
    const ingest = readFileSync(new URL("./ingest.ts", import.meta.url), "utf8");
    const docHref = /const DOC_HREF =[\s\S]{0,400}/.exec(ingest)?.[0] ?? "";
    assert.ok(docHref, "discoverDocLinks' vocabulary is still in ingest.ts");
    for (const word of DOC_PATH_WORDS) {
      // "staff report" is written `staff.?report` in ingest.ts's regex, so the
      // word and its spelling there are compared as text rather than as a
      // pattern -- a pattern would have to guess at `.?`.
      const loose = word.replace(/\s+/g, ".?").toLowerCase();
      assert.ok(
        docHref.toLowerCase().includes(loose),
        `ingest.ts's DOC_HREF no longer covers "${word}"`,
      );
    }
  });

  it("the caps are the ones the design promises", () => {
    assert.equal(SITEMAP_CAP, 3);
    assert.equal(SITEMAP_LOC_CAP, 10);
  });
});

describe("probePlanFor", () => {
  it("is empty for a name that did not resolve", () => {
    // "The address itself did not answer" -- there is nothing to read, and the
    // editor is told so rather than sent on fetch after fetch.
    for (const reason of [
      "getaddrinfo ENOTFOUND example.test",
      "ENOTFOUND",
      "That address could not be resolved",
      "Name lookup failed (DNS)",
    ]) {
      assert.deepEqual(probePlanFor(reason, true), [], reason);
    }
  });

  it("is empty for a timeout", () => {
    for (const reason of ["The page timed out.", "timeout of 15000ms exceeded", "ETIMEDOUT"]) {
      assert.deepEqual(probePlanFor(reason, true), [], reason);
    }
  });

  it("tries the site root, and only the site root, behind a redirect loop", () => {
    assert.deepEqual(probePlanFor("Too many redirects", true), ["site-root"]);
  });

  it("tries the site root then robots.txt when the host blocked us", () => {
    for (const reason of [
      "403 Forbidden",
      "401 Unauthorized",
      "429 Too Many Requests",
      "The site asked us to slow down.",
      "cdn-cgi/challenge",
      "Just a moment... (bot wall)",
    ]) {
      assert.deepEqual(probePlanFor(reason, true), ["site-root", "robots"], reason);
      assert.deepEqual(probePlanFor(reason, false), ["site-root", "robots"], reason);
    }
  });

  it("tries the signposts for a gone page ONLY when it read before", () => {
    assert.deepEqual(probePlanFor("404 not found", true), ["site-root", "robots"]);
    assert.deepEqual(probePlanFor("Page had almost no readable text", true), [
      "site-root",
      "robots",
    ]);
    // No prior success: the address was simply wrong. An empty plan is the
    // honest answer, not a hopeful one.
    assert.deepEqual(probePlanFor("404 not found", false), []);
    assert.deepEqual(probePlanFor("410 Gone", false), []);
  });

  it("is empty when there is no failure to explain", () => {
    assert.deepEqual(probePlanFor(null, true), []);
    assert.deepEqual(probePlanFor("", true), []);
    assert.deepEqual(probePlanFor(undefined, true), []);
  });

  it("never plans the failing address itself, and never exceeds the bound", () => {
    // Step NAMES only -- the caller resolves them against the host it already
    // watches, which is what makes "this cannot introduce a new host" true by
    // construction rather than by a check somewhere else.
    const reasons = [
      "403 Forbidden",
      "Too many redirects",
      "404 not found",
      "ENOTFOUND",
      "Page had almost no readable text",
      "",
    ];
    for (const reason of reasons) {
      for (const prior of [true, false]) {
        const plan = probePlanFor(reason, prior);
        assert.ok(plan.length <= PROBE_MAX_STEPS, `${reason} / ${prior}`);
        for (const step of plan) assert.ok(["site-root", "robots"].includes(step));
      }
    }
  });
});
