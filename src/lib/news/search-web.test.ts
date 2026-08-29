import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickSearchResult,
  parseBingHtml,
  parseBraveHtml,
  parseDdgHtml,
  parseExaBlocks,
  parseWaybackCdx,
  parseWikipediaOpenSearch,
  readMcpSseText,
  unwrapBingRedirect,
} from "./search-web.ts";

describe("parseExaBlocks", () => {
  it("reads the block shape Exa's MCP returns", () => {
    const text = [
      "Title: CO 119 Mobility Improvements",
      "URL: https://www.codot.gov/projects/co119mobility",
      "Published: 2026-02-11",
      "Highlights:",
      "The Hover Street ... intersection closes to left turns ...",
      "---",
      "Title: Longmont Meeting Portal",
      "URL: https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=1",
      "Highlights:",
      "City Council regular session",
    ].join("\n");
    const hits = parseExaBlocks(text);
    assert.equal(hits.length, 2);
    assert.equal(hits[0]!.url, "https://www.codot.gov/projects/co119mobility");
    assert.match(hits[0]!.title, /CO 119/);
    assert.match(hits[0]!.snippet, /Hover Street/);
    assert.ok(hits[1]!.url.includes("primegov.com"));
  });

  it("drops blocks with no URL and de-duplicates", () => {
    const text = [
      "Title: no url here",
      "---",
      "URL: https://example.gov/a",
      "---",
      "URL: https://example.gov/a",
    ].join("\n");
    assert.equal(parseExaBlocks(text).length, 1);
  });

  it("rejects a non-http destination rather than passing it on", () => {
    assert.deepEqual(parseExaBlocks("URL: file:///c:/windows/win.ini"), []);
  });
});

describe("readMcpSseText", () => {
  it("pulls the tool text out of the SSE data frame", () => {
    const raw = [
      "event: message",
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "URL: https://example.gov/a" }] },
      })}`,
      "",
    ].join("\n");
    assert.equal(readMcpSseText(raw), "URL: https://example.gov/a");
  });

  it("returns null on a JSON-RPC error or a tool error", () => {
    const err = `data: ${JSON.stringify({ error: { message: "rate limited" } })}`;
    assert.equal(readMcpSseText(err), null);
    const toolErr = `data: ${JSON.stringify({
      result: { isError: true, content: [{ type: "text", text: "boom" }] },
    })}`;
    assert.equal(readMcpSseText(toolErr), null);
  });

  it("returns null when nothing parses, rather than throwing", () => {
    assert.equal(readMcpSseText("data: not-json\n\nhello"), null);
  });
});

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

  /**
   * The shape Bing actually serves. Every result is a click tracker with the
   * destination base64url-encoded after a literal `a1`, and the href arrives
   * HTML-escaped. Treating those as Bing chrome discarded the entire page, so
   * search returned zero for every query, silently.
   */
  it("unwraps the click tracker Bing really uses", () => {
    // u=a1 + base64url("https://longmontcolorado.gov/")
    const html = `
      <h2 class=""><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=6a8a&amp;ptn=3&amp;u=a1aHR0cHM6Ly9sb25nbW9udGNvbG9yYWRvLmdvdi8&amp;ntb=1">City of Longmont</a></h2>
    `;
    const hits = parseBingHtml(html);
    assert.equal(hits.length, 1, "a wrapped result must not be discarded");
    assert.equal(hits[0]?.url, "https://longmontcolorado.gov/");
    assert.equal(hits[0]?.title, "City of Longmont");
  });

  it("still drops a tracker whose destination cannot be decoded", () => {
    const html = `<h2><a href="https://www.bing.com/ck/a?ptn=3&amp;ntb=1">no destination</a></h2>`;
    assert.equal(parseBingHtml(html).length, 0);
  });
});

describe("unwrapBingRedirect", () => {
  it("decodes a base64url destination", () => {
    const wrapped =
      "https://www.bing.com/ck/a?!&amp;p=x&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmdvdi9hZ2VuZGE&amp;ntb=1";
    assert.equal(unwrapBingRedirect(wrapped), "https://example.gov/agenda");
  });

  it("leaves an ordinary URL alone", () => {
    assert.equal(
      unwrapBingRedirect("https://longmontcolorado.gov/city-clerk/"),
      "https://longmontcolorado.gov/city-clerk/",
    );
  });

  it("returns the input when the payload is not a URL", () => {
    // base64url("not a url")
    const wrapped = "https://www.bing.com/ck/a?u=a1bm90IGEgdXJs";
    assert.match(unwrapBingRedirect(wrapped), /bing\.com/);
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
