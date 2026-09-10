import { afterEach, beforeEach, describe, it } from "node:test";
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
  searchWithFallback,
} from "./search-web.ts";
import { setHaloFetchImplForTests } from "./halo-search.ts";

const originalGateway = process.env.TOWNREPORTER_GATEWAY_MCP_URL;
afterEach(() => {
  setHaloFetchImplForTests(null);
  if (originalGateway === undefined) delete process.env.TOWNREPORTER_GATEWAY_MCP_URL;
  else process.env.TOWNREPORTER_GATEWAY_MCP_URL = originalGateway;
});

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
    assert.equal(
      hits.some((h) => /duckduckgo\.com/.test(h.url)),
      false,
    );
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
    assert.equal(
      hits.some((h) => /bing\.com/.test(h.url)),
      false,
    );
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
    assert.equal(
      hits.some((h) => /brave\.com/.test(h.url)),
      false,
    );
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

describe("optional Halo Gateway provider", () => {
  it("uses configured Gateway results before any external fallback and keeps partial metadata", async () => {
    process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
    const calls: string[] = [];
    setHaloFetchImplForTests(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body.method);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    schema_version: "1.5",
                    ok: true,
                    tool: "web_search",
                    provider: "searxng",
                    coverage: { available: 10, complete: false },
                    page: { next_cursor: "more" },
                    warnings: ["RESULT_TRUNCATED"],
                    items: [{ title: "City", url: "https://example.gov/city", snippet: "primary" }],
                  }),
                },
              ],
            },
          }),
        );
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
    const attempt = await searchWithFallback("city contracts", [
      async () => {
        throw new Error("external fallback used");
      },
    ]);
    assert.equal(attempt.provider, "halo-gateway:searxng");
    assert.equal(attempt.complete, false);
    assert.equal(attempt.nextCursor, "more");
    assert.deepEqual(attempt.warnings, ["RESULT_TRUNCATED"]);
    assert.deepEqual(calls, ["initialize", "notifications/initialized", "tools/call"]);
  });

  it("records Gateway zero in lineage then falls back without a real request", async () => {
    process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
    setHaloFetchImplForTests(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    schema_version: "1.5",
                    ok: true,
                    tool: "web_search",
                    provider: "searxng",
                    coverage: { complete: false },
                    warnings: ["RESULT_TRUNCATED"],
                    items: [],
                  }),
                },
              ],
            },
          }),
        );
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
    const attempt = await searchWithFallback("city contracts", [
      async () => ({
        state: "SEARCH_SUCCESS_RESULTS" as const,
        provider: "offline-fallback",
        hits: [{ title: "fallback", url: "https://example.gov/fallback", snippet: "" }],
      }),
    ]);
    assert.equal(attempt.provider, "offline-fallback");
    assert.equal(attempt.lineage?.[0]?.provider, "halo-gateway:searxng");
    assert.equal(attempt.lineage?.[0]?.state, "SEARCH_SUCCESS_ZERO_RESULTS");
    assert.equal(attempt.lineage?.[0]?.complete, false);
  });

  it("leaves the default fallback list unchanged when Gateway is unset", async () => {
    delete process.env.TOWNREPORTER_GATEWAY_MCP_URL;
    const attempt = await searchWithFallback("city contracts", [
      async () => ({
        state: "SEARCH_SUCCESS_RESULTS" as const,
        provider: "offline-fallback",
        hits: [],
      }),
    ]);
    assert.equal(attempt.provider, "offline-fallback");
    assert.equal(
      attempt.lineage?.some((step) => step.provider.startsWith("halo-gateway:")),
      false,
    );
  });

  it("retains a failed Gateway attempt and still returns the existing fallback's results", async () => {
    process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
    setHaloFetchImplForTests(async () => new Response("unavailable", { status: 503 }));
    const attempt = await searchWithFallback("city contracts", [
      async () => ({
        state: "SEARCH_SUCCESS_RESULTS" as const,
        provider: "offline-fallback",
        hits: [{ title: "Public record", url: "https://example.gov/record", snippet: "record" }],
      }),
    ]);
    assert.equal(attempt.provider, "offline-fallback");
    assert.equal(attempt.lineage?.[0]?.state, "SEARCH_FAILED_PROVIDER");
    assert.equal(attempt.lineage?.[0]?.error, "Gateway HTTP 503");
    assert.equal(attempt.lineage?.length, 2);
  });

  it("retains the valid Gateway error code and safe partial metadata before fallback", async () => {
    process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
    setHaloFetchImplForTests(async (_url, init) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "notifications/initialized") return new Response(null, { status: 202 });
      if (method === "tools/call")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    schema_version: "1.5",
                    ok: false,
                    tool: "web_search",
                    provider: "ddgs-accountless",
                    error: { code: "PROVIDER_UNAVAILABLE", message: "remote secret" },
                    coverage: { available: 0, complete: false },
                    warnings: ["PROVIDER_FALLBACK_USED"],
                    items: [],
                  }),
                },
              ],
            },
          }),
        );
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
    const attempt = await searchWithFallback("city contracts", [
      async () => ({
        state: "SEARCH_SUCCESS_RESULTS" as const,
        provider: "offline-fallback",
        hits: [{ title: "record", url: "https://example.gov/record", snippet: "" }],
      }),
    ]);
    assert.equal(attempt.provider, "offline-fallback");
    assert.deepEqual(
      attempt.lineage?.[0] && {
        provider: attempt.lineage[0].provider,
        state: attempt.lineage[0].state,
        error: attempt.lineage[0].error,
        errorCode: (attempt.lineage[0] as any).errorCode,
        complete: attempt.lineage[0].complete,
        warnings: attempt.lineage[0].warnings,
      },
      {
        provider: "halo-gateway",
        state: "SEARCH_FAILED_PROVIDER",
        error: "Gateway provider error: PROVIDER_UNAVAILABLE",
        errorCode: "PROVIDER_UNAVAILABLE",
        complete: false,
        warnings: ["PROVIDER_FALLBACK_USED"],
      },
    );
  });
});

describe("optional relevance-aware continuation", () => {
  const relevantOptions = {
    officialDomains: ["longmontcolorado.gov", "bouldercounty.gov"],
    localityStopwords: ["longmont", "boulder", "colorado"],
  };

  beforeEach(() => {
    delete process.env.TOWNREPORTER_GATEWAY_MCP_URL;
  });

  it("preserves configured Gateway-first ordering when relevance filtering is enabled", async () => {
    process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
    const calls: string[] = [];
    setHaloFetchImplForTests(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body.method);
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call")
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    schema_version: "1.5",
                    ok: true,
                    tool: "web_search",
                    provider: "synthetic",
                    coverage: { complete: true },
                    items: [
                      {
                        title: "2025 election candidates",
                        url: "https://bouldercounty.gov/elections/candidates",
                        snippet: "Candidate affiliations",
                      },
                    ],
                  }),
                },
              ],
            },
          }),
        );
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    });
    let fallbackCalled = false;
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => {
          fallbackCalled = true;
          return { state: "SEARCH_SUCCESS_ZERO_RESULTS" as const, provider: "fallback", hits: [] };
        },
      ],
      relevantOptions,
    );
    assert.equal(attempt.provider, "halo-gateway:synthetic");
    assert.equal(fallbackCalled, false);
    assert.deepEqual(calls, ["initialize", "notifications/initialized", "tools/call"]);
  });

  it("returns a relevant first success without calling later providers", async () => {
    const calls: string[] = [];
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => {
          calls.push("first");
          return {
            state: "SEARCH_SUCCESS_RESULTS" as const,
            provider: "first",
            hits: [
              {
                title: "2025 candidate affiliations",
                url: "https://records.example/candidates",
                snippet: "Election affiliations",
              },
            ],
          };
        },
        async () => {
          calls.push("second");
          return { state: "SEARCH_SUCCESS_ZERO_RESULTS" as const, provider: "second", hits: [] };
        },
      ],
      relevantOptions,
    );
    assert.deepEqual(calls, ["first"]);
    assert.equal(attempt.relevance?.decision, "relevant");
  });

  it("continues after nonempty off-question results and ranks a later relevant hit first", async () => {
    const calls: string[] = [];
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => {
          calls.push("broad");
          return {
            state: "SEARCH_SUCCESS_RESULTS" as const,
            provider: "broad",
            hits: [
              {
                title: "Visit Longmont",
                url: "https://longmontcolorado.gov/",
                snippet: "Tourism and departments",
              },
            ],
          };
        },
        async () => {
          calls.push("records");
          return {
            state: "SEARCH_SUCCESS_RESULTS" as const,
            provider: "records",
            hits: [
              {
                title: "2025 election candidates",
                url: "https://bouldercounty.gov/elections/candidates",
                snippet: "Candidate affiliations",
              },
            ],
          };
        },
      ],
      relevantOptions,
    );
    assert.deepEqual(calls, ["broad", "records"]);
    assert.equal(attempt.hits[0]?.provider, "records");
    assert.equal(attempt.hits[1]?.provider, "broad");
    assert.equal(attempt.lineage?.length, 2);
    assert.equal(attempt.relevance?.decision, "relevant");
  });

  it("replaces an earlier broad duplicate with the later relevant representation", async () => {
    const url = "https://bouldercounty.gov/elections/candidates";
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "broad",
          hits: [{ title: "Boulder County", url, snippet: "Services" }],
        }),
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "records",
          hits: [
            {
              title: "2025 election candidate affiliations",
              url: `${url}#record`,
              snippet: "Official record",
            },
          ],
        }),
      ],
      relevantOptions,
    );
    assert.equal(attempt.hits.length, 1);
    assert.equal(attempt.hits[0]?.title, "2025 election candidate affiliations");
    assert.equal(attempt.hits[0]?.provider, "records");
    assert.equal(attempt.relevance?.selectedUrl, `${url}#record`);
  });

  it("matches complete result tokens rather than substrings inside unrelated words", async () => {
    let secondCalled = false;
    const attempt = await searchWithFallback(
      "audit contract",
      [
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "substring-only",
          hits: [
            { title: "Auditor contracting guide", url: "https://example.com/guide", snippet: "" },
          ],
        }),
        async () => {
          secondCalled = true;
          return {
            state: "SEARCH_SUCCESS_RESULTS" as const,
            provider: "exact",
            hits: [
              { title: "Audit contract", url: "https://example.com/audit-contract", snippet: "" },
            ],
          };
        },
      ],
      { officialDomains: [], localityStopwords: [] },
    );
    assert.equal(secondCalled, true);
    assert.equal(attempt.hits[0]?.provider, "exact");
  });

  it("retains all nonempty degraded hits when no provider answers the question", async () => {
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "tourism",
          hits: [{ title: "Visit", url: "https://example.com/visit", snippet: "Hotels" }],
        }),
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "directory",
          hits: [
            {
              title: "Departments",
              url: "https://example.com/departments",
              snippet: "Phone directory",
            },
          ],
        }),
      ],
      relevantOptions,
    );
    assert.equal(attempt.state, "SEARCH_SUCCESS_RESULTS");
    assert.deepEqual(
      attempt.hits.map((hit) => hit.provider),
      ["tourism", "directory"],
    );
    assert.equal(attempt.relevance?.decision, "degraded");
    assert.match(attempt.relevance?.reason ?? "", /none matched/i);
  });

  it("preserves a later failure in lineage after an irrelevant success", async () => {
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "broad",
          hits: [{ title: "Welcome", url: "https://example.com/", snippet: "Home" }],
        }),
        async () => ({
          state: "SEARCH_FAILED_NETWORK" as const,
          provider: "later",
          hits: [],
          error: "synthetic timeout",
        }),
      ],
      relevantOptions,
    );
    assert.equal(attempt.state, "SEARCH_SUCCESS_RESULTS");
    assert.equal(attempt.lineage?.[1]?.error, "synthetic timeout");
    assert.equal(attempt.relevance?.decision, "degraded");
  });

  it("does not treat an official homepage as relevant without question terms", async () => {
    let secondCalled = false;
    const attempt = await searchWithFallback(
      "2025 election candidate affiliations",
      [
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "official-home",
          hits: [
            {
              title: "City of Longmont",
              url: "https://longmontcolorado.gov/",
              snippet: "Departments and services",
            },
          ],
        }),
        async () => {
          secondCalled = true;
          return {
            state: "SEARCH_SUCCESS_RESULTS" as const,
            provider: "records",
            hits: [
              {
                title: "Candidate affiliations",
                url: "https://example.org/candidate-affiliations",
                snippet: "2025 election",
              },
            ],
          };
        },
      ],
      relevantOptions,
    );
    assert.equal(secondCalled, true);
    assert.equal(attempt.hits[0]?.provider, "records");
  });

  it("fails open when locality removal leaves no meaningful query tokens", async () => {
    let secondCalled = false;
    const attempt = await searchWithFallback(
      "Longmont Boulder Colorado",
      [
        async () => ({
          state: "SEARCH_SUCCESS_RESULTS" as const,
          provider: "first",
          hits: [{ title: "Anything", url: "https://example.com/", snippet: "" }],
        }),
        async () => {
          secondCalled = true;
          return { state: "SEARCH_SUCCESS_ZERO_RESULTS" as const, provider: "second", hits: [] };
        },
      ],
      relevantOptions,
    );
    assert.equal(secondCalled, false);
    assert.equal(attempt.relevance?.decision, "not-evaluated");
  });

  it("leaves ordinary two-argument fallback behavior unchanged", async () => {
    let secondCalled = false;
    const attempt = await searchWithFallback("unrelated", [
      async () => ({
        state: "SEARCH_SUCCESS_RESULTS" as const,
        provider: "first",
        hits: [{ title: "Anything", url: "https://example.com/", snippet: "" }],
      }),
      async () => {
        secondCalled = true;
        return { state: "SEARCH_SUCCESS_ZERO_RESULTS" as const, provider: "second", hits: [] };
      },
    ]);
    assert.equal(secondCalled, false);
    assert.equal(attempt.provider, "first");
    assert.equal(attempt.relevance, undefined);
  });
});
