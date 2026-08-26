import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickSearchResult,
  parseBingHtml,
  parseBraveHtml,
  parseDdgHtml,
  parseWaybackCdx,
  parseWikipediaOpenSearch,
} from "./search-web.ts";

describe("parseDdgHtml", () => {
  it("unwraps uddg result URLs and drops duckduckgo chrome", () => {
    const html = `
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsos.state.co.us%2Fbiz%2Ffrms">Front Range</a>
      <a class="result__a" href="https://duckduckgo.com/about">about</a>
      <a href="https://www.sos.state.co.us/pubs/business">SOS</a>
    `;
    const hits = parseDdgHtml(html);
    assert.ok(hits.some((h) => h.url.includes("sos.state.co.us")));
    assert.equal(hits.some((h) => /duckduckgo\.com/.test(h.url)), false);
  });
});

describe("parseBingHtml", () => {
  it("reads independent Bing result hrefs and drops Bing chrome", () => {
    const html = `
      <h2><a href="https://www.sos.state.co.us/biz/acme">Acme Holdings LLC</a></h2>
      <h2><a href="https://www.bing.com/ck/a">tracking</a></h2>
      <h2><a href="https://longmontcolorado.gov/contracts/2024-19">City contract 2024-19</a></h2>
    `;
    const hits = parseBingHtml(html);
    assert.equal(hits.length, 2);
    assert.ok(hits.some((h) => h.url.includes("sos.state.co.us")));
    assert.ok(hits.some((h) => h.url.includes("2024-19")));
    assert.equal(hits.some((h) => /bing\.com/.test(h.url)), false);
  });
});

describe("parseBraveHtml", () => {
  it("reads Brave SERP headings and falls back to public hrefs", () => {
    const html = `
      <a class="heading-serpresult svelte" href="https://records.bouldercolorado.gov/acme.pdf">Filing</a>
      <a href="https://search.brave.com/search?q=x">chrome</a>
    `;
    const hits = parseBraveHtml(html);
    assert.ok(hits.some((h) => h.url.includes("records.bouldercolorado.gov")));
    assert.equal(hits.some((h) => /brave\.com/.test(h.url)), false);
  });
});

describe("parseWaybackCdx", () => {
  it("builds archive URLs from CDX json", () => {
    const raw = JSON.stringify([
      ["urlkey", "timestamp", "original"],
      ["com,example)/a", "20260801000000", "https://example.com/a"],
    ]);
    const copies = parseWaybackCdx(raw);
    assert.equal(copies[0], "https://web.archive.org/web/20260801000000/https://example.com/a");
  });
});

describe("parseWikipediaOpenSearch", () => {
  it("reads title, snippet, and URL from the OpenSearch tuple", () => {
    const raw = JSON.stringify([
      "Longmont",
      ["Longmont, Colorado"],
      ["City in Boulder County"],
      ["https://en.wikipedia.org/wiki/Longmont,_Colorado"],
    ]);
    const hits = parseWikipediaOpenSearch(raw);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.url, "https://en.wikipedia.org/wiki/Longmont,_Colorado");
    assert.match(hits[0]!.title, /Longmont/);
  });

  it("returns empty on garbage rather than throwing", () => {
    assert.deepEqual(parseWikipediaOpenSearch("not-json"), []);
    assert.deepEqual(parseWikipediaOpenSearch("[]"), []);
  });
});

describe("pickSearchResult", () => {
  it("prefers results from a later provider over an earlier zero or failure", () => {
    const picked = pickSearchResult([
      { state: "SEARCH_FAILED_PROVIDER", hits: [], provider: "ddg-html", error: "500" },
      { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "ddg-lite" },
      {
        state: "SEARCH_SUCCESS_RESULTS",
        hits: [{ title: "Filing", url: "https://sos.state.co.us/biz/x", snippet: "" }],
        provider: "wikipedia",
      },
    ]);
    assert.equal(picked.state, "SEARCH_SUCCESS_RESULTS");
    assert.equal(picked.provider, "wikipedia");
    assert.equal(picked.lineage?.length, 3);
  });

  it("uses Bing after DuckDuckGo fails — a failed provider is not 'nothing exists'", () => {
    const picked = pickSearchResult([
      { state: "SEARCH_FAILED_NETWORK", hits: [], provider: "ddg-html", error: "timeout" },
      { state: "SEARCH_FAILED_PROVIDER", hits: [], provider: "ddg-lite", error: "500" },
      {
        state: "SEARCH_SUCCESS_RESULTS",
        hits: [{ title: "Contract", url: "https://longmontcolorado.gov/c", snippet: "" }],
        provider: "bing-html",
      },
    ]);
    assert.equal(picked.state, "SEARCH_SUCCESS_RESULTS");
    assert.equal(picked.provider, "bing-html");
  });

  it("keeps zero when every provider returned zero, distinct from failure", () => {
    const picked = pickSearchResult([
      { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "ddg-html" },
      { state: "SEARCH_FAILED_NETWORK", hits: [], provider: "ddg-lite" },
    ]);
    assert.equal(picked.state, "SEARCH_SUCCESS_ZERO_RESULTS");
    assert.equal(picked.provider, "ddg-html");
  });
});
